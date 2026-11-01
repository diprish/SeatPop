import { createHash } from "node:crypto";

/**
 * Server-only voter hashing (never imported by client components):
 * salted device hash, the only voter identity ever stored.
 */
export function voterHashFor(deviceId: string, salt: string): string {
  return createHash("sha256").update(`${deviceId}:${salt}`, "utf8").digest("hex");
}
