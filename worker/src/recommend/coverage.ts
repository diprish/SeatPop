import { fitLevelForMember, type AgeFitMember } from "@seatpop/shared";

export interface CoverageAges {
  age_min: number | null;
  age_max: number | null;
}

/**
 * Coverage pass (worker/recommend): pure id-list surgery guaranteeing
 * that every household member with at least one exact-fit candidate in
 * the pool is covered by one in the top N. For each uncovered member
 * (household order), the best-scored exact fit from beyond N swaps into
 * the slot of the last top-N candidate covering no member exactly;
 * every other candidate keeps its exact position. Members with no
 * exact fit anywhere, and members left roomless because every top slot
 * already covers someone, are skipped — never an error, never a drop
 * of a candidate that already covers a member. Input ids must be
 * unique; unknown ages/scores sort as non-covering / unscored.
 */
export function applyCoverageOrder(
  orderedIds: string[],
  agesById: Map<string, CoverageAges>,
  members: AgeFitMember[],
  scoresById: Map<string, number>,
  topN: number,
): string[] {
  const result = orderedIds.slice();
  if (topN <= 0 || members.length === 0 || result.length === 0) {
    return result;
  }
  const n = Math.min(topN, result.length);
  const exactMembers = (id: string): number[] => {
    const ages = agesById.get(id);
    if (!ages) return [];
    const out: number[] = [];
    members.forEach((member, index) => {
      if (fitLevelForMember(ages, member) === "exact") out.push(index);
    });
    return out;
  };
  const scoreOf = (id: string): number =>
    scoresById.get(id) ?? Number.NEGATIVE_INFINITY;
  const covered = new Set<number>();
  for (let i = 0; i < n; i++) {
    for (const m of exactMembers(result[i] as string)) covered.add(m);
  }
  for (let m = 0; m < members.length; m++) {
    if (covered.has(m)) continue;
    let best = -1;
    for (let i = n; i < result.length; i++) {
      const id = result[i] as string;
      if (!exactMembers(id).includes(m)) continue;
      if (best < 0 || scoreOf(id) > scoreOf(result[best] as string)) {
        best = i;
      }
    }
    if (best < 0) continue;
    let victim = -1;
    for (let i = n - 1; i >= 0; i--) {
      if (exactMembers(result[i] as string).length === 0) {
        victim = i;
        break;
      }
    }
    if (victim < 0) continue;
    const rescued = result[best] as string;
    result[best] = result[victim] as string;
    result[victim] = rescued;
    for (const k of exactMembers(rescued)) covered.add(k);
  }
  return result;
}
