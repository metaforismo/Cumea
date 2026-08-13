import { memo, useId, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { CumeaColor, CumeaExpression, CumeaMotion } from "@/lib/mascot";
import {
  avatarForLegacyColor,
  getMoteEyeColor,
  moteShapeById,
  semanticStateForMotion,
  type AvatarSemanticState,
  type BotAvatarConfig,
} from "@/lib/mote";

function trackEyes(event: ReactPointerEvent<SVGSVGElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
  const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  event.currentTarget.style.setProperty("--cumea-eye-x", `${Math.max(-1, Math.min(1, x)) * 8}px`);
  event.currentTarget.style.setProperty("--cumea-eye-y", `${Math.max(-1, Math.min(1, y)) * 6}px`);
}

function resetEyes(event: ReactPointerEvent<SVGSVGElement>) {
  event.currentTarget.style.setProperty("--cumea-eye-x", "0px");
  event.currentTarget.style.setProperty("--cumea-eye-y", "0px");
}

export interface CumeaAvatarProps {
  avatar?: BotAvatarConfig;
  /** Legacy fallback for bot records created before Mote avatars. */
  color?: CumeaColor;
  /** Kept for source compatibility; Mote identities intentionally use eyes only. */
  expression?: CumeaExpression;
  size?: number;
  label?: string;
  motion?: CumeaMotion;
  motionKey?: number;
  state?: AvatarSemanticState;
  /** Enables the configured idle drift; semantic state motion is always active. */
  ambient?: boolean;
}

function CumeaAvatarComponent(props: CumeaAvatarProps) {
  const {
    avatar = avatarForLegacyColor(props.color),
    size = 44,
    label,
    motion = "none",
    motionKey = 0,
    state = "idle",
    ambient = false,
  } = props;
  const effectiveState = semanticStateForMotion(motion) ?? state;
  const shape = moteShapeById(avatar.shapeId);
  const eyeColor = getMoteEyeColor(avatar.color);
  const uid = useId().replace(/:/g, "");
  const clipId = `mote-avatar-clip-${uid}`;
  const statusLabel = effectiveState === "needs-you" ? "needs you" : effectiveState;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 320 320"
      className={`mote-avatar mote-avatar--${avatar.motion} mote-avatar--${effectiveState} ${ambient ? "mote-avatar--ambient" : ""} shrink-0 overflow-visible`}
      role={label ? "img" : undefined}
      aria-label={label ? `${label}, ${statusLabel}` : undefined}
      aria-hidden={label ? undefined : true}
      onPointerMove={trackEyes}
      onPointerLeave={resetEyes}
      style={
        {
          "--mote-color": avatar.color,
          "--mote-eye-color": eyeColor,
          "--cumea-eye-x": "0px",
          "--cumea-eye-y": "0px",
        } as CSSProperties
      }
    >
      <defs>
        <clipPath id={clipId}>
          <path d={shape.path} />
        </clipPath>
      </defs>

      <g key={motionKey} className={`cumea-motion cumea-motion--${motion}`}>
        <g className="mote-working-orbit" aria-hidden="true">
          <ellipse cx="160" cy="160" rx="130" ry="57" />
          <ellipse cx="160" cy="160" rx="126" ry="72" />
        </g>

        <g className="mote-character cumea-character">
          <path className="mote-body cumea-body" d={shape.path} fill={avatar.color} />
          {avatar.kind === "upload" && avatar.imageDataUrl ? (
            <image
              href={avatar.imageDataUrl}
              x="42"
              y="42"
              width="236"
              height="236"
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#${clipId})`}
              className="mote-upload"
            />
          ) : null}

          <g className="mote-gaze">
            <g className="cumea-eyes mote-eyes">
              <rect
                x="122"
                y="125"
                width="24"
                height="56"
                rx="12"
                fill={eyeColor}
                transform="rotate(8 134 153)"
              />
              <rect
                x="177"
                y="125"
                width="24"
                height="56"
                rx="12"
                fill={eyeColor}
                transform="rotate(8 189 153)"
              />
            </g>
          </g>
        </g>

        <g className="mote-needs-indicator" aria-hidden="true">
          <circle cx="251" cy="67" r="17" fill="#ff9800" />
          <circle cx="251" cy="59" r="3" fill="#171815" />
          <rect x="248" y="65" width="6" height="11" rx="3" fill="#171815" />
        </g>
      </g>
    </svg>
  );
}

export const CumeaAvatar = memo(CumeaAvatarComponent);

export function InitialsAvatar({ initials, size = 32 }: { initials: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-raised font-medium text-ink-secondary"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}
