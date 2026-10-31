/**
 * Library venue names carry the room after " at " ("Greely at Carol
 * Parker Room"). The branch is the physical place (everything before the
 * first " at "); the room is the rest. Pure string ops, client-safe,
 * shared by the recommend collapser and the detail API.
 */

/** Physical place: "North Gloucester at Room A" -> "North Gloucester". */
export function branchOf(venueName: string | null): string {
  if (!venueName) return "";
  const at = venueName.indexOf(" at ");
  return (at < 0 ? venueName : venueName.slice(0, at)).trim();
}

/**
 * Room within the branch: "North Gloucester at Room A" -> "Room A".
 * Null when the name carries no room part.
 */
export function roomOf(venueName: string | null): string | null {
  if (!venueName) return null;
  const at = venueName.indexOf(" at ");
  if (at < 0) return null;
  const room = venueName.slice(at + 4).trim();
  return room === "" ? null : room;
}
