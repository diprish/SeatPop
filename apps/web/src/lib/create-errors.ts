/**
 * Typed create-function errors (client-safe, tested): maps a
 * create_reminder / create_booking envelope error to HTTP. Every code
 * the SQL functions return is covered; unknown codes fail closed.
 */

export interface MappedError {
  status: number;
  message: string;
}

export function reminderCreateError(code: string): MappedError {
  switch (code) {
    case "invalid_email":
      return { status: 400, message: "that email address does not look valid" };
    case "invalid_basis":
    case "invalid_token":
      return { status: 400, message: "invalid reminder request" };
    case "unknown_event":
      return { status: 404, message: "unknown event" };
    case "past_remind_at":
      return {
        status: 400,
        message: "that reminder time has already passed",
      };
    case "per_email_cap":
      return {
        status: 429,
        message: "too many pending reminders for this email (max 3 unsent)",
      };
    case "global_cap":
      return {
        status: 429,
        message: "reminder service is busy, try again later",
      };
    case "duplicate":
      return {
        status: 409,
        message: "a reminder is already set for this event and email",
      };
    default:
      return { status: 500, message: "reminder failed" };
  }
}

export function voteCreateError(code: string): MappedError {
  switch (code) {
    case "invalid_series":
    case "invalid_voter":
    case "invalid_vote":
    case "invalid_tags":
      return { status: 400, message: "invalid vote" };
    case "unknown_event":
      return { status: 404, message: "unknown event" };
    case "voter_cap":
      return {
        status: 429,
        message: "this device has cast a lot of votes — try again later",
      };
    case "global_cap":
      return {
        status: 429,
        message: "voting is busy, try again later",
      };
    default:
      return { status: 500, message: "vote failed" };
  }
}

export function bookingCreateError(code: string): MappedError {
  switch (code) {
    case "invalid_token":
    case "invalid_confirmation":
      return { status: 400, message: "invalid booking request" };
    case "unknown_event":
      return { status: 404, message: "unknown event" };
    case "feed_cap":
      return {
        status: 400,
        message: "this calendar already holds 50 bookings",
      };
    case "duplicate":
      return {
        status: 409,
        message: "this event is already booked on this calendar",
      };
    default:
      return { status: 500, message: "booking failed" };
  }
}
