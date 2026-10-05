"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Folder, ImageOff, Images, Loader2, X } from "lucide-react";
import { browseEventCoverAction, setEventCoverAction, type CoverBrowse } from "@/app/covers/actions";
import { cleanName, coverSrc } from "@/lib/format";

type Props = {
  slug: string;
  title: string;
  rootId: string;
  /** The picked cover's item id; undefined means the automatic cover. */
  current?: string;
};

type Crumb = { id: string | null; name: string };

/** The event's cover in Settings: a preview, plus a dialog that browses the event's folders to pick any photo. */
export function EventCoverPicker({ slug, title, rootId, current }: Props) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [trail, setTrail] = useState<Crumb[]>([{ id: null, name: title }]);
  const [listing, setListing] = useState<CoverBrowse>();
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string>();
  const [hasCover, setHasCover] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  const open = (next: Crumb[]) =>
    startLoad(async () => {
      setTrail(next);
      setError(undefined);
      const res = await browseEventCoverAction(slug, next.at(-1)!.id);
      if ("error" in res) setError(res.error);
      else setListing(res);
    });

  const save = (itemId: string | null) =>
    startSave(async () => {
      const res = await setEventCoverAction(slug, trail.at(-1)!.id, itemId);
      setError(res.error);
      if (!res.error) {
        dialog.current?.close();
        setHasCover(true);
        router.refresh();
      }
    });

  return (
    <div>
      <span className="text-sm font-medium">Cover</span>
      <div className="mt-1.5 flex items-center gap-3">
        <div className="w-28 aspect-[16/9] bg-muted grid place-items-center overflow-hidden shrink-0">
          {hasCover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={current ?? "auto"}
              src={coverSrc({ event: slug, id: rootId }, current)}
              alt=""
              onError={() => setHasCover(false)}
              className="size-full object-cover"
            />
          ) : (
            <Images className="size-5 text-subtle" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              dialog.current?.showModal();
              setIsOpen(true);
              open([{ id: null, name: title }]);
            }}
            className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted"
          >
            Change
          </button>
          {current && (
            <button
              type="button"
              disabled={saving}
              onClick={() => save(null)}
              className="h-9 px-3 rounded-md text-sm text-subtle hover:text-foreground hover:bg-muted disabled:opacity-60"
            >
              Use automatic
            </button>
          )}
        </div>
      </div>
      {!current && <p className="text-xs text-subtle mt-1">Automatic: the first photo in the event.</p>}
      {error && !isOpen && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <dialog
        ref={dialog}
        onClose={() => {
          setIsOpen(false);
          setError(undefined);
        }}
        aria-labelledby={`cover-${slug}`}
        className="m-auto w-[calc(100%-2rem)] max-w-3xl max-h-[85vh] rounded-lg border border-border bg-surface text-foreground p-0 backdrop:bg-black/50"
      >
        <div className="flex flex-col max-h-[85vh]">
          <div className="flex items-start gap-3 p-5 pb-3">
            <div className="flex-1 min-w-0">
              <h2 id={`cover-${slug}`} className="display text-2xl">
                Choose a cover
              </h2>
              <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm text-subtle mt-1">
                {trail.map((c, i) => (
                  <span key={`${c.id}-${i}`} className="inline-flex items-center gap-1">
                    {i > 0 && <ChevronRight className="size-3.5" aria-hidden />}
                    {i < trail.length - 1 ? (
                      <button type="button" onClick={() => open(trail.slice(0, i + 1))} className="hover:text-foreground hover:underline">
                        {cleanName(c.name)}
                      </button>
                    ) : (
                      <span className="text-foreground">{cleanName(c.name)}</span>
                    )}
                  </span>
                ))}
                {(loading || saving) && <Loader2 className="size-3.5 animate-spin ml-1" aria-label="Loading" />}
              </nav>
            </div>
            <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="size-9 grid place-items-center rounded-md hover:bg-muted">
              <X className="size-4" />
            </button>
          </div>

          {error && (
            <p role="alert" className="mx-5 mb-3 text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-2">
              {error}
            </p>
          )}

          <div className={`overflow-y-auto px-5 pb-5 ${loading ? "opacity-50" : ""}`}>
            {listing && (
              <>
                {listing.folders.length > 0 && (
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 mb-4">
                    {listing.folders.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          disabled={!f.childCount}
                          onClick={() => open([...trail, { id: f.id, name: f.name }])}
                          className="w-full h-10 px-3 rounded-md border border-border text-sm inline-flex items-center gap-2 hover:bg-muted disabled:opacity-50"
                        >
                          <Folder className="size-4 shrink-0 text-subtle" />
                          <span className="truncate">{cleanName(f.name)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {listing.images.length > 0 ? (
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-0.5">
                    {listing.images.map((img) => (
                      <li key={img.id}>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => save(img.id)}
                          title={`Use ${img.name}`}
                          aria-label={`Use ${img.name} as the cover`}
                          className={`relative block w-full aspect-square bg-muted overflow-hidden outline-offset-2 hover:outline hover:outline-2 hover:outline-accent focus-visible:outline focus-visible:outline-2 ${
                            img.id === current ? "outline outline-2 outline-pencil" : ""
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.thumb} alt="" loading="lazy" className="size-full object-cover" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  !loading && (
                    <p className="py-8 text-center text-sm text-subtle inline-flex w-full justify-center items-center gap-2">
                      <ImageOff className="size-4" /> No photos here. Open a folder.
                    </p>
                  )
                )}
                {listing.more > 0 && (
                  <p className="text-xs text-subtle mt-3">Showing the first {listing.images.length} photos; {listing.more} more aren&apos;t listed.</p>
                )}
              </>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
