import { useRef, useState } from "react";
import { Check, ChevronLeft, ImagePlus, Sparkles, X } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
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
  const { state, dispatch } = useStore();
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
        | "approvalPolicy"
      >
    >,
  ) => dispatch({ type: "updateBot", botId: bot.id, patch: p });
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;
  const instance = state.instances.find((candidate) => candidate.instanceId === bot.modelSelection.instanceId);
  const capabilities = instance?.capabilities;
  const computerModes = [
    ["cloud", capabilities?.cloudComputerMcp === true],
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
            <div className="mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">Action approvals</div>
            <div className="mt-2 grid grid-cols-3 overflow-hidden rounded-lg border border-hairline/40">
              {([
                ["ask", "Ask"],
                ["allow", "Always allow"],
                ["deny", "Never"],
              ] as const).map(([value, label], index) => (
                <button
                  key={value}
                  onClick={() => patch({ approvalPolicy: value })}
                  className={cn(
                    "px-1 py-2 text-[11px]",
                    index > 0 && "border-l border-hairline/40",
                    (bot.approvalPolicy ?? "ask") === value ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[11px] leading-relaxed text-ink-secondary">Always and Never are remembered for future permission requests from this bot. Questions still wait for you.</div>
          </div>

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
