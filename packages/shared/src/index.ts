import { z } from "zod";

/** Response shape of GET /health in apps/web. Contains status and build info, never secrets. */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string().min(1),
  version: z.string().min(1),
  commit: z.string().min(1),
  node: z.string().min(1),
  time: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
