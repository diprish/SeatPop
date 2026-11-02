import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HUES,
  hueForBand,
  hueForCategory,
  hueForDayPart,
} from "../src/components/ui/hue";
function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function iconNames(): string[] {
  const icon = source("../src/components/ui/Icon.tsx");
  const block = icon.match(/ICON_NAMES = \[(.*?)\]/s)?.[1] ?? "";
  return [...block.matchAll(/"([a-z]+)"/g)].map((match) => match[1] as string);
}

describe("hue mapping", () => {
  it("maps age bands to hues in AGE_BANDS order", () => {
    expect(hueForBand("baby")).toBe("blush");
    expect(hueForBand("preschool")).toBe("peach");
    expect(hueForBand("kids")).toBe("lemon");
    expect(hueForBand("teens")).toBe("mint");
    expect(hueForBand("adults")).toBe("sky");
    expect(hueForBand("seniors")).toBe("lavender");
  });

  it("maps day parts to their spec hues", () => {
    expect(hueForDayPart("morning")).toBe("lemon");
    expect(hueForDayPart("afternoon")).toBe("peach");
    expect(hueForDayPart("evening")).toBe("lavender");
    expect(hueForDayPart("night")).toBe("sky");
  });

  it("hashes categories to stable hues", () => {
    expect(hueForCategory("library")).toBe("lavender");
    expect(hueForCategory("arts")).toBe("sky");
    expect(hueForCategory("museums")).toBe("peach");
    expect(hueForCategory("music")).toBe("lavender");
    expect(hueForCategory("markets")).toBe("peach");
    expect(hueForCategory("camps")).toBe("sky");
    expect(hueForCategory(null)).toBe("sky");
    for (const hue of HUES) {
      expect(hueForCategory(hue)).toMatch(/^(blush|peach|lemon|mint|sky|lavender)$/);
    }
  });
});

describe("ui primitives", () => {
  const chip = source("../src/components/ui/Chip.tsx");
  const button = source("../src/components/ui/Button.tsx");
  const card = source("../src/components/ui/Card.tsx");
  const badge = source("../src/components/ui/Badge.tsx");
  const field = source("../src/components/ui/Field.tsx");
  const toggle = source("../src/components/ui/Toggle.tsx");
  const skeleton = source("../src/components/ui/Skeleton.tsx");

  it("chips rest on tints and select onto solids with navy text", () => {
    expect(chip).toContain("HUE_TINT_BG[hue]");
    expect(chip).toContain("border-2");
    expect(chip).toContain("HUE_SOLID_BG[hue]");
    expect(chip).toContain("text-navy");
    expect(chip).toContain("aria-pressed={disclosure ? undefined : selected}");
    expect(chip).toContain('name="check"');
    expect(chip).toContain("min-h-[44px]");
  });

  it("buttons fill primary navy with a dark-mode flip", () => {
    expect(button).toContain("bg-primary");
    expect(button).toContain("text-white dark:text-navy");
    expect(button).toContain("min-h-[44px]");
    expect(button).toContain("disabled:opacity-40");
  });

  it("tickets carry the rainbow strip and a notched divider", () => {
    expect(card).toContain("bg-rainbow");
    expect(card).toContain("rounded-t-card");
    expect(card).toContain("TicketDivider");
    expect(card).toContain("border-dashed");
    expect(card).toContain("bg-background");
  });

  it("badges stay small pills with navy-on-solid text", () => {
    expect(badge).toContain("text-xs font-bold");
    expect(badge).toContain("bg-navy text-white");
    expect(badge).toContain("bg-mist text-ink");
  });

  it("fields label a 44px icon-prefixed input with hint slots", () => {
    expect(field).toContain("htmlFor={id}");
    expect(field).toContain("min-h-[44px]");
    expect(field).toContain("pl-10");
    expect(field).toContain("aria-describedby");
    expect(field).toContain('role="alert"');
  });

  it("toggles expose a labeled 44px switch", () => {
    expect(toggle).toContain('role="switch"');
    expect(toggle).toContain("aria-checked={checked}");
    expect(toggle).toContain("aria-label={label}");
    expect(toggle).toContain("min-h-[44px]");
    expect(toggle).toContain("dark:bg-lavender-solid");
  });

  it("skeletons pulse only when motion is safe", () => {
    expect(skeleton).toContain("animate-pulse");
    expect(skeleton).toContain("motion-reduce:animate-none");
    expect(skeleton).toContain('aria-hidden="true"');
  });

  it("ships the full 17-icon set on a 24-grid", () => {
    const names = iconNames();
    expect(names).toHaveLength(17);
    const icon = source("../src/components/ui/Icon.tsx");
    expect(icon).toContain('viewBox="0 0 24 24"');
    for (const name of names) {
      expect(icon).toContain(`${name}:`);
    }
  });
});
