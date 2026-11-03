"use client";

import {
  DAY_PARTS,
  WEEKDAYS,
  type DayPart,
  type Preferences,
  type Weekday,
} from "@seatpop/shared";
import { Chip } from "./ui/Chip";
import { hueForDayPart } from "./ui/hue";

function capitalize(word: string): string {
  return word.slice(0, 1).toUpperCase() + word.slice(1);
}

/** Weekday x day-part grid; day-qualified names keep toggles distinct. */
export default function AvailabilityGrid({
  availability,
  onToggle,
}: {
  availability: Preferences["availability"];
  onToggle: (day: Weekday, part: DayPart) => void;
}) {
  return (
    <div className="space-y-2">
      {WEEKDAYS.map((day: Weekday) => (
        <div key={day} className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-xs font-semibold text-muted">
            {capitalize(day)}
          </span>
          <div className="grid flex-1 grid-cols-4 gap-1">
            {DAY_PARTS.map((part: DayPart) => (
              <Chip
                key={part}
                hue={hueForDayPart(part)}
                size="sm"
                selected={availability?.[day]?.includes(part) ?? false}
                aria-label={`${capitalize(day)} ${part}`}
                onClick={() => onToggle(day, part)}
              >
                {capitalize(part)}
              </Chip>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
