// Server-backed store. The React app holds no transports of its own:
// it dispatches typed commands over HTTP and folds the one SSE event
// stream from the harness server into local state. The reducer stays
// pure; everything async lives in the wrapped dispatch + SSE fold.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { CumeaColor, CumeaExpression, CumeaMotion } from "@/lib/mascot";
import type { BotAvatarConfig } from "@/lib/mote";
import { cardResponseDecision } from "./response-decision";

export type { CumeaColor } from "@/lib/mascot";

export interface OptionCardData {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
  /** Present when this card is a live provider ask (approval/question). */
  requestId?: string;
  requestType?: "permission" | "question";
  tool?: string;
}

export interface AttachmentRef {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface HandoffData {
  fromBotId: string;
  fromName: string;
  toBotId: string;
  toName: string;
  prompt: string;
  status: "requested" | "completed" | "failed";
  reply?: string;
}

export interface Message {
  id: string;
  role: "bot" | "user";
  kind: "text" | "options" | "activity" | "screen" | "handoff";
  text?: string;
  card?: OptionCardData;
  attachments?: AttachmentRef[];
  handoff?: HandoffData;
  /** activity messages: tool name + outcome */
  tool?: { name: string; ok?: boolean };
  /** screen messages: a frame of the bot's computer (base64) */
  png?: string;
  mime?: string;
  at: number;
}

export interface ModelSelection {
  instanceId: string;
  model: string;
}

export interface BotLifecycle {
  kind: "temporary";
  expiresAt: number;
}

export interface Bot {
  id: string;
  threadId: string;
  name: string;
  title: string;
  description: string;
  notifications: boolean;
  color: CumeaColor;
  mascotExpression?: CumeaExpression | null;
  avatar?: BotAvatarConfig;
  unread: boolean;
  busy?: boolean;
  modelSelection: ModelSelection;
  /** Where this bot's computer runs; unset = auto (cloud box if one exists, else local). */
  computer?: "cloud" | "local" | "off";
  pinned?: boolean;
  hidden?: boolean;
  sectionId?: string | null;
  appsEnabled?: boolean;
  collaborationEnabled?: boolean;
  approvalPolicy?: "ask" | "allow" | "deny";
  lifecycle?: BotLifecycle | null;
  messages: Message[];
}

export interface SectionRecord {
  id: string;
  name: string;
  createdAt: number;
}

export interface RunStep {
  id: string;
  itemId?: string;
  kind: "tool" | "approval" | "handoff";
  title: string;
  status: "running" | "needs_attention" | "completed" | "failed" | "denied";
  startedAt: number;
  completedAt?: number;
}

export interface RunArtifact {
  id: string;
  kind: "attachment" | "response" | "screen";
  label: string;
  attachmentId?: string;
  messageId?: string;
  mime?: string;
  createdAt: number;
}

export interface TaskRecord {
  id: string;
  botId: string;
  title: string;
  prompt: string;
  source: "message" | "routine" | "handoff";
  sourceBotId?: string;
  routineId?: string;
  status: "queued" | "running" | "needs_attention" | "completed" | "failed" | "cancelled";
  attachmentIds: string[];
  latestRunId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RunRecord {
  id: string;
  taskId: string;
  botId: string;
  routineId?: string;
  turnId?: string;
  status: "running" | "needs_attention" | "completed" | "failed" | "cancelled";
  steps: RunStep[];
  artifacts: RunArtifact[];
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export type RoutineSchedule =
  | { kind: "interval"; everyMinutes: number }
  | { kind: "daily"; time: string; timezone: string }
  | { kind: "weekly"; time: string; timezone: string; weekdays: number[] };

export interface RoutineRecord {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  schedule: RoutineSchedule;
  enabled: boolean;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastStatus?: "running" | "completed" | "failed";
  lastError?: string;
}

export interface WorkspaceSnapshot {
  sections: SectionRecord[];
  attachments: Array<AttachmentRef & { botId: string; threadId: string; createdAt: number }>;
  tasks: TaskRecord[];
  runs: RunRecord[];
  routines: RoutineRecord[];
}

const EMPTY_WORKSPACE: WorkspaceSnapshot = {
  sections: [],
  attachments: [],
  tasks: [],
  runs: [],
  routines: [],
};

/** GET /api/config — configured flags only; secrets are never echoed. */
export interface ConfigStatus {
  xai?: { configured: boolean };
  composio: { configured: boolean; apiKeyConfigured?: boolean };
  box: { configured: boolean };
  /** who's using the app — collected in onboarding, shown in the sidebar */
  profile?: { name: string; email: string };
}

/** One row of GET /api/instances — the model picker's data. */
export interface InstanceInfo {
  instanceId: string;
  driverKind: string;
  displayName: string;
  snapshot: {
    state: "available" | "unavailable";
    reason?: string;
    authenticated?: boolean;
    version?: string | null;
  };
  models: { default: string; options: Array<{ id: string; label: string }> };
  capabilities: {
    sessionModelSwitch: "in-session" | "unsupported";
    agentsMcp?: boolean;
    composioMcp?: boolean;
    localComputerMcp?: boolean;
    cloudComputerMcp?: boolean;
  };
}

interface AppState {
  bots: Bot[];
  instances: InstanceInfo[];
  config: ConfigStatus | null;
  selectedId: string;
  settingsOpen: boolean;
  pluginsOpen: boolean;
  computerOpen: boolean;
  appSettingsOpen: boolean;
  workOpen: boolean;
  workTab: "attention" | "activity" | "routines" | "sections";
  workspace: WorkspaceSnapshot;
  /** in-flight assistant text per threadId (content.delta fold) */
  streaming: Record<string, string>;
  /** latest live frame of a bot's computer, per botId */
  screens: Record<string, { png: string; mime: string }>;
  /** bots whose cloud computer is being provisioned */
  provisioning: Record<string, boolean>;
  connected: boolean;
  error: string | null;
  mascotMotion: {
    botId: string;
    nonce: number;
    kind: Exclude<CumeaMotion, "none">;
  } | null;
}

type Action =
  | { type: "hydrate"; bots: Bot[] }
  | { type: "instances"; instances: InstanceInfo[] }
  | { type: "configStatus"; config: ConfigStatus }
  | { type: "workspaceHydrated"; workspace: WorkspaceSnapshot }
  | { type: "select"; id: string }
  | { type: "cardAnswered"; botId: string; messageId: string; answer: string }
  | { type: "cardDismissed"; botId: string; messageId: string }
  | { type: "newBot"; temporary?: boolean; ttlMinutes?: number }
  | { type: "botAdded"; bot: Bot }
  | { type: "botDeleted"; botId: string }
  | { type: "duplicateBot"; botId: string }
  | { type: "markUnread"; botId: string }
  | { type: "botPatched"; bot: Partial<Bot> & { id: string } }
  | { type: "messageAdded"; threadId: string; message: Message }
  | { type: "messagePatched"; threadId: string; message: Message }
  | { type: "streamDelta"; threadId: string; delta: string }
  | { type: "streamClear"; threadId: string }
  | { type: "screenFrame"; botId: string; png: string; mime: string }
  | { type: "provisioning"; botId: string; on: boolean }
  | { type: "setModel"; botId: string; selection: ModelSelection }
  | { type: "interrupt"; botId: string }
  | { type: "connected"; value: boolean }
  | { type: "error"; message: string | null }
  | { type: "toggleSettings"; open?: boolean }
  | { type: "togglePlugins"; open?: boolean }
  | { type: "toggleComputer"; open?: boolean }
  | { type: "toggleAppSettings"; open?: boolean }
  | { type: "toggleWork"; open?: boolean; tab?: "attention" | "activity" | "routines" | "sections" }
  | { type: "previewMascotMotion"; botId: string; kind: Exclude<CumeaMotion, "none"> }
  | {
      type: "updateBot";
      botId: string;
      patch: Partial<
        Pick<
          Bot,
          | "name"
          | "title"
          | "description"
          | "notifications"
          | "computer"
          | "color"
          | "mascotExpression"
          | "avatar"
          | "pinned"
          | "hidden"
          | "sectionId"
          | "appsEnabled"
          | "collaborationEnabled"
          | "approvalPolicy"
        >
      >;
    };

function updateBot(state: AppState, botId: string, fn: (b: Bot) => Bot): AppState {
  return { ...state, bots: state.bots.map((b) => (b.id === botId ? fn(b) : b)) };
}

function withMascotMotion(
  state: AppState,
  botId: string,
  kind: Exclude<CumeaMotion, "none">,
): AppState {
  return {
    ...state,
    mascotMotion: {
      botId,
      nonce: (state.mascotMotion?.nonce ?? 0) + 1,
      kind,
    },
  };
}

function patchCard(state: AppState, botId: string, messageId: string, patch: Partial<OptionCardData>): AppState {
  return updateBot(state, botId, (b) => ({
    ...b,
    messages: b.messages.map((m) =>
      m.id === messageId && m.card ? { ...m, card: { ...m.card, ...patch } } : m,
    ),
  }));
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate": {
      const selectedId =
        action.bots.some((b) => b.id === state.selectedId) && state.selectedId
          ? state.selectedId
          : (action.bots[0]?.id ?? "");
      return { ...state, bots: action.bots, selectedId };
    }
    case "instances":
      return { ...state, instances: action.instances };
    case "configStatus":
      return { ...state, config: action.config };
    case "workspaceHydrated":
      return { ...state, workspace: action.workspace };
    case "select":
      return updateBot(
        withMascotMotion({ ...state, selectedId: action.id }, action.id, "switch"),
        action.id,
        (b) => ({ ...b, unread: false }),
      );
    // These actions are only dispatched after the host accepts the response.
    // The host's message.patch event remains the durable source of truth.
    case "cardAnswered":
      return withMascotMotion(
        patchCard(state, action.botId, action.messageId, { answered: action.answer }),
        action.botId,
        "working",
      );
    case "cardDismissed":
      return patchCard(state, action.botId, action.messageId, { dismissed: true });
    case "botAdded":
      return withMascotMotion({
        ...state,
        bots: [action.bot, ...state.bots],
        selectedId: action.bot.id,
      }, action.bot.id, "arrive");
    case "botDeleted": {
      const deleted = state.bots.find((bot) => bot.id === action.botId);
      const bots = state.bots.filter((b) => b.id !== action.botId);
      const selectedId =
        state.selectedId === action.botId ? (bots.find((b) => !b.hidden)?.id ?? bots[0]?.id ?? "") : state.selectedId;
      const { [action.botId]: _screen, ...screens } = state.screens;
      const { [action.botId]: _provisioning, ...provisioning } = state.provisioning;
      const streaming = { ...state.streaming };
      if (deleted) delete streaming[deleted.threadId];
      return {
        ...state,
        bots,
        selectedId,
        screens,
        provisioning,
        streaming,
        workspace: {
          ...state.workspace,
          attachments: state.workspace.attachments.filter((attachment) => attachment.botId !== action.botId),
          tasks: state.workspace.tasks.filter((task) => task.botId !== action.botId),
          runs: state.workspace.runs.filter((run) => run.botId !== action.botId),
          routines: state.workspace.routines.filter((routine) => routine.botId !== action.botId),
        },
        mascotMotion: state.mascotMotion?.botId === action.botId ? null : state.mascotMotion,
      };
    }
    case "markUnread":
      return updateBot(withMascotMotion(state, action.botId, "surprise"), action.botId, (b) => ({ ...b, unread: true }));
    case "botPatched": {
      const before = state.bots.find((b) => b.id === action.bot.id);
      const kind =
        action.bot.unread && !before?.unread
          ? "surprise"
          : action.bot.busy === true && !before?.busy
            ? "working"
            : action.bot.busy === false && before?.busy
              ? "celebrate"
              : null;
      const next = kind ? withMascotMotion(state, action.bot.id, kind) : state;
      return updateBot(next, action.bot.id, (b) => ({ ...b, ...action.bot, messages: b.messages }));
    }
    case "messageAdded": {
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      if (!bot) return state;
      const next = updateBot(state, bot.id, (b) =>
        b.messages.some((m) => m.id === action.message.id)
          ? b
          : { ...b, messages: [...b.messages, action.message] },
      );
      const motion =
        action.message.kind === "options"
          ? "thinking"
          : action.message.kind === "activity"
            ? action.message.tool?.ok === false
              ? "failure"
              : action.message.tool?.ok === true
                ? "success"
                : "working"
            : action.message.role === "bot" && action.message.kind === "text"
              ? "blink"
              : null;
      const animated = motion ? withMascotMotion(next, bot.id, motion) : next;
      // a settled assistant bubble replaces the in-flight stream
      if (action.message.role === "bot" && action.message.kind === "text") {
        const { [action.threadId]: _, ...rest } = animated.streaming;
        return { ...animated, streaming: rest };
      }
      return animated;
    }
    case "messagePatched": {
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      if (!bot) return state;
      const motion =
        action.message.kind === "activity"
          ? action.message.tool?.ok === false
            ? "failure"
            : action.message.tool?.ok === true
              ? "success"
              : "working"
          : null;
      const next = motion ? withMascotMotion(state, bot.id, motion) : state;
      return updateBot(next, bot.id, (b) => ({
        ...b,
        messages: b.messages.map((m) => (m.id === action.message.id ? action.message : m)),
      }));
    }
    case "streamDelta":
      return {
        ...state,
        streaming: {
          ...state.streaming,
          [action.threadId]: (state.streaming[action.threadId] ?? "") + action.delta,
        },
      };
    case "streamClear": {
      const { [action.threadId]: _, ...rest } = state.streaming;
      return { ...state, streaming: rest };
    }
    case "screenFrame":
      return {
        ...withMascotMotion(state, action.botId, "success"),
        screens: { ...state.screens, [action.botId]: { png: action.png, mime: action.mime } },
        provisioning: { ...state.provisioning, [action.botId]: false },
      };
    case "provisioning":
      return {
        ...(action.on ? withMascotMotion(state, action.botId, "launch") : state),
        provisioning: { ...state.provisioning, [action.botId]: action.on },
      };
    case "setModel":
      return updateBot(state, action.botId, (b) => ({ ...b, modelSelection: action.selection }));
    case "connected":
      return { ...state, connected: action.value };
    case "error":
      return {
        ...(action.message && state.selectedId
          ? withMascotMotion(state, state.selectedId, "alert")
          : state),
        error: action.message,
      };
    // bot settings, the computer panel, and app settings share the right slot
    case "toggleSettings": {
      const open = action.open ?? !state.settingsOpen;
      return {
        ...state,
        settingsOpen: open,
        computerOpen: open ? false : state.computerOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
        workOpen: open ? false : state.workOpen,
      };
    }
    case "togglePlugins":
      return { ...state, pluginsOpen: action.open ?? !state.pluginsOpen };
    case "toggleComputer": {
      const open = action.open ?? !state.computerOpen;
      return {
        ...state,
        computerOpen: open,
        settingsOpen: open ? false : state.settingsOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
        workOpen: open ? false : state.workOpen,
      };
    }
    case "toggleAppSettings": {
      const open = action.open ?? !state.appSettingsOpen;
      return {
        ...state,
        appSettingsOpen: open,
        settingsOpen: open ? false : state.settingsOpen,
        computerOpen: open ? false : state.computerOpen,
        pluginsOpen: open ? false : state.pluginsOpen,
        workOpen: open ? false : state.workOpen,
      };
    }
    case "toggleWork": {
      const open = action.open ?? !state.workOpen;
      return {
        ...state,
        workOpen: open,
        workTab: action.tab ?? state.workTab,
        settingsOpen: open ? false : state.settingsOpen,
        computerOpen: open ? false : state.computerOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "previewMascotMotion":
      return withMascotMotion(state, action.botId, action.kind);
    case "updateBot": {
      const mascotChanged =
        Object.prototype.hasOwnProperty.call(action.patch, "color") ||
        Object.prototype.hasOwnProperty.call(action.patch, "mascotExpression") ||
        Object.prototype.hasOwnProperty.call(action.patch, "avatar");
      const next = mascotChanged
        ? withMascotMotion(state, action.botId, "customize")
        : state;
      return updateBot(next, action.botId, (b) => ({ ...b, ...action.patch }));
    }
    case "newBot":
    case "duplicateBot":
    case "interrupt":
      return state;
  }
}

const initialState: AppState = {
  bots: [],
  instances: [],
  config: null,
  selectedId: "",
  settingsOpen: false,
  pluginsOpen: false,
  computerOpen: false,
  appSettingsOpen: false,
  workOpen: false,
  workTab: "attention",
  workspace: EMPTY_WORKSPACE,
  streaming: {},
  screens: {},
  provisioning: {},
  connected: false,
  error: null,
  mascotMotion: null,
};

// ── API client ─────────────────────────────────────────────────────────
export async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

export async function uploadAttachment(
  botId: string,
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<AttachmentRef> {
  const res = await fetch(`/api/bots/${botId}/attachments`, {
    method: "POST",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-file-name": encodeURIComponent(file.name),
    },
    body: file,
    signal: options.signal,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body.attachment as AttachmentRef;
}

const StoreContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
  sendMessage: (input: {
    botId: string;
    text: string;
    attachments?: AttachmentRef[];
    track?: boolean;
  }) => Promise<void>;
  answerCard: (input: { botId: string; messageId: string; answer: string }) => Promise<void>;
  dismissCard: (input: { botId: string; messageId: string }) => Promise<void>;
  deleteBot: (botId: string) => Promise<void>;
  makeBotPermanent: (botId: string) => Promise<void>;
} | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // debounced PATCH per bot for text-field edits (name/title/description)
  const patchTimers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; patch: Record<string, unknown> }>());
  // A local DELETE receives an SSE tombstone before its HTTP response. Hold
  // that event so a failed request never removes the bot from the desktop.
  const pendingBotDeletes = useRef(new Map<string, string>());
  // Browser EventSource can deliver provider token deltas much faster than a
  // paint. Coalesce them to one reducer/context update per animation frame;
  // durable message and turn boundaries flush synchronously below.
  const pendingStreamDeltas = useRef(new Map<string, string>());
  const streamFrame = useRef<number | null>(null);

  const flushStreamDeltas = useCallback((threadId?: string) => {
    if (threadId) {
      const delta = pendingStreamDeltas.current.get(threadId);
      pendingStreamDeltas.current.delete(threadId);
      if (delta) rawDispatch({ type: "streamDelta", threadId, delta });
    } else {
      for (const [id, delta] of pendingStreamDeltas.current) {
        rawDispatch({ type: "streamDelta", threadId: id, delta });
      }
      pendingStreamDeltas.current.clear();
    }
    if (pendingStreamDeltas.current.size === 0 && streamFrame.current !== null) {
      cancelAnimationFrame(streamFrame.current);
      streamFrame.current = null;
    }
  }, []);

  const queueStreamDelta = useCallback((threadId: string, delta: string) => {
    if (!delta) return;
    pendingStreamDeltas.current.set(threadId, `${pendingStreamDeltas.current.get(threadId) ?? ""}${delta}`);
    if (streamFrame.current !== null) return;
    streamFrame.current = requestAnimationFrame(() => {
      streamFrame.current = null;
      flushStreamDeltas();
    });
  }, [flushStreamDeltas]);

  const showError = useCallback((error: unknown) => {
    rawDispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });
    setTimeout(() => rawDispatch({ type: "error", message: null }), 6000);
  }, []);

  const sendMessage = useCallback(async (input: {
    botId: string;
    text: string;
    attachments?: AttachmentRef[];
    track?: boolean;
  }) => {
    try {
      await api(`/api/bots/${input.botId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          text: input.text,
          attachmentIds: input.attachments?.map((attachment) => attachment.id) ?? [],
          track: input.track,
        }),
      });
      rawDispatch({ type: "previewMascotMotion", botId: input.botId, kind: "working" });
    } catch (error) {
      showError(error);
      throw error;
    }
  }, [showError]);

  const answerCard = useCallback(async (input: {
    botId: string;
    messageId: string;
    answer: string;
  }) => {
    try {
      const bot = stateRef.current.bots.find((candidate) => candidate.id === input.botId);
      const card = bot?.messages.find((message) => message.id === input.messageId)?.card;
      if (!card || card.answered || card.dismissed) {
        throw new Error("This request is no longer available.");
      }

      if (card.requestId) {
        const decision = cardResponseDecision(card.requestType, input.answer);
        await api(`/api/bots/${input.botId}/respond`, {
          method: "POST",
          body: JSON.stringify({
            requestId: card.requestId,
            ...decision,
          }),
        });
        rawDispatch({ type: "cardAnswered", ...input });
        return;
      }

      await api(`/api/bots/${input.botId}/cards/${input.messageId}`, {
        method: "PATCH",
        body: JSON.stringify({ answered: input.answer }),
      });
      rawDispatch({ type: "cardAnswered", ...input });

      // Onboarding answers are also conversational turns. The card is already
      // durably settled if this second request fails, so keep that host-confirmed
      // state while still surfacing the delivery error.
      await api(`/api/bots/${input.botId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: input.answer, track: false }),
      });
    } catch (error) {
      showError(error);
      throw error;
    }
  }, [showError]);

  const dismissCard = useCallback(async (input: { botId: string; messageId: string }) => {
    try {
      const bot = stateRef.current.bots.find((candidate) => candidate.id === input.botId);
      const card = bot?.messages.find((message) => message.id === input.messageId)?.card;
      if (!card || card.answered || card.dismissed) {
        throw new Error("This request is no longer available.");
      }

      if (card.requestId) {
        await api(`/api/bots/${input.botId}/respond`, {
          method: "POST",
          body: JSON.stringify({
            requestId: card.requestId,
            behavior: card.requestType === "permission" ? "deny" : "answer",
            message: "Dismissed by user.",
          }),
        });
      } else {
        await api(`/api/bots/${input.botId}/cards/${input.messageId}`, {
          method: "PATCH",
          body: JSON.stringify({ dismissed: true }),
        });
      }
      rawDispatch({ type: "cardDismissed", ...input });
    } catch (error) {
      showError(error);
      throw error;
    }
  }, [showError]);

  const deleteBot = useCallback(async (botId: string) => {
    if (pendingBotDeletes.current.has(botId)) return;
    const operationId = crypto.randomUUID();
    pendingBotDeletes.current.set(botId, operationId);
    try {
      await api(`/api/bots/${botId}`, {
        method: "DELETE",
        headers: { "x-cumea-operation-id": operationId },
      });
      const pendingPatch = patchTimers.current.get(botId);
      if (pendingPatch) clearTimeout(pendingPatch.timer);
      patchTimers.current.delete(botId);
      rawDispatch({ type: "botDeleted", botId });
    } catch (error) {
      showError(error);
      throw error;
    } finally {
      if (pendingBotDeletes.current.get(botId) === operationId) {
        pendingBotDeletes.current.delete(botId);
      }
    }
  }, [showError]);

  const makeBotPermanent = useCallback(async (botId: string) => {
    try {
      const { bot } = await api(`/api/bots/${botId}`, {
        method: "PATCH",
        body: JSON.stringify({ temporary: false }),
      });
      // Optional fields omitted by JSON cannot clear a prior reducer value,
      // so carry the lifecycle tombstone explicitly.
      rawDispatch({ type: "botPatched", bot: { ...bot, lifecycle: null } });
    } catch (error) {
      showError(error);
      throw error;
    }
  }, [showError]);

  const dispatch = useMemo(() => {
    const wrapped: React.Dispatch<Action> = (action) => {
      rawDispatch(action);
      switch (action.type) {
        case "newBot":
          api("/api/bots", {
            method: "POST",
            ...(action.temporary
              ? { body: JSON.stringify({ temporary: true, ttlMinutes: action.ttlMinutes }) }
              : {}),
          })
            .then(({ bot }) => rawDispatch({ type: "botAdded", bot }))
            .catch(showError);
          break;
        case "duplicateBot": {
          const source = stateRef.current.bots.find((b) => b.id === action.botId);
          if (!source) break;
          api("/api/bots", { method: "POST" })
            .then(({ bot }) =>
              api(`/api/bots/${bot.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  name: `${source.name} copy`,
                  title: source.title,
                  description: source.description,
                  notifications: source.notifications,
                  modelSelection: source.modelSelection,
                  avatar: source.avatar,
                  ...(source.computer ? { computer: source.computer } : {}),
                  sectionId: source.sectionId ?? null,
                  appsEnabled: source.appsEnabled ?? true,
                  collaborationEnabled: source.collaborationEnabled ?? true,
                  approvalPolicy: source.approvalPolicy ?? "ask",
                }),
              }).then(({ bot: patched }) =>
                rawDispatch({ type: "botAdded", bot: { ...bot, ...patched, messages: bot.messages } }),
              ),
            )
            .catch(showError);
          break;
        }
        case "markUnread":
          api(`/api/bots/${action.botId}`, { method: "PATCH", body: JSON.stringify({ unread: true }) }).catch(
            () => {},
          );
          break;
        case "select": {
          const bot = stateRef.current.bots.find((b) => b.id === action.id);
          if (bot?.unread) {
            api(`/api/bots/${action.id}`, { method: "PATCH", body: JSON.stringify({ unread: false }) }).catch(() => {});
          }
          break;
        }
        case "setModel":
          api(`/api/bots/${action.botId}`, {
            method: "PATCH",
            body: JSON.stringify({ modelSelection: action.selection }),
          }).catch(showError);
          break;
        case "interrupt":
          api(`/api/bots/${action.botId}/interrupt`, { method: "POST" }).catch(showError);
          break;
        case "updateBot": {
          const timers = patchTimers.current;
          const pending = timers.get(action.botId);
          const patch = { ...pending?.patch, ...action.patch };
          if (pending) clearTimeout(pending.timer);
          timers.set(action.botId, {
            patch,
            timer: setTimeout(() => {
              timers.delete(action.botId);
              api(`/api/bots/${action.botId}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(showError);
            }, 400),
          });
          break;
        }
        default:
          break;
      }
    };
    return wrapped;
  }, [showError]);

  // ── initial load + SSE fold ──────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    const loadAll = () => {
      api("/api/bots")
        .then(({ bots }) => alive && rawDispatch({ type: "hydrate", bots }))
        .catch(() => {});
      api("/api/instances")
        .then(({ instances }) => alive && rawDispatch({ type: "instances", instances }))
        .catch(() => {});
      api("/api/config")
        .then((config) => alive && rawDispatch({ type: "configStatus", config }))
        .catch(() => {});
      api("/api/work")
        .then(({ workspace }) => alive && rawDispatch({ type: "workspaceHydrated", workspace }))
        .catch(() => {});
    };
    loadAll();

    const es = new EventSource("/api/events");
    es.onopen = () => {
      rawDispatch({ type: "connected", value: true });
      loadAll(); // resync anything missed while disconnected
    };
    es.onerror = () => rawDispatch({ type: "connected", value: false });
    es.onmessage = (raw) => {
      let frame: any;
      try {
        frame = JSON.parse(raw.data);
      } catch {
        return;
      }
      switch (frame.kind) {
        case "message":
          flushStreamDeltas(frame.threadId);
          rawDispatch({ type: "messageAdded", threadId: frame.threadId, message: frame.message });
          break;
        case "message.patch":
          flushStreamDeltas(frame.threadId);
          rawDispatch({ type: "messagePatched", threadId: frame.threadId, message: frame.message });
          break;
        case "bot": {
          const bot = frame.bot as Partial<Bot> & { id: string };
          // reading the selected chat clears its badge immediately
          if (bot.unread && bot.id === stateRef.current.selectedId) {
            bot.unread = false;
            fetch(`/api/bots/${bot.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ unread: false }),
            }).catch(() => {});
          }
          rawDispatch({ type: "botPatched", bot });
          break;
        }
        case "runtime": {
          const event = frame.event;
          if (event.type === "content.delta" && event.streamKind === "assistant_text") {
            queueStreamDelta(event.threadId, event.delta);
          } else if (event.type === "turn.completed") {
            flushStreamDeltas(event.threadId);
            rawDispatch({ type: "streamClear", threadId: event.threadId });
          }
          break;
        }
        case "screen":
          rawDispatch({ type: "screenFrame", botId: frame.botId, png: frame.png, mime: frame.mime ?? "image/png" });
          break;
        case "computer":
          rawDispatch({ type: "provisioning", botId: frame.botId, on: frame.state === "provisioning" });
          break;
        case "workspace":
          rawDispatch({ type: "workspaceHydrated", workspace: frame.workspace });
          break;
        case "bot.deleted":
          if (
            typeof frame.operationId !== "string"
            || pendingBotDeletes.current.get(frame.botId) !== frame.operationId
          ) {
            rawDispatch({ type: "botDeleted", botId: frame.botId });
          }
          break;
        // a key changed and the fleet hot-reloaded — refresh the picker so
        // newly available providers un-dim immediately
        case "config":
          rawDispatch({
            type: "configStatus",
            config: { xai: frame.xai, composio: frame.composio, box: frame.box, profile: frame.profile },
          });
          api("/api/instances")
            .then(({ instances }) => rawDispatch({ type: "instances", instances }))
            .catch(() => {});
          break;
      }
    };
    return () => {
      alive = false;
      flushStreamDeltas();
      if (streamFrame.current !== null) {
        cancelAnimationFrame(streamFrame.current);
        streamFrame.current = null;
      }
      es.close();
    };
  }, [flushStreamDeltas, queueStreamDelta]);

  const value = useMemo(
    () => ({ state, dispatch, sendMessage, answerCard, dismissCard, deleteBot, makeBotPermanent }),
    [state, dispatch, sendMessage, answerCard, dismissCard, deleteBot, makeBotPermanent],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}

export function formatTime(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
