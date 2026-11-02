import {
  AGE_BAND_RANGES,
  coverBandLabel,
  fitLevelForMember,
  fitLevelsForHousehold,
  type AgeBand,
  type Preferences,
} from "@seatpop/shared";

/**
 * Per-person grouping (For-you 2c): a lossless, stable partition of
 * the served picks. "Everyone together" holds picks with an exact or
 * adjacent fit for every member, plus ageless picks (null ages fit
 * no band verifiably and every band possibly; their "check the age
 * group" flag travels with them). Each band column holds that band's
 * exact fits, then adjacent fits that are exact for no other member
 * — an adjacent pick exact elsewhere reads as a wrong-member pick,
 * since its reason names the exact band. Within a tier, broader age
 * coverage of the band ranks first (18+ ahead of 50+), served order
 * breaking ties. Together picks never repeat in a column. With a
 * single band there is no together row: the one column shelves
 * exact, then adjacent, then ageless. Served order itself is
 * untouched — ranking, SQL, and evals never see this function.
 */

export interface PerPersonItem {
  event_id: string;
  age_min: number | null;
  age_max: number | null;
}

export interface MemberColumn<T> {
  band: AgeBand;
  picks: T[];
}

export interface PerPersonGroups<T> {
  together: T[];
  columns: Array<MemberColumn<T>>;
}

/**
 * Share (0..1) of the member's band covered by the event's stated
 * age range, one-sided ranges included ("50+" covers 50-64 of the
 * 18-64 band). An unstated range counts as full coverage for
 * ranking; its "check the age group" flag is untouched.
 */
export function bandCoverage(
  ages: { age_min: number | null; age_max: number | null },
  band: AgeBand,
): number {
  if (ages.age_min === null && ages.age_max === null) return 1;
  const range = AGE_BAND_RANGES[band] as { min: number; max: number };
  const width = range.max - range.min + 1;
  const overlap = Math.max(
    0,
    Math.min(ages.age_max ?? 130, range.max) -
      Math.max(ages.age_min ?? 0, range.min) +
      1,
  );
  return overlap / width;
}

/** Order within a fit tier: full band, then share, then served order. */
function sortByCoverage<T extends PerPersonItem>(
  tier: T[],
  orderOf: (id: string) => number,
  band: AgeBand,
): T[] {
  const keyOf = (item: T): [number, number, number] => {
    const share = bandCoverage(item, band);
    return [share >= 1 ? 0 : 1, -share, orderOf(item.event_id)];
  };
  return tier
    .slice()
    .sort(
      (a, b) =>
        keyOf(a)[0] - keyOf(b)[0] ||
        keyOf(a)[1] - keyOf(b)[1] ||
        keyOf(a)[2] - keyOf(b)[2],
    );
}

const PARTIAL_NOUN: Record<AgeBand, string> = {
  baby: "babies",
  preschool: "preschoolers",
  kids: "kids",
  teens: "teens",
  adults: "adults",
  seniors: "seniors",
};

/** "50+", "10–12", "up to 12" — the ageLine range conventions. */
function statedRange(ages: {
  age_min: number | null;
  age_max: number | null;
}): string | null {
  if (ages.age_min !== null && ages.age_max !== null) {
    return ages.age_min === ages.age_max
      ? `${ages.age_min}`
      : `${ages.age_min}–${ages.age_max}`;
  }
  if (ages.age_min !== null) return `${ages.age_min}+`;
  if (ages.age_max !== null) return `up to ${ages.age_max}`;
  return null;
}

/**
 * Column-context reason: when a pick is exact for the column band but
 * covers only part of it, name the stated range ("Open to adults
 * 50+") instead of the whole band ("Good for your 18-64 adult").
 * Only the good-for clause is swapped, so (stated)/(inferred) marks
 * stay where they are. Anything unrecognized — full coverage,
 * multi-band clauses, non-conforming phrasing — passes through
 * untouched rather than risk a wrong rewrite.
 */
export function columnReason(
  reason: string,
  ages: { age_min: number | null; age_max: number | null },
  band: AgeBand,
): string {
  if (
    fitLevelForMember(ages, { age_band: band }) !== "exact" ||
    bandCoverage(ages, band) >= 1
  ) {
    return reason;
  }
  const range = statedRange(ages);
  if (!range) return reason;
  const label = coverBandLabel(band)
    .replace(/[+()]/g, (c) => `\\${c}`)
    .replace(/-/g, "[-–]");
  const match = reason.match(
    new RegExp(`\\b([Gg]ood for your ${label}\\b)(?!\\s*(?:,|and)\\s+\\d)`),
  );
  const clause = match?.[1];
  if (!match || match.index === undefined || !clause) return reason;
  const open = clause.startsWith("G") ? "Open to" : "open to";
  return (
    reason.slice(0, match.index) +
    `${open} ${PARTIAL_NOUN[band]} ${range}` +
    reason.slice(match.index + clause.length)
  );
}

export function groupPerPerson<T extends PerPersonItem>(
  items: T[],
  members: Preferences["members"],
): PerPersonGroups<T> {
  if (members.length === 0) return { together: [], columns: [] };
  const bands: AgeBand[] = [];
  const memberIndex = new Map<AgeBand, number>();
  members.forEach((member, index) => {
    if (!memberIndex.has(member.age_band)) {
      memberIndex.set(member.age_band, index);
      bands.push(member.age_band);
    }
  });
  const levelsById = new Map<string, ReturnType<typeof fitLevelsForHousehold>>();
  for (const item of items) {
    levelsById.set(
      item.event_id,
      fitLevelsForHousehold(
        { age_min: item.age_min, age_max: item.age_max },
        members,
      ),
    );
  }
  const levelOf = (id: string, index: number): string | undefined =>
    levelsById.get(id)?.[index];
  const exactForOther = (id: string, band: AgeBand): boolean =>
    bands.some(
      (other) =>
        other !== band &&
        levelOf(id, memberIndex.get(other) as number) === "exact",
    );
  const togetherIds = new Set<string>();
  const together =
    bands.length <= 1
      ? []
      : items.filter((item) => {
          if (item.age_min === null && item.age_max === null) {
            togetherIds.add(item.event_id);
            return true;
          }
          const servesAll = bands.every((band) => {
            const level = levelOf(
              item.event_id,
              memberIndex.get(band) as number,
            );
            return level === "exact" || level === "adjacent";
          });
          if (servesAll) togetherIds.add(item.event_id);
          return servesAll;
        });
  const rest = items.filter((item) => !togetherIds.has(item.event_id));
  const servedOrder = new Map(rest.map((item, index) => [item.event_id, index]));
  const orderOf = (id: string): number => servedOrder.get(id) ?? 0;
  const columns = bands.map((band): MemberColumn<T> => {
    const index = memberIndex.get(band) as number;
    const exact: T[] = [];
    const adjacent: T[] = [];
    const unknown: T[] = [];
    for (const item of rest) {
      const level = levelOf(item.event_id, index);
      if (level === "exact") exact.push(item);
      else if (level === "adjacent") {
        if (!exactForOther(item.event_id, band)) adjacent.push(item);
      } else if (level === "unknown" && bands.length <= 1) {
        unknown.push(item);
      }
    }
    return {
      band,
      picks: [
        ...sortByCoverage(exact, orderOf, band),
        ...sortByCoverage(adjacent, orderOf, band),
        ...unknown,
      ],
    };
  });
  return { together, columns };
}
