// Contrast gate for the candy-pastel tokens: every text pair in both
// themes must reach WCAG AA (4.5:1). Runs in Phase A to validate the
// token picks and again in Phase F with component combos. Exits 1 on
// any failure. Usage: node scripts/contrast-check.mjs

const LIGHT = {
  bg: "#fbf8f3",
  surface: "#ffffff",
  ink: "#2b2f4a",
  muted: "#565b78",
  faint: "#646a86",
  primary: "#2b2f4a",
  onPrimary: "#ffffff",
  navy: "#2b2f4a",
  white: "#ffffff",
  mist: "#f3f1f8",
  blush: { solid: "#f4a9b8", tint: "#fde8ed", ink: "#7d2a3d" },
  peach: { solid: "#f8c08e", tint: "#fdeedd", ink: "#7a4a14" },
  lemon: { solid: "#f2dc7a", tint: "#fbf3cc", ink: "#66560f" },
  mint: { solid: "#a9deb9", tint: "#e6f6ec", ink: "#2a5b3a" },
  sky: { solid: "#9ccbea", tint: "#e4f1fa", ink: "#1f5272" },
  lavender: { solid: "#c6b8ea", tint: "#efeafa", ink: "#4a3e7a" },
};

const DARK = {
  bg: "#161828",
  surface: "#1d2033",
  ink: "#eceef8",
  muted: "#b6bad2",
  faint: "#9aa0bb",
  primary: "#c6b8ea",
  onPrimary: "#2b2f4a",
  navy: "#2b2f4a",
  white: "#ffffff",
  mist: "#262a3d",
  blush: { solid: "#f4a9b8", tint: "#44394b", ink: "#fecdd3" },
  peach: { solid: "#f8c08e", tint: "#443d43", ink: "#fed7aa" },
  lemon: { solid: "#f2dc7a", tint: "#434240", ink: "#fef08a" },
  mint: { solid: "#a9deb9", tint: "#36424b", ink: "#bbf7d0" },
  sky: { solid: "#9ccbea", tint: "#343f54", ink: "#bae6fd" },
  lavender: { solid: "#c6b8ea", tint: "#3b3b54", ink: "#ddd6fe" },
};

const HUES = ["blush", "peach", "lemon", "mint", "sky", "lavender"];

function luminance(hex) {
  const rgb = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// [label, fg key path, bg key path]
function pairsFor(theme) {
  const pairs = [
    ["ink/page", "ink", "bg"],
    ["ink/surface", "ink", "surface"],
    ["muted/page", "muted", "bg"],
    ["muted/surface", "muted", "surface"],
    ["faint/page", "faint", "bg"],
    ["faint/surface", "faint", "surface"],
    ["onPrimary/primary", "onPrimary", "primary"],
    ["ink/mist", "ink", "mist"],
  ];
  for (const hue of HUES) {
    pairs.push(
      [`navy/${hue}-solid`, "navy", `${hue}.solid`],
      [`${hue}-ink/${hue}-tint`, `${hue}.ink`, `${hue}.tint`],
      [`${hue}-ink/surface`, `${hue}.ink`, "surface"],
    );
  }
  return pairs.map(([label, fgPath, bgPath]) => {
    const get = (path) =>
      path.split(".").reduce((obj, key) => obj[key], theme);
    return { label, fg: get(fgPath), bg: get(bgPath) };
  });
}

let failed = 0;
for (const [name, theme] of [
  ["light", LIGHT],
  ["dark", DARK],
]) {
  for (const { label, fg, bg } of pairsFor(theme)) {
    const r = ratio(fg, bg);
    const ok = r >= 4.5;
    if (!ok) failed += 1;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${name} ${label} ${fg} on ${bg} ${r.toFixed(2)}:1`,
    );
  }
}
if (failed > 0) {
  console.error(`contrast-check: ${failed} pair(s) below 4.5:1`);
  process.exit(1);
}
console.log("contrast-check: all pairs reach 4.5:1");
