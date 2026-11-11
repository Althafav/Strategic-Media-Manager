"use client";

import { MATCH_LEVELS, MATCH_LEVEL_LABEL, type MatchLevel } from "@/lib/face-types";

/** Strict / Balanced / Loose: how sure a match must be. Filtering happens on the device, so switching is instant. */
export function MatchLevelToggle({ level, onLevel, counts }: { level: MatchLevel; onLevel: (level: MatchLevel) => void; counts?: Record<MatchLevel, number> }) {
  return (
    <div role="radiogroup" aria-label="How sure a match must be" className="inline-flex rounded-md border border-border bg-surface p-0.5">
      {MATCH_LEVELS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={l === level}
          onClick={() => onLevel(l)}
          className="h-8 px-3 rounded-[5px] text-sm font-medium text-subtle aria-checked:bg-accent aria-checked:text-accent-foreground"
        >
          {MATCH_LEVEL_LABEL[l]}
          {counts && <span className="ml-1.5 tabular-nums font-normal opacity-70">{counts[l]}</span>}
        </button>
      ))}
    </div>
  );
}
