import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import * as Haptics from "expo-haptics";
import { clearEnrollment, markOnboardingComplete, onboardingComplete, readEnrollment, writeEnrollment } from "@/host/enrollment";
import { claimPairing, HostClient } from "@/host/host-client";
import { disablePushNotifications, syncPushRegistration } from "@/notifications/push";
import type {
  AgentSummary,
  AttentionItem,
  ChatAttachment,
  ChatMessage,
  Enrollment,
  HostStreamEvent,
  MobileSnapshot,
  PairingClaimInput,
  PendingAttachment,
  QueuedMessageSummary,
  RoutineSummary,
  RoutineSchedule,
  RoutineOccurrence,
} from "@/host/types";
import {
  mergeChronological,
  newestBranchLeaf,
  pagingAfterPage,
  StreamDeltaBatcher,
  UNINITIALIZED_MESSAGE_PAGING,
  visibleBranch,
  type AgentMessagePaging,
} from "./chat-state";
import { DEMO_MESSAGES, DEMO_SNAPSHOT } from "./demo-data";

type AppPhase = "booting" | "onboarding" | "pairing" | "ready";
type ConnectionState = "demo" | "connecting" | "online" | "offline";

interface CumeaState {
  phase: AppPhase;
  connection: ConnectionState;
  enrollment: Enrollment | null;
  hostName?: string;
  capabilities: MobileSnapshot["capabilities"];
  profile: MobileSnapshot["profile"];
  agents: AgentSummary[];
  attention: AttentionItem[];
  routines: RoutineSummary[];
  queuedMessages: QueuedMessageSummary[];
  messages: Record<string, ChatMessage[]>;
  streaming: Record<string, string>;
  messagePaging: Record<string, AgentMessagePaging>;
  error: string | null;
}

interface CumeaActions {
  finishOnboarding(): Promise<void>;
  pair(input: PairingClaimInput): Promise<void>;
  enterDemo(): Promise<void>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
  ensureMessages(agentId: string): Promise<void>;
  loadOlderMessages(agentId: string): Promise<void>;
  markRead(agentId: string): void;
  sendMessage(agentId: string, text: string, attachments: PendingAttachment[]): Promise<void>;
  editMessage(agentId: string, messageId: string, text: string): Promise<void>;
  switchBranch(agentId: string, messageId: string): Promise<void>;
  interrupt(agentId: string): Promise<void>;
  respondAttention(item: AttentionItem, choice: AttentionItem["choices"][number]): Promise<void>;
  toggleRoutine(routine: RoutineSummary): Promise<void>;
  updateRoutine(routine: RoutineSummary, patch: { name?: string; prompt?: string; schedule?: RoutineSchedule; enabled?: boolean }): Promise<void>;
  runRoutine(routine: RoutineSummary): Promise<void>;
  routineOccurrences(from: number, to: number): Promise<RoutineOccurrence[]>;
  createAgent(name: string, role: string, options?: { temporary?: boolean }): Promise<AgentSummary>;
  makeAgentPermanent(agentId: string): Promise<void>;
  startContext(agentId: string): Promise<void>;
  cancelQueued(taskId: string): Promise<void>;
  clearError(): void;
}

const initialState: CumeaState = {
  phase: "booting",
  connection: "offline",
  enrollment: null,
  profile: { name: "Cumea User" },
  capabilities: { computerPreview: false },
  agents: [],
  attention: [],
  routines: [],
  queuedMessages: [],
  messages: {},
  streaming: {},
  messagePaging: {},
  error: null,
};

const CumeaContext = createContext<{ state: CumeaState; actions: CumeaActions } | null>(null);
const localId = () => `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

function byRecent(left: AgentSummary, right: AgentSummary) {
  return right.updatedAt - left.updatedAt;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function upsertAgent(agents: AgentSummary[], incoming: AgentSummary): AgentSummary[] {
  const existing = agents.some((agent) => agent.id === incoming.id);
  return (existing ? agents.map((agent) => agent.id === incoming.id ? incoming : agent) : [...agents, incoming]).sort(byRecent);
}

function messagesEqual(left: ChatMessage, right: ChatMessage): boolean {
  const leftAttachments = left.attachments ?? [];
  const rightAttachments = right.attachments ?? [];
  return left.agentId === right.agentId &&
    left.role === right.role &&
    left.kind === right.kind &&
    left.text === right.text &&
    left.createdAt === right.createdAt &&
    left.status === right.status &&
    left.delivery === right.delivery &&
    left.taskId === right.taskId &&
    left.clientMessageId === right.clientMessageId &&
    (left.parentId ?? null) === (right.parentId ?? null) &&
    leftAttachments.length === rightAttachments.length &&
    leftAttachments.every((attachment, index) => {
      const other = rightAttachments[index];
      return other !== undefined &&
        attachment.id === other.id &&
        attachment.name === other.name &&
        attachment.mime === other.mime &&
        attachment.size === other.size &&
        attachment.downloadUrl === other.downloadUrl;
    });
}

function mergeMessages(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  return mergeChronological(previous, incoming, (existing, next) => messagesEqual(existing, next) ? existing : next);
}

function demoPaging(agents: readonly AgentSummary[]): Record<string, AgentMessagePaging> {
  return Object.fromEntries(agents.map((agent) => [agent.id, {
    cursor: null,
    initialized: true,
    hasMore: false,
    loading: false,
  }]));
}

function applySnapshot(previous: CumeaState, snapshot: MobileSnapshot): CumeaState {
  const snapshotMessages = snapshot.messages ?? {};
  return {
    ...previous,
    hostName: snapshot.hostName ?? previous.hostName,
    profile: snapshot.profile,
    capabilities: snapshot.capabilities,
    agents: snapshot.agents,
    attention: snapshot.attention,
    routines: snapshot.routines,
    queuedMessages: snapshot.queuedMessages,
    messages: Object.fromEntries(snapshot.agents.map((agent) => [
      agent.id,
      mergeMessages(previous.messages[agent.id] ?? [], snapshotMessages[agent.id] ?? []),
    ])),
    streaming: Object.fromEntries(snapshot.agents.flatMap((agent) =>
      previous.streaming[agent.id] === undefined ? [] : [[agent.id, previous.streaming[agent.id]]],
    )),
    messagePaging: Object.fromEntries(snapshot.agents.map((agent) => [
      agent.id,
      previous.messagePaging[agent.id] ?? { ...UNINITIALIZED_MESSAGE_PAGING },
    ])),
  };
}

function foldHostEvent(previous: CumeaState, event: HostStreamEvent): CumeaState {
  if (event.kind === "hello") return previous;
  if (event.kind === "agent.deleted") {
    return {
      ...previous,
      agents: previous.agents.filter((agent) => agent.id !== event.agentId),
      attention: previous.attention.filter((item) => item.agentId !== event.agentId),
      messages: withoutKey(previous.messages, event.agentId),
      streaming: withoutKey(previous.streaming, event.agentId),
      messagePaging: withoutKey(previous.messagePaging, event.agentId),
    };
  }
  if (event.kind === "workspace") {
    const counts = new Map<string, number>();
    for (const task of event.queuedMessages) counts.set(task.agentId, (counts.get(task.agentId) ?? 0) + 1);
    return {
      ...previous,
      routines: event.routines,
      queuedMessages: event.queuedMessages,
      agents: previous.agents.map((agent) => ({ ...agent, queuedCount: counts.get(agent.id) ?? 0 })),
    };
  }
  if (event.kind === "thread") {
    return {
      ...previous,
      agents: previous.agents.map((agent) => agent.id === event.agentId
        ? { ...agent, activeLeafId: event.activeLeafId }
        : agent),
    };
  }
  if (event.kind === "agent") {
    return {
      ...previous,
      agents: upsertAgent(previous.agents, event.agent),
      attention: [
        ...previous.attention.filter((item) => item.agentId !== event.agent.id),
        ...event.attention,
      ].sort((left, right) => right.createdAt - left.createdAt),
    };
  }
  if (event.kind === "message" || event.kind === "message.patch") {
    const current = previous.messages[event.agent.id] ?? [];
    const exactIndex = current.findIndex((message) => message.id === event.message.id);
    let nextMessages: ChatMessage[];
    if (exactIndex >= 0) {
      nextMessages = current.map((message, index) => index === exactIndex ? event.message : message);
    } else if (event.kind === "message" && event.message.role === "user") {
      const optimisticIndex = current.findLastIndex((message) =>
        Boolean(message.clientMessageId) &&
        message.role === "user" &&
        message.text === event.message.text &&
        Math.abs(message.createdAt - event.message.createdAt) < 120_000,
      );
      nextMessages = optimisticIndex >= 0
        ? current.map((message, index) => index === optimisticIndex
          ? { ...event.message, clientMessageId: message.clientMessageId }
          : message)
        : [...current, event.message];
    } else {
      nextMessages = [...current, event.message];
    }
    const settlesAssistantText = event.message.role === "agent" && event.message.kind === "text";
    return {
      ...previous,
      agents: upsertAgent(previous.agents, event.agent),
      attention: [
        ...previous.attention.filter((item) => item.agentId !== event.agent.id),
        ...event.attention,
      ].sort((left, right) => right.createdAt - left.createdAt),
      messages: { ...previous.messages, [event.agent.id]: nextMessages },
      streaming: settlesAssistantText ? withoutKey(previous.streaming, event.agent.id) : previous.streaming,
    };
  }
  if (event.kind === "content.delta") {
    // Token deltas are folded by StreamDeltaBatcher before reaching here.
    return previous;
  }
  if (event.kind === "turn.started") {
    return {
      ...previous,
      agents: previous.agents.map((agent) => agent.id === event.agentId ? { ...agent, presence: "working" as const } : agent),
      streaming: { ...previous.streaming, [event.agentId]: "" },
    };
  }
  if (event.kind === "runtime.error") {
    return {
      ...previous,
      agents: previous.agents.map((agent) => agent.id === event.agentId ? { ...agent, presence: "error" as const } : agent),
    };
  }
  if (event.kind !== "turn.completed") return previous;
  return {
    ...previous,
    agents: previous.agents.map((agent) => agent.id === event.agentId
      ? { ...agent, presence: event.ok ? ("success" as const) : ("error" as const) }
      : agent),
    streaming: withoutKey(previous.streaming, event.agentId),
  };
}

function delayWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export function CumeaProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CumeaState>(initialState);
  const stateRef = useRef(state);
  const clientRef = useRef<HostClient | null>(null);
  const pagingRequests = useRef(new Map<string, symbol>());
  const demoTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const deltaBatcher = useRef<StreamDeltaBatcher | null>(null);
  if (deltaBatcher.current === null) {
    deltaBatcher.current = new StreamDeltaBatcher((deltas) => {
      setState((current) => {
        const streaming = { ...current.streaming };
        let changed = false;
        for (const [agentId, delta] of Object.entries(deltas)) {
          if (!current.agents.some((agent) => agent.id === agentId)) continue;
          streaming[agentId] = `${streaming[agentId] ?? ""}${delta}`;
          changed = true;
        }
        return changed ? { ...current, streaming } : current;
      });
    });
  }
  stateRef.current = state;

  const flushBufferedDeltas = useCallback((agentId?: string) => {
    deltaBatcher.current?.flush(agentId);
  }, []);

  const setError = useCallback((reason: unknown) => {
    setState((current) => ({ ...current, error: reason instanceof Error ? reason.message : String(reason) }));
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([onboardingComplete(), readEnrollment()])
      .then(([onboarded, enrollment]) => {
        if (!alive) return;
        if (!onboarded) {
          setState((current) => ({ ...current, phase: "onboarding", enrollment }));
        } else if (!enrollment) {
          setState((current) => ({ ...current, phase: "pairing" }));
        } else if (enrollment.mode === "demo") {
          setState((current) => ({
            ...applySnapshot(current, DEMO_SNAPSHOT),
            phase: "ready",
            connection: "demo",
            enrollment,
            messages: DEMO_MESSAGES,
            messagePaging: demoPaging(DEMO_SNAPSHOT.agents),
          }));
        } else {
          setState((current) => ({ ...current, phase: "ready", connection: "connecting", enrollment }));
        }
      })
      .catch(setError);
    return () => {
      alive = false;
      flushBufferedDeltas();
      deltaBatcher.current?.clear();
      for (const timer of demoTimers.current) clearTimeout(timer);
      demoTimers.current.clear();
    };
  }, [flushBufferedDeltas, setError]);

  useEffect(() => {
    const enrollment = state.enrollment;
    if (state.phase !== "ready" || enrollment?.mode !== "host") {
      clientRef.current = null;
      return;
    }
    let cancelled = false;
    let active = AppState.currentState === "active";
    let streamAbort: AbortController | null = null;
    const client = new HostClient(enrollment);
    void syncPushRegistration(enrollment).catch(() => {});
    pagingRequests.current.clear();
    deltaBatcher.current?.clear();
    clientRef.current = client;
    setState((current) => ({ ...current, connection: "connecting" }));

    const beginStreaming = () => {
      if (cancelled || !active || streamAbort) return;
      const controller = new AbortController();
      streamAbort = controller;
      void (async () => {
        let failures = 0;
        while (!cancelled && active && !controller.signal.aborted) {
          const connectedAt = Date.now();
          try {
            await client.streamEvents(async (event) => {
              if (cancelled || controller.signal.aborted) return;
              if (event.kind === "content.delta") {
                deltaBatcher.current?.append(event.agentId, event.delta);
                return;
              }
              if (event.kind === "hello") {
                // The SSE connection is already live while bootstrap reconciles.
                // Frames arriving during this request remain queued by the reader.
                const snapshot = await client.snapshot();
                if (!cancelled && !controller.signal.aborted) {
                  flushBufferedDeltas();
                  setState((current) => ({ ...applySnapshot(current, snapshot), connection: "online", error: null }));
                }
                return;
              }
              if (event.kind === "agent.deleted") {
                deltaBatcher.current?.clear(event.agentId);
                pagingRequests.current.delete(event.agentId);
              } else if (event.kind === "turn.completed" || event.kind === "runtime.error") {
                flushBufferedDeltas(event.agentId);
              } else if (
                (event.kind === "message" || event.kind === "message.patch") &&
                event.message.role === "agent" && event.message.kind === "text"
              ) {
                flushBufferedDeltas(event.agent.id);
              } else if (event.kind === "turn.started") {
                deltaBatcher.current?.clear(event.agentId);
              }
              setState((current) => foldHostEvent(current, event));
            }, controller.signal);
          } catch (error) {
            if (cancelled || controller.signal.aborted) break;
            setError(error);
            setState((current) => ({ ...current, connection: "offline" }));
          }
          if (cancelled || !active || controller.signal.aborted) break;
          failures = Date.now() - connectedAt > 10_000 ? 0 : failures + 1;
          const backoff = Math.min(15_000, 750 * 2 ** Math.min(failures, 5));
          const jittered = Math.round(backoff * (0.8 + Math.random() * 0.4));
          await delayWithSignal(jittered, controller.signal);
          if (!controller.signal.aborted) setState((current) => ({ ...current, connection: "connecting" }));
        }
      })().finally(() => {
        if (streamAbort === controller) streamAbort = null;
        if (!cancelled && active) beginStreaming();
      });
    };

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      active = nextState === "active";
      if (!active) {
        flushBufferedDeltas();
        streamAbort?.abort();
        streamAbort = null;
      } else {
        setState((current) => ({ ...current, connection: "connecting" }));
        beginStreaming();
      }
    });
    beginStreaming();
    return () => {
      cancelled = true;
      flushBufferedDeltas();
      deltaBatcher.current?.clear();
      pagingRequests.current.clear();
      streamAbort?.abort();
      streamAbort = null;
      appStateSubscription.remove();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [flushBufferedDeltas, setError, state.enrollment, state.phase]);

  const finishOnboarding = useCallback(async () => {
    await markOnboardingComplete();
    setState((current) => ({ ...current, phase: "pairing" }));
  }, []);

  const pair = useCallback(async (input: PairingClaimInput) => {
    const enrollment = await claimPairing(input);
    await writeEnrollment(enrollment);
    void syncPushRegistration(enrollment).catch(() => {});
    deltaBatcher.current?.clear();
    pagingRequests.current.clear();
    setState({ ...initialState, enrollment, phase: "ready", connection: "connecting", error: null });
    if (process.env.EXPO_OS === "ios") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const enterDemo = useCallback(async () => {
    const enrollment: Enrollment = { mode: "demo" };
    await writeEnrollment(enrollment);
    deltaBatcher.current?.clear();
    pagingRequests.current.clear();
    setState({
      ...applySnapshot({ ...initialState, phase: "ready" }, DEMO_SNAPSHOT),
      phase: "ready",
      connection: "demo",
      enrollment,
      messages: DEMO_MESSAGES,
      messagePaging: demoPaging(DEMO_SNAPSHOT.agents),
      error: null,
    });
  }, []);

  const disconnect = useCallback(async () => {
    await disablePushNotifications(stateRef.current.enrollment).catch(() => {});
    await clearEnrollment();
    flushBufferedDeltas();
    deltaBatcher.current?.clear();
    pagingRequests.current.clear();
    setState({ ...initialState, phase: "pairing" });
  }, [flushBufferedDeltas]);

  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const snapshot = await client.snapshot();
      flushBufferedDeltas();
      setState((current) => ({ ...applySnapshot(current, snapshot), connection: "online", error: null }));
    } catch (error) {
      setError(error);
      setState((current) => ({ ...current, connection: "offline" }));
    }
  }, [flushBufferedDeltas, setError]);

  const requestMessagePage = useCallback(async (agentId: string, before: string | null, initialize: boolean) => {
    const client = clientRef.current;
    if (!client || pagingRequests.current.has(agentId)) return;
    const token = Symbol(agentId);
    pagingRequests.current.set(agentId, token);
    setState((current) => {
      if (!current.agents.some((agent) => agent.id === agentId)) return current;
      const paging = current.messagePaging[agentId] ?? UNINITIALIZED_MESSAGE_PAGING;
      return {
        ...current,
        messagePaging: { ...current.messagePaging, [agentId]: { ...paging, loading: true } },
      };
    });
    try {
      const page = await client.messages(agentId, before);
      if (clientRef.current !== client || pagingRequests.current.get(agentId) !== token) return;
      setState((current) => {
        if (!current.agents.some((agent) => agent.id === agentId)) return current;
        return {
          ...current,
          messages: {
            ...current.messages,
            [agentId]: mergeMessages(current.messages[agentId] ?? [], page.messages),
          },
          agents: current.agents.map((agent) => agent.id === agentId
            ? { ...agent, activeLeafId: page.activeLeafId }
            : agent),
          messagePaging: {
            ...current.messagePaging,
            [agentId]: pagingAfterPage(current.messagePaging[agentId], page.nextCursor, initialize),
          },
        };
      });
    } catch (error) {
      if (clientRef.current !== client || pagingRequests.current.get(agentId) !== token) return;
      setError(error);
      setState((current) => {
        if (!current.messagePaging[agentId]) return current;
        return {
          ...current,
          messagePaging: {
            ...current.messagePaging,
            [agentId]: { ...current.messagePaging[agentId], loading: false },
          },
        };
      });
    } finally {
      if (pagingRequests.current.get(agentId) === token) pagingRequests.current.delete(agentId);
    }
  }, [setError]);

  const ensureMessages = useCallback(async (agentId: string) => {
    const current = stateRef.current;
    const paging = current.messagePaging[agentId] ?? UNINITIALIZED_MESSAGE_PAGING;
    if (paging.initialized || paging.loading || pagingRequests.current.has(agentId)) return;
    if (current.enrollment?.mode === "demo") {
      setState((value) => ({
        ...value,
        messages: { ...value.messages, [agentId]: DEMO_MESSAGES[agentId] ?? [] },
        messagePaging: {
          ...value.messagePaging,
          [agentId]: { cursor: null, initialized: true, hasMore: false, loading: false },
        },
      }));
      return;
    }
    await requestMessagePage(agentId, null, true);
  }, [requestMessagePage]);

  const loadOlderMessages = useCallback(async (agentId: string) => {
    const current = stateRef.current;
    const paging = current.messagePaging[agentId] ?? UNINITIALIZED_MESSAGE_PAGING;
    if (!paging.initialized) {
      await ensureMessages(agentId);
      return;
    }
    if (!paging.hasMore || paging.loading || !paging.cursor || pagingRequests.current.has(agentId)) return;
    await requestMessagePage(agentId, paging.cursor, false);
  }, [ensureMessages, requestMessagePage]);

  const markRead = useCallback((agentId: string) => {
    const agent = stateRef.current.agents.find((candidate) => candidate.id === agentId);
    setState((current) => ({
      ...current,
      agents: current.agents.map((agent) => (agent.id === agentId ? { ...agent, unread: false } : agent)),
    }));
    if (stateRef.current.enrollment?.mode === "host" && agent?.unread) {
      void clientRef.current?.markRead(agentId).catch(setError);
    }
  }, [setError]);

  const sendMessage = useCallback(async (agentId: string, rawText: string, attachments: PendingAttachment[]) => {
    const typedText = rawText.trim();
    if (!typedText && attachments.length === 0) return;
    const text = typedText || "Please review the attached files.";
    const clientMessageId = localId();
    const currentAgent = stateRef.current.agents.find((agent) => agent.id === agentId);
    const willQueue = stateRef.current.enrollment?.mode === "host" && currentAgent?.presence === "working";
    const currentMessages = stateRef.current.messages[agentId] ?? [];
    const parentId = currentAgent?.activeLeafId ?? currentMessages.at(-1)?.id ?? null;
    const optimistic: ChatMessage = {
      id: clientMessageId,
      clientMessageId,
      agentId,
      role: "user",
      kind: "text",
      text,
      createdAt: Date.now(),
      status: "sending",
      parentId,
      attachments: attachments.map((attachment, index) => ({
        id: `${clientMessageId}-attachment-${index}`,
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
      })),
    };
    setState((current) => ({
      ...current,
      messages: { ...current.messages, [agentId]: [...(current.messages[agentId] ?? []), optimistic] },
      agents: current.agents.map((agent) =>
        agent.id === agentId ? {
          ...agent,
          ...(willQueue ? {} : { activeLeafId: clientMessageId }),
          preview: willQueue ? `Queued: ${text}` : text || `Sent ${attachments.length} attachment(s)`,
          updatedAt: Date.now(),
          presence: "working" as const,
        } : agent,
      ),
    }));

    if (stateRef.current.enrollment?.mode === "demo") {
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [agentId]: (current.messages[agentId] ?? []).map((message) =>
            message.id === clientMessageId ? { ...message, status: "done" } : message,
          ),
        },
      }));
      const reply = "This is the local demo stream. Pair your desktop or own VM to run the selected agent and continue working when this phone is offline.";
      const chunks = reply.match(/\S+\s*/g) ?? [reply];
      let index = 0;
      let built = "";
      const tick = () => {
        if (stateRef.current.agents.find((agent) => agent.id === agentId)?.presence !== "working") return;
        built += chunks[index++] ?? "";
        setState((current) => ({ ...current, streaming: { ...current.streaming, [agentId]: built } }));
        if (index < chunks.length) {
          const timer = setTimeout(tick, 45);
          demoTimers.current.add(timer);
        } else {
          const replyId = localId();
          setState((current) => {
            const { [agentId]: _stream, ...streaming } = current.streaming;
            return {
              ...current,
              streaming,
              messages: {
                ...current.messages,
                [agentId]: [
                  ...(current.messages[agentId] ?? []),
                  {
                    id: replyId,
                    parentId: clientMessageId,
                    agentId,
                    role: "agent",
                    kind: "text",
                    text: built.trim(),
                    createdAt: Date.now(),
                    status: "done",
                  },
                ],
              },
              agents: current.agents.map((agent) =>
                agent.id === agentId ? {
                  ...agent,
                  activeLeafId: replyId,
                  presence: "success" as const,
                  preview: built.trim(),
                  updatedAt: Date.now(),
                } : agent,
              ),
            };
          });
        }
      };
      const timer = setTimeout(tick, 220);
      demoTimers.current.add(timer);
      return;
    }

    const client = clientRef.current;
    if (!client) throw new Error("Your Cumea host is offline.");
    const uploaded: ChatAttachment[] = [];
    try {
      for (const attachment of attachments) {
        uploaded.push(await client.uploadAttachment(agentId, attachment));
      }
      if (uploaded.length) {
        setState((current) => ({
          ...current,
          messages: {
            ...current.messages,
            [agentId]: (current.messages[agentId] ?? []).map((message) =>
              message.id === clientMessageId ? { ...message, attachments: uploaded } : message,
            ),
          },
        }));
      }
      const delivery = await client.sendMessage(agentId, text, uploaded.map((attachment) => attachment.id));
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [agentId]: (current.messages[agentId] ?? []).map((message) =>
            message.id === clientMessageId
              ? { ...message, status: "done", delivery: delivery.queued ? "queued" : "sent", taskId: delivery.taskId }
              : message,
          ),
        },
      }));
    } catch (error) {
      // Cleanup is deliberately best-effort: a rollback failure must never
      // replace the upload/send error that the user can actually act on.
      await client.rollbackAttachments(uploaded.map((attachment) => attachment.id));
      setState((current) => ({
        ...current,
        agents: current.agents.map((agent) => agent.id === agentId ? { ...agent, presence: "error" as const } : agent),
        messages: {
          ...current.messages,
          [agentId]: (current.messages[agentId] ?? []).map((message) =>
            message.id === clientMessageId ? { ...message, status: "error", attachments: optimistic.attachments } : message,
          ),
        },
      }));
      setError(error);
      throw error;
    }
  }, [setError]);

  const editMessage = useCallback(async (agentId: string, messageId: string, rawText: string) => {
    const text = rawText.trim();
    if (!text) throw new Error("An edited message cannot be empty.");
    const source = stateRef.current.messages[agentId]?.find((message) => message.id === messageId);
    if (!source || source.role !== "user") throw new Error("That message is no longer editable.");

    if (stateRef.current.enrollment?.mode === "demo") {
      const edited: ChatMessage = {
        ...source,
        id: localId(),
        clientMessageId: undefined,
        parentId: source.parentId ?? null,
        text,
        createdAt: Date.now(),
        status: "done",
      };
      setState((current) => ({
        ...current,
        messages: { ...current.messages, [agentId]: mergeMessages(current.messages[agentId] ?? [], [edited]) },
        agents: current.agents.map((agent) => agent.id === agentId
          ? { ...agent, activeLeafId: edited.id, preview: text, updatedAt: edited.createdAt, presence: "idle" as const }
          : agent),
      }));
      return;
    }

    const client = clientRef.current;
    if (!client) throw new Error("Your Cumea host is offline.");
    const result = await client.editMessage(agentId, messageId, text);
    setState((current) => ({
      ...current,
      messages: { ...current.messages, [agentId]: mergeMessages(current.messages[agentId] ?? [], [result.message]) },
      agents: current.agents.map((agent) => agent.id === agentId
        ? { ...agent, activeLeafId: result.activeLeafId, preview: text, updatedAt: result.message.createdAt, presence: "working" as const }
        : agent),
    }));
  }, []);

  const switchBranch = useCallback(async (agentId: string, messageId: string) => {
    const message = stateRef.current.messages[agentId]?.find((candidate) => candidate.id === messageId);
    if (!message) throw new Error("That conversation version is not loaded.");
    let activeLeafId = newestBranchLeaf(stateRef.current.messages[agentId] ?? [], messageId) ?? messageId;
    if (stateRef.current.enrollment?.mode === "host") {
      const client = clientRef.current;
      if (!client) throw new Error("Your Cumea host is offline.");
      activeLeafId = await client.switchBranch(agentId, messageId);
    }
    setState((current) => {
      const all = current.messages[agentId] ?? [];
      const branch = visibleBranch(all, activeLeafId);
      const last = branch.at(-1);
      return {
        ...current,
        agents: current.agents.map((candidate) => candidate.id === agentId
          ? {
            ...candidate,
            activeLeafId,
            preview: last?.text || candidate.preview,
            updatedAt: last?.createdAt ?? candidate.updatedAt,
            presence: "idle" as const,
          }
          : candidate),
        error: null,
      };
    });
  }, []);

  const interrupt = useCallback(async (agentId: string) => {
    flushBufferedDeltas(agentId);
    if (stateRef.current.enrollment?.mode === "demo") {
      setState((current) => {
        const { [agentId]: _stream, ...streaming } = current.streaming;
        return { ...current, streaming, agents: current.agents.map((agent) => agent.id === agentId ? { ...agent, presence: "idle" as const } : agent) };
      });
      return;
    }
    await clientRef.current?.interrupt(agentId);
    setState((current) => {
      const { [agentId]: _stream, ...streaming } = current.streaming;
      return {
        ...current,
        streaming,
        agents: current.agents.map((agent) => agent.id === agentId ? { ...agent, presence: "idle" as const } : agent),
      };
    });
  }, [flushBufferedDeltas]);

  const respondAttention = useCallback(async (item: AttentionItem, choice: AttentionItem["choices"][number]) => {
    const resumesHostTurn = stateRef.current.enrollment?.mode === "host";
    if (resumesHostTurn) await clientRef.current?.respond(item, choice);
    setState((current) => {
      const attention = current.attention.filter((candidate) => candidate.id !== item.id);
      const stillWaiting = attention.some((candidate) => candidate.agentId === item.agentId);
      return {
        ...current,
        attention,
        agents: current.agents.map((agent) =>
          agent.id === item.agentId
            ? { ...agent, needsYou: stillWaiting, presence: stillWaiting ? ("needs-you" as const) : resumesHostTurn ? ("working" as const) : ("idle" as const) }
            : agent,
        ),
      };
    });
    if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync();
  }, []);

  const toggleRoutine = useCallback(async (routine: RoutineSummary) => {
    const optimistic = { ...routine, enabled: !routine.enabled };
    setState((current) => ({ ...current, routines: current.routines.map((item) => item.id === routine.id ? optimistic : item) }));
    if (stateRef.current.enrollment?.mode !== "host") return;
    try {
      const updated = await clientRef.current?.patchRoutine(routine.id, { enabled: optimistic.enabled });
      if (updated) setState((current) => ({ ...current, routines: current.routines.map((item) => item.id === routine.id ? updated : item) }));
    } catch (reason) {
      setState((current) => ({ ...current, routines: current.routines.map((item) => item.id === routine.id ? routine : item) }));
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [setError]);

  const updateRoutine = useCallback(async (
    routine: RoutineSummary,
    patch: { name?: string; prompt?: string; schedule?: RoutineSchedule; enabled?: boolean },
  ) => {
    if (stateRef.current.enrollment?.mode === "host") {
      const updated = await clientRef.current?.patchRoutine(routine.id, patch);
      if (!updated) throw new Error("Your Cumea host is offline.");
      setState((current) => ({ ...current, routines: current.routines.map((item) => item.id === routine.id ? updated : item) }));
      return;
    }
    const { schedule, ...fields } = patch;
    setState((current) => ({
      ...current,
      routines: current.routines.map((item) => item.id === routine.id ? { ...item, ...fields, scheduleSpec: schedule ?? item.scheduleSpec } : item),
    }));
  }, []);

  const runRoutine = useCallback(async (routine: RoutineSummary) => {
    if (stateRef.current.enrollment?.mode === "host") {
      const client = clientRef.current;
      if (!client) throw new Error("Your Cumea host is offline.");
      await client.runRoutine(routine.id);
    }
    setState((current) => ({
      ...current,
      routines: current.routines.map((item) => item.id === routine.id ? { ...item, lastStatus: "queued" as const } : item),
    }));
  }, []);

  const routineOccurrences = useCallback(async (from: number, to: number): Promise<RoutineOccurrence[]> => {
    if (stateRef.current.enrollment?.mode === "host") {
      const client = clientRef.current;
      if (!client) throw new Error("Your Cumea host is offline.");
      return client.routineOccurrences(from, to);
    }
    return stateRef.current.routines.flatMap((routine) =>
      routine.enabled && routine.nextRunAt !== null && routine.nextRunAt >= from && routine.nextRunAt <= to
        ? [{ routineId: routine.id, scheduledFor: routine.nextRunAt }]
        : [],
    );
  }, []);

  const createAgent = useCallback(async (name: string, role: string, options: { temporary?: boolean } = {}): Promise<AgentSummary> => {
    if (stateRef.current.enrollment?.mode === "host") {
      const client = clientRef.current;
      if (!client) throw new Error("Your Cumea host is offline.");
      const agent = await client.createAgent(name, role, options);
      setState((current) => ({
        ...current,
        agents: upsertAgent(current.agents, agent),
        messages: current.messages[agent.id] ? current.messages : { ...current.messages, [agent.id]: [] },
        messagePaging: current.messagePaging[agent.id]
          ? current.messagePaging
          : { ...current.messagePaging, [agent.id]: { ...UNINITIALIZED_MESSAGE_PAGING } },
      }));
      return agent;
    }
    const colors = ["#19ae7a", "#2f8de3", "#7651d6", "#f56a16"];
    const agent: AgentSummary = {
      id: localId(), threadId: localId(), name, role, preview: "Ready when you are.", updatedAt: Date.now(), unread: false,
      needsYou: false, presence: "idle", queuedCount: 0, avatar: { version: 1, kind: "mote", shapeId: "orb", color: colors[stateRef.current.agents.length % colors.length], motion: "playful" },
      ...(options.temporary ? { lifecycle: { kind: "temporary" as const, expiresAt: Date.now() + 24 * 60 * 60_000 } } : {}),
    };
    setState((current) => ({
      ...current,
      agents: [agent, ...current.agents],
      messages: { ...current.messages, [agent.id]: [] },
      messagePaging: {
        ...current.messagePaging,
        [agent.id]: { cursor: null, initialized: true, hasMore: false, loading: false },
      },
    }));
    return agent;
  }, []);

  const makeAgentPermanent = useCallback(async (agentId: string) => {
    if (stateRef.current.enrollment?.mode === "host") {
      const client = clientRef.current;
      if (!client) throw new Error("Your Cumea host is offline.");
      const agent = await client.makeAgentPermanent(agentId);
      setState((current) => ({ ...current, agents: upsertAgent(current.agents, agent) }));
      return;
    }
    setState((current) => ({
      ...current,
      agents: current.agents.map((agent) => agent.id === agentId ? { ...agent, lifecycle: undefined } : agent),
    }));
  }, []);

  const startContext = useCallback(async (agentId: string) => {
    if (stateRef.current.enrollment?.mode === "host") {
      const client = clientRef.current;
      if (!client) throw new Error("Your Cumea host is offline.");
      await client.startContext(agentId);
      return;
    }
    const now = Date.now();
    const context = { id: localId(), label: "New task", startedAt: now };
    setState((current) => ({
      ...current,
      agents: current.agents.map((agent) => agent.id === agentId ? { ...agent, context } : agent),
      messages: {
        ...current.messages,
        [agentId]: [...(current.messages[agentId] ?? []), {
          id: localId(), agentId, role: "system", kind: "context", text: context.label, createdAt: now, status: "done",
        }],
      },
    }));
  }, []);

  const cancelQueued = useCallback(async (taskId: string) => {
    if (stateRef.current.enrollment?.mode !== "host") return;
    const client = clientRef.current;
    if (!client) throw new Error("Your Cumea host is offline.");
    await client.cancelQueued(taskId);
  }, []);

  const actions = useMemo<CumeaActions>(() => ({
    finishOnboarding,
    pair,
    enterDemo,
    disconnect,
    refresh,
    ensureMessages,
    loadOlderMessages,
    markRead,
    sendMessage,
    editMessage,
    switchBranch,
    interrupt,
    respondAttention,
    toggleRoutine,
    updateRoutine,
    runRoutine,
    routineOccurrences,
    createAgent,
    makeAgentPermanent,
    startContext,
    cancelQueued,
    clearError: () => setState((current) => ({ ...current, error: null })),
  }), [cancelQueued, createAgent, disconnect, editMessage, ensureMessages, enterDemo, finishOnboarding, interrupt, loadOlderMessages, makeAgentPermanent, markRead, pair, refresh, respondAttention, routineOccurrences, runRoutine, sendMessage, startContext, switchBranch, toggleRoutine, updateRoutine]);

  const value = useMemo(() => ({ state, actions }), [actions, state]);
  return <CumeaContext value={value}>{children}</CumeaContext>;
}

export function useCumea() {
  const context = use(CumeaContext);
  if (!context) throw new Error("useCumea must be used inside CumeaProvider");
  return context;
}
