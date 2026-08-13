export type ShapeId = "orb" | "soft" | "tile" | "capsule" | "peak" | "gem" | "ripple" | "drop";
export type MotionLevel = "calm" | "playful" | "kinetic";
export type AgentPresence = "idle" | "working" | "needs-you" | "success" | "error";

export interface AvatarConfig {
  version: 1;
  kind: "mote" | "upload";
  shapeId: ShapeId;
  color: string;
  eyeColor?: string;
  motion: MotionLevel;
  imageDataUrl?: string;
}

export interface AgentSummary {
  id: string;
  threadId: string;
  name: string;
  role: string;
  preview: string;
  updatedAt: number;
  unread: boolean;
  needsYou: boolean;
  presence: AgentPresence;
  avatar: AvatarConfig;
  lifecycle?: { kind: "temporary"; expiresAt: number };
}

export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  downloadUrl?: string;
}

export interface ChatMessage {
  id: string;
  agentId: string;
  role: "user" | "agent" | "system";
  kind: "text" | "activity" | "approval" | "handoff";
  text: string;
  createdAt: number;
  status?: "sending" | "streaming" | "done" | "error";
  attachments?: ChatAttachment[];
  clientMessageId?: string;
}

export interface PendingAttachment {
  uri: string;
  name: string;
  mime: string;
  size: number;
}

export type HostStreamEvent =
  | { kind: "hello" }
  | { kind: "agent"; agent: AgentSummary; attention: AttentionItem[] }
  | { kind: "agent.deleted"; agentId: string }
  | {
      kind: "message" | "message.patch";
      agent: AgentSummary;
      message: ChatMessage;
      attention: AttentionItem[];
    }
  | { kind: "content.delta"; agentId: string; delta: string }
  | { kind: "turn.started"; agentId: string }
  | { kind: "turn.completed"; agentId: string; ok: boolean }
  | { kind: "runtime.error"; agentId: string; message: string }
  | { kind: "workspace"; routines: RoutineSummary[] };

export interface AttentionItem {
  id: string;
  requestId: string;
  agentId: string;
  agentName: string;
  title: string;
  summary: string;
  choices: string[];
  requestType: "permission" | "question";
  createdAt: number;
}

export interface RoutineSummary {
  id: string;
  agentId: string;
  agentName: string;
  name: string;
  schedule: string;
  enabled: boolean;
  nextRunAt: number | null;
  lastStatus?: "running" | "completed" | "failed";
}

export interface MobileSnapshot {
  hostName?: string;
  profile: { name: string; email?: string };
  capabilities: { computerPreview: boolean };
  agents: AgentSummary[];
  attention: AttentionItem[];
  routines: RoutineSummary[];
  messages?: Record<string, ChatMessage[]>;
  serverTime?: number;
}

export type ComputerPreview =
  | { available: false }
  | { available: true; mime: "image/png" | "image/jpeg"; dataUrl: string; capturedAt: number };

export interface MessagesPage {
  messages: ChatMessage[];
  nextCursor: string | null;
}

export interface PairClaimResponse {
  token: string;
  device: { id: string; name?: string };
  hostUrl: string;
}

export interface PairingClaimInput {
  hostUrl: string;
  sessionId: string;
  secret: string;
}

export type Enrollment =
  | { mode: "demo" }
  | {
      mode: "host";
      hostUrl: string;
      deviceId: string;
      token: string;
    };
