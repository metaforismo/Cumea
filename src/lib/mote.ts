/**
 * Avatar geometry and palette adapted from Mote Studio.
 * Copyright (c) 2026 metaforismo — MIT license.
 * See THIRD_PARTY_NOTICES.md and licenses/mote-studio-MIT.txt.
 */

import type { CumeaColor, CumeaMotion } from "./mascot";

export const MOTE_SHAPE_IDS = [
  "orb",
  "soft",
  "tile",
  "capsule",
  "peak",
  "gem",
  "ripple",
  "drop",
] as const;

export type MoteShapeId = (typeof MOTE_SHAPE_IDS)[number];
export type MoteMotionLevel = "calm" | "playful" | "kinetic";
export type MoteAvatarKind = "mote" | "upload";

export interface BotAvatarConfig {
  kind: MoteAvatarKind;
  shapeId: MoteShapeId;
  color: string;
  motion: MoteMotionLevel;
  /** Raster-only data URL, resized by the desktop client before persistence. */
  imageDataUrl?: string;
}

export type AvatarSemanticState = "idle" | "working" | "needs-you" | "success" | "error";

export const MOTE_COLORS = [
  { name: "Chalk", value: "#edece7" },
  { name: "Cocoa", value: "#8b633d" },
  { name: "Poppy", value: "#dc2944" },
  { name: "Tangerine", value: "#f56a16" },
  { name: "Marigold", value: "#ee9e18" },
  { name: "Meadow", value: "#19ae7a" },
  { name: "Lagoon", value: "#16a79d" },
  { name: "Sky", value: "#2f8de3" },
  { name: "Violet", value: "#7651d6" },
  { name: "Berry", value: "#d72879" },
  { name: "Silver", value: "#b9bab7" },
] as const;

export const MOTE_MOTION_LEVELS: Array<{
  id: MoteMotionLevel;
  label: string;
  description: string;
}> = [
  { id: "calm", label: "Calm", description: "Slow, gentle drift" },
  { id: "playful", label: "Playful", description: "Soft bounce and tilt" },
  { id: "kinetic", label: "Kinetic", description: "Fast and expressive" },
];

export const DEFAULT_BOT_AVATAR: BotAvatarConfig = {
  kind: "mote",
  shapeId: "drop",
  color: "#f56a16",
  motion: "playful",
};

type Point = { x: number; y: number };

export type MoteShape = {
  id: MoteShapeId;
  label: string;
  description: string;
  path: string;
};

const CENTER = 160;
const POINT_COUNT = 16;

const sample = (factory: (angle: number, index: number) => Point): Point[] =>
  Array.from({ length: POINT_COUNT }, (_, index) => {
    const angle = -Math.PI / 2 + (index / POINT_COUNT) * Math.PI * 2;
    return factory(angle, index);
  });

const superellipse = (radiusX: number, radiusY: number, power: number): Point[] =>
  sample((angle) => ({
    x:
      CENTER +
      radiusX * Math.sign(Math.cos(angle)) * Math.abs(Math.cos(angle)) ** (2 / power),
    y:
      CENTER +
      radiusY * Math.sign(Math.sin(angle)) * Math.abs(Math.sin(angle)) ** (2 / power),
  }));

const radial = (
  radiusX: number,
  radiusY: number,
  modulation: (angle: number, index: number) => number,
): Point[] =>
  sample((angle, index) => {
    const radius = modulation(angle, index);
    return {
      x: CENTER + Math.cos(angle) * radiusX * radius,
      y: CENTER + Math.sin(angle) * radiusY * radius,
    };
  });

const fromCoordinates = (coordinates: ReadonlyArray<readonly [number, number]>): Point[] =>
  coordinates.map(([x, y]) => ({ x, y }));

const round = (value: number) => Number(value.toFixed(2));

/** Compatible closed cubic curves; all presets retain the same 16-point topology. */
export function closedCurvePath(points: Point[]): string {
  if (points.length < 3) throw new Error("A closed curve requires at least three points");
  const commands = [`M ${round(points[0].x)} ${round(points[0].y)}`];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const afterNext = points[(index + 2) % points.length];
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const controlTwo = {
      x: next.x - (afterNext.x - current.x) / 6,
      y: next.y - (afterNext.y - current.y) / 6,
    };
    commands.push(
      `C ${round(controlOne.x)} ${round(controlOne.y)} ${round(controlTwo.x)} ${round(controlTwo.y)} ${round(next.x)} ${round(next.y)}`,
    );
  }
  return `${commands.join(" ")} Z`;
}

const pointSets: Record<MoteShapeId, Point[]> = {
  orb: radial(106, 106, () => 1),
  soft: radial(110, 102, (angle) => 1 + 0.045 * Math.sin(angle * 3 + 0.7)),
  tile: superellipse(101, 101, 5.4),
  capsule: superellipse(121, 70, 4.2),
  peak: fromCoordinates([
    [160, 49], [178, 72], [200, 106], [222, 143], [238, 181], [232, 207],
    [206, 216], [176, 218], [144, 218], [113, 218], [88, 209], [82, 184],
    [97, 146], [118, 108], [141, 73], [153, 54],
  ]),
  gem: fromCoordinates([
    [160, 48], [185, 62], [213, 80], [238, 97], [246, 129], [246, 166],
    [244, 201], [216, 220], [184, 238], [160, 249], [136, 238], [104, 220],
    [76, 201], [74, 165], [74, 129], [82, 97],
  ]),
  ripple: radial(102, 96, (angle) => 1 + 0.13 * Math.sin(angle * 5 - 0.55)),
  drop: fromCoordinates([
    [160, 44], [178, 68], [198, 97], [218, 128], [228, 160], [224, 191],
    [206, 216], [184, 231], [160, 236], [136, 231], [114, 216], [96, 191],
    [92, 160], [102, 128], [122, 97], [142, 68],
  ]),
};

const metadata: Record<MoteShapeId, Pick<MoteShape, "label" | "description">> = {
  orb: { label: "Orb", description: "Balanced and calm" },
  soft: { label: "Soft", description: "Organic and uneven" },
  tile: { label: "Tile", description: "Rounded and steady" },
  capsule: { label: "Capsule", description: "Quick and compact" },
  peak: { label: "Peak", description: "Curious and alert" },
  gem: { label: "Gem", description: "Structured and bold" },
  ripple: { label: "Ripple", description: "Playful and elastic" },
  drop: { label: "Drop", description: "Warm and expressive" },
};

export const MOTE_SHAPES: MoteShape[] = MOTE_SHAPE_IDS.map((id) => ({
  id,
  ...metadata[id],
  path: closedCurvePath(pointSets[id]),
}));

export function moteShapeById(id: MoteShapeId): MoteShape {
  return MOTE_SHAPES.find((shape) => shape.id === id) ?? MOTE_SHAPES[0];
}

const LEGACY_COLORS: Record<CumeaColor, string> = {
  green: "#19ae7a",
  blue: "#2f8de3",
  red: "#dc2944",
  orange: "#f56a16",
  purple: "#7651d6",
  cyan: "#16a79d",
  pink: "#d72879",
  yellow: "#ee9e18",
  teal: "#16a79d",
  coral: "#f56a16",
};

export function avatarForLegacyColor(color: CumeaColor = "orange"): BotAvatarConfig {
  return { ...DEFAULT_BOT_AVATAR, color: LEGACY_COLORS[color] };
}

export function getMoteEyeColor(hex: string): string {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.48 ? "#151612" : "#f4f2eb";
}

type AvatarBotProfile = {
  avatar?: BotAvatarConfig;
  color?: CumeaColor;
  busy?: boolean;
  messages?: Array<{
    kind: string;
    card?: { answered?: string; dismissed?: boolean };
    tool?: { ok?: boolean };
  }>;
};

export function avatarForBot(bot: AvatarBotProfile): BotAvatarConfig {
  return bot.avatar ?? avatarForLegacyColor(bot.color);
}

export function avatarStateForBot(bot: AvatarBotProfile): AvatarSemanticState {
  const needsYou = bot.messages?.some(
    (message) => message.kind === "options" && message.card && !message.card.answered && !message.card.dismissed,
  );
  if (needsYou) return "needs-you";
  const last = bot.messages?.at(-1);
  if (last?.kind === "activity" && last.tool?.ok === false) return "error";
  if (bot.busy) return "working";
  if (last?.kind === "activity" && last.tool?.ok === true) return "success";
  return "idle";
}

export function semanticStateForMotion(motion: CumeaMotion): AvatarSemanticState | null {
  if (motion === "working" || motion === "launch") return "working";
  if (motion === "thinking" || motion === "alert" || motion === "surprise") return "needs-you";
  if (motion === "failure") return "error";
  if (motion === "success" || motion === "celebrate") return "success";
  return null;
}
