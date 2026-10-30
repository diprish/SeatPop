import { z } from "zod";

/**
 * Owner-entered City registration windows (data/seed/city-registration-dates.json).
 * Phase 7 loads these into registration_windows(scope, kind, opens_at, quote,
 * source_url) and displays every window with its verbatim quote and the
 * City's page link. This file is never a source of events and is never
 * filled by crawling ottawa.ca — the owner transcribes it by hand.
 */

export const RegistrationWindowSchema = z.object({
  scope: z.string().min(1),
  kind: z.string().min(1),
  opens_at: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), {
      message: "opens_at must be a parseable ISO date or datetime",
    }),
  quote: z.string().min(1),
  source_url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), {
      message: "source_url must be an https URL",
    }),
});

export type RegistrationWindow = z.infer<typeof RegistrationWindowSchema>;

export const RegistrationWindowsFileSchema = z.object({
  schemaVersion: z.literal(1),
  _note: z.string().optional(),
  windows: z.array(RegistrationWindowSchema),
});

export type RegistrationWindowsFile = z.infer<
  typeof RegistrationWindowsFileSchema
>;
