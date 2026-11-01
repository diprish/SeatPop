import { type NextRequest } from "next/server";
import { z } from "zod";
import {
  bearerJwt,
  clientIp,
  publicSupabase,
  routeLimiter,
} from "@/lib/recommend-server";

/**
 * GET /api/reminders/unsubscribe?id=…&token=…: one-click delete from
 * the email footer (no JS, no sign-in — email clients open links in a
 * bare page). True/false both render a plain HTML page so nobody sees
 * raw JSON; a reused link honestly says it is already gone.
 */

const limiter = routeLimiter();

const QuerySchema = z.object({
  id: z.string().uuid(),
  token: z.string().min(32).max(200),
});

function page(title: string, message: string): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${title} · SeatPop</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5">` +
      `<h1>${title}</h1><p>${message}</p>` +
      `<p><a href="/">Back to SeatPop</a></p></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const query = QuerySchema.safeParse({
    id: request.nextUrl.searchParams.get("id") ?? "",
    token: request.nextUrl.searchParams.get("token") ?? "",
  });
  if (!query.success) {
    return page("Link incomplete", "This delete link is missing pieces. Nothing was deleted.");
  }

  const limit = limiter.check(`reminders-unsub:${clientIp(request)}`);
  if (!limit.allowed) {
    return page("Too many tries", "Please wait a minute and open the link again.");
  }

  const supabase = publicSupabase();
  if (!supabase) {
    return page("Reminders unavailable", "SeatPop is not configured right now. Try again later.");
  }
  const base = supabase.url.replace(/\/$/, "");
  const anonKey = supabase.anonKey;
  const jwt = bearerJwt(request) ?? anonKey;

  let deleted = false;
  try {
    const response = await fetch(`${base}/rest/v1/rpc/delete_reminder`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        p_id: query.data.id,
        p_delete_token: query.data.token,
      }),
    });
    deleted = response.ok && (await response.json()) === true;
  } catch {
    return page("Reminders unavailable", "Something went wrong. Try again later.");
  }

  return deleted
    ? page("Reminder deleted", "You will not get email about this event. Not you? Nothing else of yours was touched — only this one reminder is gone.")
    : page("Already gone", "This reminder was already deleted, or the link is unknown. Nothing else was touched.");
}
