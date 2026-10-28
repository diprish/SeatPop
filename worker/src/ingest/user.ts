import {
  type Adapter,
  type AdapterContext,
  type EventDraft,
  type SourceConfig,
} from "./types";
import { extractEventsFromText, fetchVisibleText } from "./html";

/**
 * Tier 3: user-submitted input (a URL or pasted text, used by the app later).
 * URLs still go through the polite fetcher (robots enforced); extraction is
 * stubbed like tier 2.
 */

export interface UserSubmission {
  url?: string;
  text?: string;
}

export interface PreparedSubmission {
  sourceUrl: string;
  rawText: string;
}

/** Normalize a submission to fetched-or-pasted text. */
export async function prepareUserSubmission(
  submission: UserSubmission,
  ctx: AdapterContext,
): Promise<PreparedSubmission | null> {
  if (submission.url) {
    const page = await fetchVisibleText(submission.url, ctx);
    if (!page) return null;
    return { sourceUrl: page.url, rawText: page.text };
  }
  if (submission.text && submission.text.trim() !== "") {
    return { sourceUrl: "", rawText: submission.text.trim() };
  }
  return null;
}

export const UserSubmittedAdapter: Adapter = {
  kind: "user_submitted",
  async collect(
    _source: SourceConfig,
    _ctx: AdapterContext,
  ): Promise<EventDraft[]> {
    // The app calls prepareUserSubmission + extractEventsFromText directly;
    // scheduled collection does not apply to user input.
    return [];
  },
};

export { extractEventsFromText };
