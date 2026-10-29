/**
 * Local embeddings (phase 2): bge-small-en-v1.5 (384 dims) via
 * transformers.js on CPU — no GPU, ~130 MB model, fine on a 16 GB Intel
 * Mac. The heavy dependency loads lazily (dynamic import) so tests and
 * enrichment runs never pay for it; tests inject a stub embedder.
 */

export const EMBED_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBED_DIMS = 384;
/** Only events starting within this window get an embedding. */
export const EMBED_WINDOW_DAYS = 30;

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/** summary + tags, falling back to the title when no summary exists. */
export function embedTextFor(
  summary: string | null,
  tags: string[],
  title: string,
): string {
  const head = summary?.trim() || title;
  return `${head} ${tags.join(" ")}`.replace(/\s+/g, " ").trim();
}

export function startsWithinDays(
  startsAt: string,
  nowMs: number,
  days: number = EMBED_WINDOW_DAYS,
): boolean {
  const startMs = Date.parse(startsAt);
  if (!Number.isFinite(startMs)) return false;
  const diff = startMs - nowMs;
  return diff >= 0 && diff <= days * 24 * 3600 * 1000;
}

type FeatureExtractor = (
  texts: string[],
  options: { pooling: string; normalize: boolean },
) => Promise<{ tolist(): unknown }>;

let cachedExtractor: FeatureExtractor | undefined;

async function realEmbed(texts: string[]): Promise<number[][]> {
  if (cachedExtractor === undefined) {
    const { pipeline } = await import("@xenova/transformers");
    const extractor = (await pipeline(
      "feature-extraction",
      EMBED_MODEL,
    )) as unknown as FeatureExtractor;
    cachedExtractor = extractor;
  }
  const tensor = await cachedExtractor(texts, {
    pooling: "mean",
    normalize: true,
  });
  const listed: unknown = tensor.tolist();
  if (
    !Array.isArray(listed) ||
    listed.length !== texts.length ||
    !listed.every(
      (row): row is number[] =>
        Array.isArray(row) &&
        row.length === EMBED_DIMS &&
        row.every((v) => typeof v === "number" && Number.isFinite(v)),
    )
  ) {
    throw new Error(
      `embedding model returned an unexpected shape (want ${texts.length}x${EMBED_DIMS})`,
    );
  }
  return listed;
}

/** Embed one batch (empty in → empty out, no model load). */
export async function localEmbed(
  texts: string[],
  embedFn?: EmbedFn,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (embedFn) return embedFn(texts);
  return realEmbed(texts);
}

/** pgvector text literal "[0.1,...]". Throws on wrong dimensionality. */
export function toVectorLiteral(vec: number[]): string {
  if (
    vec.length !== EMBED_DIMS ||
    !vec.every((v) => typeof v === "number" && Number.isFinite(v))
  ) {
    throw new Error(`cannot store a non-${EMBED_DIMS}-dim vector`);
  }
  return `[${vec.join(",")}]`;
}
