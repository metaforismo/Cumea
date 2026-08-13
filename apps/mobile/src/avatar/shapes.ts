// Adapted from Mote Studio at aa240400fa504fc2b1b7454323a4d48a90b94c13.
// Mote Studio is MIT licensed; the required notice is in ../../licenses.
import type { ShapeId } from "@/host/types";

type Point = { x: number; y: number };
const CENTER = 160;
const POINT_COUNT = 16;

const sample = (factory: (angle: number, index: number) => Point): Point[] =>
  Array.from({ length: POINT_COUNT }, (_, index) => {
    const angle = -Math.PI / 2 + (index / POINT_COUNT) * Math.PI * 2;
    return factory(angle, index);
  });

const superellipse = (radiusX: number, radiusY: number, power: number): Point[] =>
  sample((angle) => ({
    x: CENTER + radiusX * Math.sign(Math.cos(angle)) * Math.abs(Math.cos(angle)) ** (2 / power),
    y: CENTER + radiusY * Math.sign(Math.sin(angle)) * Math.abs(Math.sin(angle)) ** (2 / power),
  }));

const radial = (
  radiusX: number,
  radiusY: number,
  modulation: (angle: number, index: number) => number,
): Point[] =>
  sample((angle, index) => {
    const radius = modulation(angle, index);
    return { x: CENTER + Math.cos(angle) * radiusX * radius, y: CENTER + Math.sin(angle) * radiusY * radius };
  });

const fromCoordinates = (coordinates: ReadonlyArray<readonly [number, number]>): Point[] =>
  coordinates.map(([x, y]) => ({ x, y }));

const round = (value: number) => Number(value.toFixed(2));

function closedCurvePath(points: Point[]): string {
  const commands = [`M ${round(points[0].x)} ${round(points[0].y)}`];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const afterNext = points[(index + 2) % points.length];
    commands.push(
      `C ${round(current.x + (next.x - previous.x) / 6)} ${round(current.y + (next.y - previous.y) / 6)} ` +
        `${round(next.x - (afterNext.x - current.x) / 6)} ${round(next.y - (afterNext.y - current.y) / 6)} ` +
        `${round(next.x)} ${round(next.y)}`,
    );
  }
  return `${commands.join(" ")} Z`;
}

const points: Record<ShapeId, Point[]> = {
  orb: radial(106, 106, () => 1),
  soft: radial(110, 102, (angle) => 1 + 0.045 * Math.sin(angle * 3 + 0.7)),
  tile: superellipse(101, 101, 5.4),
  capsule: superellipse(121, 70, 4.2),
  peak: fromCoordinates([
    [160, 49], [178, 72], [200, 106], [222, 143], [238, 181], [232, 207], [206, 216], [176, 218],
    [144, 218], [113, 218], [88, 209], [82, 184], [97, 146], [118, 108], [141, 73], [153, 54],
  ]),
  gem: fromCoordinates([
    [160, 48], [185, 62], [213, 80], [238, 97], [246, 129], [246, 166], [244, 201], [216, 220],
    [184, 238], [160, 249], [136, 238], [104, 220], [76, 201], [74, 165], [74, 129], [82, 97],
  ]),
  ripple: radial(102, 96, (angle) => 1 + 0.13 * Math.sin(angle * 5 - 0.55)),
  drop: fromCoordinates([
    [160, 44], [178, 68], [198, 97], [218, 128], [228, 160], [224, 191], [206, 216], [184, 231],
    [160, 236], [136, 231], [114, 216], [96, 191], [92, 160], [102, 128], [122, 97], [142, 68],
  ]),
};

export const SHAPE_PATHS = Object.fromEntries(
  Object.entries(points).map(([id, value]) => [id, closedCurvePath(value)]),
) as Record<ShapeId, string>;

export const MOTE_PALETTE = [
  "#edece7",
  "#8b633d",
  "#dc2944",
  "#f56a16",
  "#ee9e18",
  "#19ae7a",
  "#16a79d",
  "#2f8de3",
  "#7651d6",
  "#d72879",
  "#b9bab7",
] as const;

export function eyeColorFor(background: string): string {
  const value = background.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 > 0.48 ? "#151612" : "#f4f2eb";
}
