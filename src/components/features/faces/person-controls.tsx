"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Pencil, Save } from "lucide-react";
import { renamePersonAction, setPersonHiddenAction } from "@/app/faces/actions";
import { ShareDialog } from "@/components/share-folder-button";
import { Button } from "@/components/ui/button";
import { MAX_PERSON_NAME } from "@/lib/face-types";

/** The admin's buttons on a person's page: give them a name, or hide them from the team's People view. */
export function PersonControls({ slug, person }: { slug: string; person: { id: string; name: string; hidden: boolean } }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(person.name);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const run = (action: () => Promise<{ error?: string }>, done?: () => void) =>
    start(async () => {
      const res = await action();
      setError(res.error);
      if (res.error) return;
      done?.();
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={() => dialog.current?.showModal()}>
        <Pencil className="size-4" /> {person.name ? "Rename" : "Add a name"}
      </Button>
      <Button disabled={pending} onClick={() => run(() => setPersonHiddenAction(slug, person.id, !person.hidden))}>
        {person.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />} {person.hidden ? "Show to the team" : "Hide from the team"}
      </Button>

      <ShareDialog ref={dialog} title="Name this person" description="The name shows on the People page for everyone on the team. Leave it empty to remove it.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => renamePersonAction(slug, person.id, name),
              () => dialog.current?.close(),
            );
          }}
          className="flex items-end gap-2"
        >
          <label className="block flex-1 min-w-0">
            <span className="text-sm font-medium">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              maxLength={MAX_PERSON_NAME}
              autoFocus
              className="mt-1.5 w-full h-10 rounded-md bg-background border border-border px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
          </label>
          <Button type="submit" variant="primary" disabled={pending} className="h-10">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 px-3 py-2">
            {error}
          </p>
        )}
      </ShareDialog>
    </div>
  );
}
