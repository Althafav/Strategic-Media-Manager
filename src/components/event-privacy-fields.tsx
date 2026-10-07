"use client";

import { Lock } from "lucide-react";

export type PrivacyUser = { email: string; label: string };

type Props = {
  users: PrivacyUser[];
  isPrivate: boolean;
  viewers: string[];
  onPrivateChange: (value: boolean) => void;
  onViewersChange: (value: string[]) => void;
  disabled?: boolean;
  /** Set inside a <form>: the inputs submit as `private=on` and one `viewers` entry per ticked user. */
  named?: boolean;
};

/** "Private" switch plus the team members who may still see the event. The admin always sees it. */
export function EventPrivacyFields({ users, isPrivate, viewers, onPrivateChange, onViewersChange, disabled, named }: Props) {
  // Viewers no longer in the Users list stay listed, so they can be unticked.
  const options = [...users, ...viewers.filter((v) => !users.some((u) => u.email === v)).map((email) => ({ email, label: email }))];
  const toggle = (email: string, on: boolean) =>
    onViewersChange(on ? [...viewers, email] : viewers.filter((v) => v !== email));

  return (
    <div>
      <label className="inline-flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name={named ? "private" : undefined}
          checked={isPrivate}
          disabled={disabled}
          onChange={(e) => onPrivateChange(e.currentTarget.checked)}
          className="size-4 accent-[var(--color-accent)]"
        />
        <Lock className="size-3.5" aria-hidden /> Private
      </label>
      <p className="text-xs text-subtle mt-1">
        {isPrivate
          ? "Only you and the people ticked below see this event. Existing share links keep working."
          : "Everyone on the team sees this event."}
      </p>

      {isPrivate && (
        <fieldset className="mt-3" disabled={disabled}>
          <legend className="text-sm font-medium">Who else can see it</legend>
          {options.length === 0 ? (
            <p className="text-xs text-subtle mt-1">No team members yet. Add them on the Users page.</p>
          ) : (
            <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {options.map((u) => (
                <li key={u.email}>
                  <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted">
                    <input
                      type="checkbox"
                      name={named ? "viewers" : undefined}
                      value={u.email}
                      checked={viewers.includes(u.email)}
                      onChange={(e) => toggle(u.email, e.currentTarget.checked)}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                    <span className="min-w-0 truncate">{u.label}</span>
                    {u.label !== u.email && <span className="ml-auto text-xs text-subtle truncate">{u.email}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}
    </div>
  );
}
