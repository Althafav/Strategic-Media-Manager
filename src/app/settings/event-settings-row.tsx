"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2 } from "lucide-react";
import { changeEventLinkAction, renameEventAction, setEventCoordinator, setEventPrivacyAction } from "@/app/events/actions";
import { deleteFaceIndexAction, setFaceScanAction, setFaceSearchAction } from "@/app/faces/actions";
import { requestFaceScan } from "@/lib/face-scan-event";
import type { FaceIndexStatus } from "@/lib/face-types";
import { EventPrivacyFields, type PrivacyUser } from "@/components/event-privacy-fields";
import { EventCoverPicker } from "./event-cover-picker";

type Props = {
  slug: string;
  title: string;
  /** The event's current OneDrive share link. */
  shareUrl: string;
  /** Missing until migration 0011 runs. */
  coordinator?: { current: string | null; users: { email: string; label: string }[] };
  /** Missing until migration 0019 runs. */
  privacy?: { hidden: boolean; viewers: string[]; users: PrivacyUser[] };
  /** The event's root folder; null until the event's link has been opened once. */
  rootId: string | null;
  /** Item id of the cover picked here, if any. */
  coverId?: string;
  /**
   * Face search: `scan` = photos are scanned (team search, People), `on` = also on share links, `canSwitchScan` = migration
   * 0025 ran (before it, only the share-link switch exists and it alone decides scanning). Missing until migration 0023 runs.
   */
  faces?: { scan: boolean; on: boolean; canSwitchScan: boolean; status: FaceIndexStatus | null };
};

const field =
  "w-full h-10 rounded-md bg-background border border-border px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

/** One event's admin settings: name and privacy (saved on demand), coordinator (saved on change) and cover. */
export function EventSettingsRow({ slug, title, shareUrl, coordinator, privacy, rootId, coverId, faces }: Props) {
  const router = useRouter();
  const [name, setName] = useState(title);
  const [renaming, startRename] = useTransition();
  const [assigning, startAssign] = useTransition();
  const [error, setError] = useState<string>();
  const dirty = name.trim() !== title && !!name.trim();

  const rename = () =>
    startRename(async () => {
      const res = await renameEventAction(slug, name);
      setError(res.error);
      if (!res.error) router.refresh();
    });

  return (
    <li className="px-4 py-4">
      <div className="grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3 items-end">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) rename();
          }}
          className="flex items-end gap-2"
        >
          <label className="block flex-1 min-w-0">
            <span className="text-sm font-medium">Event name</span>
            <input
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              required
              maxLength={120}
              disabled={renaming}
              className={`${field} mt-1.5`}
            />
          </label>
          <button
            disabled={!dirty || renaming}
            className="h-10 px-3 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-40"
          >
            {renaming ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save
          </button>
        </form>

        {coordinator && (
          <label className="block">
            <span className="text-sm font-medium inline-flex items-center gap-2">
              Marketing coordinator {assigning && <Loader2 className="size-3.5 animate-spin text-subtle" />}
            </span>
            <select
              value={coordinator.current ?? ""}
              disabled={assigning}
              onChange={(e) => {
                const email = e.currentTarget.value;
                startAssign(async () => {
                  const res = await setEventCoordinator(slug, email);
                  setError(res.error);
                  router.refresh();
                });
              }}
              className={`${field} mt-1.5`}
            >
              <option value="">None</option>
              {coordinator.current && !coordinator.users.some((u) => u.email === coordinator.current) && (
                <option value={coordinator.current}>{coordinator.current}</option>
              )}
              {coordinator.users.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <LinkSection slug={slug} shareUrl={shareUrl} onError={setError} />
      {privacy && <PrivacySection slug={slug} privacy={privacy} onError={setError} />}
      {faces && <FaceSearchSection slug={slug} faces={faces} onError={setError} />}
      {rootId && (
        <div className="mt-4">
          <EventCoverPicker slug={slug} title={title} rootId={rootId} current={coverId} />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-2">
          {error}
        </p>
      )}
    </li>
  );
}

/** Replaces the event's OneDrive link, e.g. after the folder was re-shared or moved to a new copy. */
function LinkSection({ slug, shareUrl, onError }: { slug: string; shareUrl: string; onError: (error: string | undefined) => void }) {
  const router = useRouter();
  const [link, setLink] = useState(shareUrl);
  const [message, setMessage] = useState<string>();
  const [saving, startSave] = useTransition();
  const dirty = link.trim() !== shareUrl && !!link.trim();

  const save = () =>
    startSave(async () => {
      setMessage(undefined);
      const res = await changeEventLinkAction(slug, link);
      onError(res.error);
      setMessage(res.message);
      if (!res.error) router.refresh();
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) save();
      }}
      className="mt-4"
    >
      <label className="block">
        <span className="text-sm font-medium">OneDrive link</span>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="url"
            value={link}
            onChange={(e) => {
              setLink(e.currentTarget.value);
              setMessage(undefined);
            }}
            required
            disabled={saving}
            spellCheck={false}
            className={`${field} font-mono text-xs min-w-0`}
          />
          <button
            disabled={!dirty || saving}
            className="h-10 px-3 shrink-0 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-40"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {saving ? "Checking link…" : "Update link"}
          </button>
        </div>
      </label>
      <p className="mt-1.5 text-xs text-subtle">
        Paste the new folder link shared with “Anyone with the link”. The event’s address, share links and likes stay the same.
      </p>
      {message && (
        <p role="status" className="mt-2 text-sm rounded-md border border-border bg-background px-3 py-2">
          {message}
        </p>
      )}
    </form>
  );
}

function PrivacySection({
  slug,
  privacy,
  onError,
}: {
  slug: string;
  privacy: NonNullable<Props["privacy"]>;
  onError: (error: string | undefined) => void;
}) {
  const router = useRouter();
  const [isPrivate, setPrivate] = useState(privacy.hidden);
  const [viewers, setViewers] = useState(privacy.viewers);
  const [saving, startSave] = useTransition();
  const dirty =
    isPrivate !== privacy.hidden ||
    (isPrivate && (viewers.length !== privacy.viewers.length || viewers.some((v) => !privacy.viewers.includes(v))));

  const save = () =>
    startSave(async () => {
      const res = await setEventPrivacyAction(slug, isPrivate, viewers);
      onError(res.error);
      if (!res.error) router.refresh();
    });

  return (
    <div className="mt-4">
      <EventPrivacyFields
        users={privacy.users}
        isPrivate={isPrivate}
        viewers={viewers}
        onPrivateChange={setPrivate}
        onViewersChange={setViewers}
        disabled={saving}
      />
      {dirty && (
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mt-3 h-9 px-3 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-40"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Save visibility
        </button>
      )}
    </div>
  );
}

/**
 * Face search for one event: scanning on/off (team "Find my photos" and People), under it the share-link switch for
 * guests, how far the background scan is, and deleting the face index.
 */
function FaceSearchSection({
  slug,
  faces,
  onError,
}: {
  slug: string;
  faces: NonNullable<Props["faces"]>;
  onError: (error: string | undefined) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { status } = faces;
  const n = (v: number) => v.toLocaleString("en-GB");

  const run = (action: () => Promise<{ error?: string }>, scanNow: boolean) =>
    start(async () => {
      const res = await action();
      onError(res.error);
      router.refresh();
      // Start on the newly switched-on event now instead of at the scanner's next check.
      if (!res.error && scanNow) requestFaceScan();
    });

  const guestSwitch = (
    <label className={`flex items-start gap-2 text-sm ${faces.canSwitchScan ? "mt-2 ml-6" : ""} ${faces.canSwitchScan && !faces.scan ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        checked={faces.on}
        disabled={pending || (faces.canSwitchScan && !faces.scan)}
        onChange={(e) => {
          const on = e.currentTarget.checked;
          run(() => setFaceSearchAction(slug, on), on);
        }}
        className="mt-0.5"
      />
      <span>
        <span className="font-medium inline-flex items-center gap-2">
          {faces.canSwitchScan ? "Also on share links" : "Find my photos on share links"}
          {!faces.canSwitchScan && pending && <Loader2 className="size-3.5 animate-spin text-subtle" />}
        </span>
        <span className="block text-xs text-subtle">Guests take a selfie to see the photos they&apos;re in.</span>
      </span>
    </label>
  );

  return (
    <div className="mt-4">
      {faces.canSwitchScan && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={faces.scan}
            disabled={pending}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              run(() => setFaceScanAction(slug, on), on);
            }}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium inline-flex items-center gap-2">
              Face search {pending && <Loader2 className="size-3.5 animate-spin text-subtle" />}
            </span>
            <span className="block text-xs text-subtle">
              Scan this event&apos;s photos for faces, so the team can use Find my photos and People.
            </span>
          </span>
        </label>
      )}
      {guestSwitch}
      {status && (faces.scan || status.scanned > 0) && (
        <p className="mt-2 text-xs text-subtle">
          {!faces.scan
            ? `Scanning is off. The ${n(status.scanned)} photos already scanned are kept.`
            : `${n(status.scanned)} of ${n(status.images)} photos scanned, ${n(status.faces)} faces. ${
                status.scanned < status.images
                  ? "The rest are scanned in the background while you have the app open."
                  : "New photos are scanned by themselves after each sync."
              }`}
        </p>
      )}
      {!!status?.scanned && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirm("Delete this event's face index and its People? The photos are scanned again by themselves afterwards.")) {
              run(() => deleteFaceIndexAction(slug), faces.scan);
            }
          }}
          className="mt-2 h-9 px-3 rounded-md border border-border text-sm font-medium inline-flex items-center gap-1.5 hover:border-red-500 hover:text-red-600 disabled:opacity-40"
        >
          <Trash2 className="size-3.5" /> Delete face index
        </button>
      )}
    </div>
  );
}
