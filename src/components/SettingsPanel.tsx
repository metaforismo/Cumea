import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, Clock3, Crown, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { api, useStore, type Bot } from "@/state/store";
import { CumeaAvatar } from "./Avatar";
import {
  avatarForBot,
  avatarStateForBot,
  DEFAULT_BOT_AVATAR,
  getMoteEyeColor,
  MOTE_COLORS,
  MOTE_MOTION_LEVELS,
  MOTE_SHAPES,
  type BotAvatarConfig,
  type MoteAvatarKind,
} from "@/lib/mote";
import { ModelPicker } from "./ModelPicker";
import { cn } from "@/lib/cn";
import { fetchMcpServers, type PublicMcpServer } from "./McpServers";
import { AgentMemory } from "./AgentMemory";
import { LocalSkills } from "./LocalSkills";
import { approvalRuleBoundary, withoutApprovalRule, type PublicApprovalRule } from "@/state/approval-rules";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[13px] text-ink-secondary">{label}</div>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none focus:border-hairline";

type AvatarTab = "bot" | "generate" | "upload";

function randomItem<T>(items: readonly T[]): T {
  const value = crypto.getRandomValues(new Uint32Array(1))[0];
  return items[value % items.length];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This image could not be decoded."));
    image.src = url;
  });
}

async function resizeAvatarImage(file: File): Promise<string> {
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  if (file.size > 10 * 1024 * 1024) throw new Error("Choose an image smaller than 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const render = (side: number, quality: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image processing is unavailable.");
      const scale = Math.max(side / image.naturalWidth, side / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (side - width) / 2, (side - height) / 2, width, height);
      return canvas.toDataURL("image/webp", quality);
    };
    const first = render(512, 0.84);
    if (first.length <= 720_000) return first;
    const compact = render(384, 0.72);
    if (compact.length <= 720_000) return compact;
    throw new Error("The processed image is still too large. Try a simpler image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function AvatarEditor({
  bot,
  onChange,
}: {
  bot: Bot;
  onChange: (avatar: BotAvatarConfig) => void;
}) {
  const [tab, setTab] = useState<AvatarTab>("bot");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const avatar = avatarForBot(bot);
  const update = (patch: Partial<BotAvatarConfig>, kind: MoteAvatarKind = "mote") =>
    onChange({ ...avatar, ...patch, kind, ...(kind === "mote" ? { imageDataUrl: undefined } : {}) });

  const surprise = () => {
    const shape = randomItem(MOTE_SHAPES);
    const color = randomItem(MOTE_COLORS);
    const motion = randomItem(MOTE_MOTION_LEVELS);
    onChange({ kind: "mote", shapeId: shape.id, color: color.value, motion: motion.id });
  };

  const upload = async (file?: File) => {
    if (!file) return;
    setUploadError(null);
    try {
      const imageDataUrl = await resizeAvatarImage(file);
      onChange({ ...avatar, kind: "upload", imageDataUrl });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error));
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-hairline/40 bg-card">
      <div className="flex items-center justify-between border-b border-hairline/40 px-3 py-2.5">
        <div role="tablist" aria-label="Avatar source" className="flex rounded-lg bg-inset p-0.5">
          {(["bot", "generate", "upload"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[13px] capitalize transition-colors",
                tab === value ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink",
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_BOT_AVATAR })}
          className="rounded-md px-2 py-1.5 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
        >
          Reset
        </button>
      </div>

      <div className="p-3">
        {tab === "bot" ? (
          <div role="tabpanel" className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                Shape
              </legend>
              <div className="grid grid-cols-4 gap-2">
                {MOTE_SHAPES.map((shape) => {
                  const selected = avatar.kind === "mote" && avatar.shapeId === shape.id;
                  return (
                    <button
                      key={shape.id}
                      type="button"
                      aria-label={`${shape.label}: ${shape.description}`}
                      aria-pressed={selected}
                      onClick={() => update({ shapeId: shape.id })}
                      className={cn(
                        "relative flex aspect-square items-center justify-center rounded-xl bg-inset transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0 active:scale-95",
                        selected && "ring-2 ring-accent-border",
                      )}
                    >
                      <CumeaAvatar
                        avatar={{ ...avatar, kind: "mote", shapeId: shape.id, imageDataUrl: undefined }}
                        size={52}
                      />
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                Color
              </legend>
              <div className="flex flex-wrap gap-2.5">
                {MOTE_COLORS.map((color) => {
                  const selected = avatar.color.toLowerCase() === color.value;
                  return (
                    <button
                      key={color.value}
                      type="button"
                      aria-label={color.name}
                      aria-pressed={selected}
                      onClick={() => update({ color: color.value })}
                      className={cn(
                        "relative size-8 rounded-full border-2 border-transparent transition-transform duration-150 hover:scale-110 active:scale-95",
                        selected && "ring-2 ring-accent-border ring-offset-2 ring-offset-card",
                      )}
                      style={{ backgroundColor: color.value }}
                    >
                      {selected ? (
                        <Check
                          size={15}
                          strokeWidth={3}
                          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                          color={getMoteEyeColor(color.value)}
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                Motion
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {MOTE_MOTION_LEVELS.map((level) => (
                  <button
                    key={level.id}
                    type="button"
                    aria-pressed={avatar.motion === level.id}
                    onClick={() => update({ motion: level.id }, avatar.kind)}
                    title={level.description}
                    className={cn(
                      "rounded-lg bg-inset px-2 py-2 text-[12px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink",
                      avatar.motion === level.id && "bg-raised text-ink ring-1 ring-accent-border",
                    )}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        ) : null}

        {tab === "generate" ? (
          <div role="tabpanel" className="flex flex-col items-center py-4 text-center">
            <Sparkles size={24} className="text-ink-secondary" aria-hidden="true" />
            <div className="mt-3 text-[14px] font-medium text-ink">Generate a Mote combination</div>
            <p className="mt-1 max-w-[270px] text-[12px] leading-relaxed text-ink-secondary">
              Shape, color, and motion are generated locally. Nothing leaves your computer.
            </p>
            <button
              type="button"
              onClick={surprise}
              className="mt-4 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-app transition-transform duration-150 active:scale-95"
            >
              Surprise me
            </button>
          </div>
        ) : null}

        {tab === "upload" ? (
          <div role="tabpanel" className="flex flex-col items-center py-4 text-center">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => void upload(event.target.files?.[0])}
            />
            <ImagePlus size={25} className="text-ink-secondary" aria-hidden="true" />
            <div className="mt-3 text-[14px] font-medium text-ink">Use your own image</div>
            <p className="mt-1 max-w-[280px] text-[12px] leading-relaxed text-ink-secondary">
              PNG, JPEG, or WebP up to 10 MB. It is cropped and compressed locally inside your Mote shape.
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-4 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-app transition-transform duration-150 active:scale-95"
            >
              Choose image
            </button>
            {avatar.kind === "upload" ? (
              <button
                type="button"
                onClick={() => update({}, "mote")}
                className="mt-2 rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:text-ink"
              >
                Remove image
              </button>
            ) : null}
            {uploadError ? <div className="mt-2 text-[12px] text-danger">{uploadError}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsPanel({ bot }: { bot: Bot }) {
  const { state, dispatch, makeBotPermanent } = useStore();
  const [convertingLifecycle, setConvertingLifecycle] = useState(false);
  const patch = (
    p: Partial<
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
        | "appsEnabled"
        | "collaborationEnabled"
        | "coordinator"
        | "mcpServerIds"
        | "memoryWriteEnabled"
      >
    >,
  ) => dispatch({ type: "updateBot", botId: bot.id, patch: p });
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;
  const instance = state.instances.find((candidate) => candidate.instanceId === bot.modelSelection.instanceId);
  const capabilities = instance?.capabilities;
  const [mcpServers, setMcpServers] = useState<PublicMcpServer[]>([]);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [approvalRules, setApprovalRules] = useState<PublicApprovalRule[]>([]);
  const [approvalRulesError, setApprovalRulesError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchMcpServers()
      .then((servers) => { if (alive) setMcpServers(servers); })
      .catch((reason) => { if (alive) setMcpError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    setApprovalRulesError(null);
    void api(`/api/bots/${bot.id}/approval-rules`)
      .then((body) => { if (alive) setApprovalRules(Array.isArray(body.rules) ? body.rules : []); })
      .catch((reason) => { if (alive) setApprovalRulesError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, [bot.id]);
  const revokeApprovalRule = async (ruleId: string) => {
    try {
      await api(`/api/bots/${bot.id}/approval-rules/${ruleId}`, { method: "DELETE" });
      setApprovalRules((rules) => withoutApprovalRule(rules, ruleId));
    } catch (reason) {
      setApprovalRulesError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const computerModes = [
    ["cloud", capabilities?.cloudComputerMcp === true],
    ["vm", capabilities?.localComputerMcp === true],
    ["local", capabilities?.localComputerMcp === true],
    ["off", true],
  ] as const;

  return (
    <aside className="animate-panel-in flex h-full w-[400px] shrink-0 flex-col border-l border-hairline/40 bg-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => dispatch({ type: "toggleSettings", open: false })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-[15px] font-semibold text-ink">Settings</span>
        <button
          onClick={() => dispatch({ type: "toggleSettings", open: false })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="flex justify-center py-5">
          <CumeaAvatar
            avatar={avatarForBot(bot)}
            size={112}
            motion={mascotMotion?.kind ?? "none"}
            motionKey={mascotMotion?.nonce ?? 0}
            state={avatarStateForBot(bot)}
            label={`${bot.name} avatar`}
            ambient
          />
        </div>

        <div className="flex flex-col gap-4">
          <AvatarEditor bot={bot} onChange={(avatar) => patch({ avatar })} />

          <Field label="Name">
            <input
              className={inputCls}
              value={bot.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <Field label="Title">
            <input
              className={inputCls}
              placeholder="Describe what your agent does"
              value={bot.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <textarea
              className={cn(inputCls, "min-h-[96px] resize-none")}
              placeholder="What this agent is for"
              value={bot.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </Field>

          <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4">
            <div>
              <div className="text-[15px] font-medium text-ink">Model</div>
              <div className="mt-0.5 text-[13px] text-ink-secondary">
                Which provider and model this bot runs on
              </div>
            </div>
            <ModelPicker bot={bot} />
          </div>

          <div className="rounded-xl bg-card p-4">
            <div className="text-[15px] font-medium text-ink">Computer</div>
            <div className="mt-0.5 text-[13px] text-ink-secondary">
              Where this bot's computer runs{bot.computer ? "" : " (currently: auto)"}
            </div>
            <div className="mt-3 flex overflow-hidden rounded-lg border border-hairline/40">
              {computerModes.map(([mode, supported], i) => (
                <button
                  key={mode}
                  disabled={!supported}
                  onClick={() => patch({ computer: mode })}
                  title={supported ? undefined : `${instance?.displayName ?? "This provider"} does not support ${mode} computer tools`}
                  className={cn(
                    "flex-1 py-1.5 text-[13px] capitalize",
                    i > 0 && "border-l border-hairline/40",
                    !supported && "cursor-not-allowed opacity-35",
                    bot.computer === mode
                      ? "bg-raised text-ink"
                      : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[11px] leading-relaxed text-ink-secondary">
              Availability follows the selected provider. A cloud computer also needs a configured cloud token.
            </div>
          </div>

          <div className="rounded-xl bg-card p-4">
            <div className="text-[15px] font-medium text-ink">Capabilities</div>
            <div className="mt-0.5 text-[13px] text-ink-secondary">Control what this bot can use on each run.</div>
            <div className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-hairline/35 bg-inset p-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <Crown size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                <div>
                  <div className="text-[13px] font-medium text-ink">Workspace Coordinator</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">
                    {bot.lifecycle
                      ? "Quick bots cannot own this durable workspace role."
                      : capabilities?.agentsMcp === true
                        ? "Plans complex work, delegates bounded tasks, and synthesizes the final answer. Enabling this replaces the current Coordinator."
                        : `Unavailable with ${instance?.displayName ?? "this provider"}`}
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={bot.coordinator === true}
                aria-label={`${bot.coordinator ? "Remove" : "Make"} ${bot.name} ${bot.coordinator ? "as" : "the"} workspace Coordinator`}
                disabled={!bot.coordinator && (Boolean(bot.lifecycle) || capabilities?.agentsMcp !== true)}
                onClick={() => patch({ coordinator: !bot.coordinator })}
                className={cn("relative h-[24px] w-[40px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35", bot.coordinator ? "bg-accent" : "bg-raised")}
              >
                <span className={cn("absolute top-[3px] size-[18px] rounded-full bg-white transition-all", bot.coordinator ? "left-[19px]" : "left-[3px]")} />
              </button>
            </div>
            <div className="mt-3 space-y-3 border-t border-hairline/40 pt-3">
              {([
                ["Connected apps", "Use configured app connectors", "appsEnabled"],
                ["Bot collaboration", "List and hand work to other bots", "collaborationEnabled"],
              ] as const).map(([label, description, key]) => {
                const supported = key === "appsEnabled"
                  ? capabilities?.composioMcp === true
                  : capabilities?.agentsMcp === true;
                const checked = bot[key] !== false;
                return (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-medium text-ink">{label}</div>
                      <div className="text-[11px] text-ink-secondary">
                        {supported ? description : `Unavailable with ${instance?.displayName ?? "this provider"}`}
                      </div>
                    </div>
                    <button
                      role="switch"
                      aria-checked={checked}
                      disabled={!supported}
                      onClick={() => patch({ [key]: !checked })}
                      className={cn("relative h-[24px] w-[40px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35", checked ? "bg-accent" : "bg-raised")}
                    >
                      <span className={cn("absolute top-[3px] size-[18px] rounded-full bg-white transition-all", checked ? "left-[19px]" : "left-[3px]")} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 border-t border-hairline/40 pt-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-ink">Local MCP servers</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">
                    {capabilities?.customMcp === true
                      ? "Assign only the local tools this agent needs. Their actions still follow the provider permission flow."
                      : `Unavailable with ${instance?.displayName ?? "this provider"}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "toggleAppSettings", open: true, tab: "connections" })}
                  className="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink"
                >
                  Manage
                </button>
              </div>
              {mcpServers.length ? (
                <div className="mt-3 grid gap-2">
                  {mcpServers.map((server) => {
                    const checked = bot.mcpServerIds?.includes(server.id) === true;
                    const next = checked
                      ? (bot.mcpServerIds ?? []).filter((id) => id !== server.id)
                      : [...(bot.mcpServerIds ?? []), server.id];
                    return (
                      <div key={server.id} className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2">
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] font-medium text-ink">{server.name}</span>
                          <span className="block truncate text-[10.5px] text-ink-secondary">
                            {server.enabled ? server.command : "Disabled in integrations"}
                          </span>
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          aria-label={`${checked ? "Unassign" : "Assign"} ${server.name}`}
                          disabled={capabilities?.customMcp !== true}
                          onClick={() => patch({ mcpServerIds: next })}
                          className={cn("relative h-[24px] w-[40px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35", checked ? "bg-accent" : "bg-raised")}
                        >
                          <span className={cn("absolute top-[3px] size-[18px] rounded-full bg-white transition-all", checked ? "left-[19px]" : "left-[3px]")} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-[10.5px] text-ink-secondary">No local MCP server is configured.</p>
              )}
              {mcpError ? <p role="alert" className="mt-2 text-[10.5px] text-danger">{mcpError}</p> : null}
            </div>
            <div className="mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">Action approvals</div>
            <div className="mt-2 text-[11px] leading-relaxed text-ink-secondary">
              Every new action asks first. “Always allow” and “Never” remember a named tool boundary — and for command tools, one program. Cumea rechecks every request; questions, risky targets, interpreters and transfer commands always come back to you.
            </div>
            {approvalRules.length ? (
              <div className="mt-3 space-y-2" aria-label="Saved action approval rules">
                {approvalRules.map((rule) => (
                  <div key={rule.id} className="flex items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-3 py-2">
                    <span className={cn("size-2 rounded-full", rule.decision === "allow" ? "bg-success" : "bg-danger")} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] text-ink">{approvalRuleBoundary(rule)}</div>
                      <div className="text-[10px] text-ink-secondary">{rule.decision === "allow" ? "Allow" : "Deny"} for this scope</div>
                    </div>
                    <button type="button" onClick={() => void revokeApprovalRule(rule.id)} className="rounded-md px-2 py-1 text-[10.5px] text-ink-secondary hover:bg-raised hover:text-ink" aria-label={`Revoke ${rule.tool} approval rule`}>
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            ) : <div className="mt-3 text-[10.5px] text-ink-secondary">No saved action rules.</div>}
            {approvalRulesError ? <p role="alert" className="mt-2 text-[10.5px] text-danger">{approvalRulesError}</p> : null}
          </div>

          <AgentMemory
            botId={bot.id}
            agentWriteEnabled={bot.memoryWriteEnabled === true}
            canAgentWrite={capabilities?.memoryMcp === true}
            onAgentWriteChange={(enabled) => patch({ memoryWriteEnabled: enabled })}
          />
          <LocalSkills botId={bot.id} />

          {bot.lifecycle ? (
            <div className="rounded-xl border border-accent-border/30 bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Clock3 size={16} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium text-ink">Quick bot</div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
                    Scheduled to expire {new Date(bot.lifecycle.expiresAt).toLocaleString()}. Cleanup waits while it is working,
                    needs approval, or owns a routine.
                  </div>
                  <button
                    type="button"
                    disabled={convertingLifecycle}
                    onClick={() => {
                      setConvertingLifecycle(true);
                      void makeBotPermanent(bot.id)
                        .catch(() => {})
                        .finally(() => setConvertingLifecycle(false));
                    }}
                    className="mt-3 inline-flex min-h-8 items-center gap-2 rounded-lg border border-hairline/50 px-3 text-[12px] font-medium text-ink hover:bg-raised disabled:cursor-wait disabled:opacity-50"
                  >
                    {convertingLifecycle ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
                    Keep permanently
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4">
            <div>
              <div className="text-[15px] font-medium text-ink">
                Notifications
              </div>
              <div className="mt-0.5 text-[13px] text-ink-secondary">
                Get notified when this agent finishes or needs input
              </div>
            </div>
            <button
              role="switch"
              aria-checked={bot.notifications}
              onClick={() => patch({ notifications: !bot.notifications })}
              className={cn(
                "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors",
                bot.notifications ? "bg-accent" : "bg-raised",
              )}
            >
              <span
                className={cn(
                  "absolute top-[3px] size-5 rounded-full bg-white transition-all",
                  bot.notifications ? "left-[21px]" : "left-[3px]",
                )}
              />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
