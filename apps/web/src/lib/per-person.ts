import {
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
 * since its reason names the exact band. Together picks never repeat
 * in a column. With a single band there is no together row: the one
 * column shelves exact, then adjacent, then ageless. Served order
 * itself is untouched — ranking, SQL, and evals never see this
 * function.
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
    return { band, picks: [...exact, ...adjacent, ...unknown] };
  });
  return { together, columns };
}
