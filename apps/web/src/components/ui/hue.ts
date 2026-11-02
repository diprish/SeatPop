import {
  AGE_BANDS,
  type AgeBand,
  type DayPart,
} from "@seatpop/shared";

/**
 * Candy-pastel hue mapping (client-safe). Bands follow AGE_BANDS order;
 * day parts and categories map per the redesign spec. Night has no
 * spec hue — sky reads as night sky. Class maps below spell every
 * Tailwind literal out so the compiler picks them up (never
 * interpolate a hue into a class name).
 */

export const HUES = [
  "blush",
  "peach",
  "lemon",
  "mint",
  "sky",
  "lavender",
] as const;
export type Hue = (typeof HUES)[number];

export function hueForBand(band: AgeBand): Hue {
  return HUES[AGE_BANDS.indexOf(band)] ?? "sky";
}

const DAY_PART_HUES: Record<DayPart, Hue> = {
  morning: "lemon",
  afternoon: "peach",
  evening: "lavender",
  night: "sky",
};

export function hueForDayPart(part: DayPart): Hue {
  return DAY_PART_HUES[part];
}

export function hueForCategory(category: string | null | undefined): Hue {
  if (!category) return "sky";
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  }
  return HUES[hash % HUES.length] ?? "sky";
}

export const HUE_TINT_BG: Record<Hue, string> = {
  blush: "bg-blush-tint",
  peach: "bg-peach-tint",
  lemon: "bg-lemon-tint",
  mint: "bg-mint-tint",
  sky: "bg-sky-tint",
  lavender: "bg-lavender-tint",
};

export const HUE_SOLID_BG: Record<Hue, string> = {
  blush: "bg-blush-solid",
  peach: "bg-peach-solid",
  lemon: "bg-lemon-solid",
  mint: "bg-mint-solid",
  sky: "bg-sky-solid",
  lavender: "bg-lavender-solid",
};

export const HUE_SOLID_BORDER: Record<Hue, string> = {
  blush: "border-blush-solid",
  peach: "border-peach-solid",
  lemon: "border-lemon-solid",
  mint: "border-mint-solid",
  sky: "border-sky-solid",
  lavender: "border-lavender-solid",
};

export const HUE_INK: Record<Hue, string> = {
  blush: "text-blush-ink",
  peach: "text-peach-ink",
  lemon: "text-lemon-ink",
  mint: "text-mint-ink",
  sky: "text-sky-ink",
  lavender: "text-lavender-ink",
};
