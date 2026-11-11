"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Check, ImageUp, Loader2, ScanFace } from "lucide-react";
import { findMyPhotosTeamAction } from "@/app/faces/actions";
import { findMyPhotosAction, type FaceMatch } from "@/app/s/[token]/actions";
import { Gallery } from "@/components/gallery";
import { ShareDialog } from "@/components/share-folder-button";
import { Button } from "@/components/ui/button";
import type { Face } from "@/lib/faces";
import { DEFAULT_MATCH_LEVEL, LEVEL_DIST, MATCH_LEVELS, packEmbedding, type MatchLevel } from "@/lib/face-types";
import { shareHref } from "@/lib/format";
import { decode } from "@/lib/image-compress";
import { FacePicker, faceThumb, type PickableFace } from "./face-picker";
import { MatchLevelToggle } from "./match-level-toggle";
import { SelfieCamera } from "./selfie-camera";

type Stage = "choose" | "camera" | "pick" | "working";
type Step = "face" | "search";

const STEPS: { id: Step; label: string }[] = [
  { id: "face", label: "Finding your face" },
  { id: "search", label: "Searching the photos" },
];

/** The last search of this tab, so results are still there after opening a folder and coming back. */
type Saved = { embedding: string; thumb: string };

function readSaved(key: string): Saved | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, value: Saved | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    // Storage blocked: the search still works, it just isn't remembered.
  }
}

/**
 * "Find my photos": the visitor takes a selfie (or picks a photo), the browser turns the face into an embedding
 * (lib/faces.ts) and the server returns the photos with a matching face. The photo never leaves the device.
 * `token` on a share link, `slug` on a team event page. While results show, `children` (the normal contents)
 * are hidden.
 */
export function FindMyPhotos({ token, slug, children }: { token?: string; slug?: string; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("choose");
  const [step, setStep] = useState<Step>("face");
  const [error, setError] = useState<string>();
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [choices, setChoices] = useState<{ faces: Face[]; thumbs: PickableFace[] }>();
  const [thumb, setThumb] = useState<string>();
  const [matches, setMatches] = useState<FaceMatch[] | null>(null);
  const [level, setLevel] = useState<MatchLevel>(DEFAULT_MATCH_LEVEL);
  const key = `smm:face:${token ?? slug}`;

  const search = async (embedding: string) => {
    const res = token ? await findMyPhotosAction(token, embedding) : await findMyPhotosTeamAction(slug!, embedding);
    if (res.error) throw new Error(res.error);
    return res.matches ?? [];
  };

  // Back on the page after opening a folder: show the same results again.
  useEffect(() => {
    const saved = readSaved(key);
    if (!saved) return;
    let stale = false;
    search(saved.embedding)
      .then((found) => {
        if (stale) return;
        setThumb(saved.thumb);
        setMatches(found);
      })
      .catch(() => writeSaved(key, null));
    return () => {
      stale = true;
    };
    // `search` only depends on token/slug, which are in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The models are large, so start fetching them when the visitor shows interest, not on every page view.
  const warmUp = () => void import("@/lib/faces").then((m) => m.loadFaces()).catch(() => {});

  const show = () => {
    setError(undefined);
    setStage("choose");
    setOpen(true);
    dialog.current?.showModal();
    warmUp();
  };

  const fail = (e: unknown) => {
    setError((e as Error).message || "Something went wrong. Try again.");
    setStage("choose");
  };

  const runSearch = async (face: Face, faceImage: string) => {
    setStage("working");
    setStep("search");
    try {
      const embedding = packEmbedding(face.embedding);
      const found = await search(embedding);
      writeSaved(key, { embedding, thumb: faceImage });
      setThumb(faceImage);
      setMatches(found);
      setLevel(DEFAULT_MATCH_LEVEL);
      dialog.current?.close();
      scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      fail(e);
    }
  };

  /** Takes over `bitmap` and closes it. */
  const searchPhoto = async (bitmap: ImageBitmap) => {
    setError(undefined);
    setStage("working");
    setStep("face");
    try {
      const { detectFaces } = await import("@/lib/faces");
      // detectFaces takes over the bitmap it's given; keep ours for the face crops.
      const faces = await detectFaces(await createImageBitmap(bitmap));
      if (!faces.length) {
        throw new Error("We couldn't see a face. Use a photo where your face is clear, facing the camera, in good light.");
      }
      const thumbs = faces.map((f, index) => ({ index, thumb: faceThumb(bitmap, f.box) }));
      if (faces.length === 1) return await runSearch(faces[0], thumbs[0].thumb);
      setChoices({ faces, thumbs });
      setStage("pick");
    } catch (e) {
      fail(e);
    } finally {
      bitmap.close();
    }
  };

  const fromFile = async (file: File | undefined) => {
    if (library.current) library.current.value = "";
    if (!file) return;
    const bitmap = await decode(file).catch(() => null);
    if (!bitmap) return fail(new Error("This photo can't be opened here. Try a JPG or PNG, or use the camera."));
    await searchPhoto(bitmap);
  };

  const clear = () => {
    writeSaved(key, null);
    setMatches(null);
  };

  const within = (l: MatchLevel) => matches?.filter((m) => m.distance <= LEVEL_DIST[l]) ?? [];
  const shown = within(level);
  const counts = Object.fromEntries(MATCH_LEVELS.map((l) => [l, within(l).length])) as Record<MatchLevel, number>;
  const current = STEPS.findIndex((s) => s.id === step);

  return (
    <>
      {!matches && (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3">
          <ScanFace className="size-6 shrink-0" />
          <p className="flex-1 min-w-52 text-sm">
            <strong className="font-semibold">Looking for yourself?</strong>{" "}
            <span className="text-subtle">Take a selfie and we&apos;ll show the photos you&apos;re in.</span>
          </p>
          <Button variant="primary" onClick={show} onPointerEnter={warmUp} onFocus={warmUp}>
            <Camera className="size-4" /> Find my photos
          </Button>
        </div>
      )}

      <ShareDialog
        ref={dialog}
        title="Find my photos"
        description="Use a clear photo of your face, looking at the camera."
        onClose={() => setOpen(false)}
      >
        {/* Unmounted with the dialog, so the camera is released as soon as it closes. */}
        {open && stage === "camera" && (
          <SelfieCamera
            onCapture={searchPhoto}
            onBlocked={() => {
              setCameraBlocked(true);
              setStage("choose");
            }}
          />
        )}
        {open && stage === "pick" && choices && (
          <FacePicker
            faces={choices.thumbs}
            onPick={(i) => runSearch(choices.faces[i], choices.thumbs.find((t) => t.index === i)!.thumb)}
          />
        )}
        {stage === "working" && (
          <ol aria-live="polite" className="space-y-2 text-sm">
            {STEPS.map((s, i) => (
              <li key={s.id} className={`flex items-center gap-2.5 ${i > current ? "text-subtle" : ""}`}>
                <span className="grid size-5 place-items-center">
                  {i < current ? <Check className="size-4" /> : i === current ? <Loader2 className="size-4 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
                </span>
                <span className={i === current ? "font-medium" : ""}>
                  {s.label}
                  {i === current && s.id === "face" && <span className="block text-xs font-normal text-subtle">The first time takes a few seconds longer.</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
        {stage === "choose" && (
          <div className="flex flex-col gap-2">
            {cameraBlocked ? (
              <p className="text-sm rounded-md border border-border bg-background px-3 py-2">
                The camera is blocked or not available here. Choose a photo of yourself instead.
              </p>
            ) : (
              <Button variant="primary" size="lg" onClick={() => setStage("camera")}>
                <Camera className="size-5" /> Use the camera
              </Button>
            )}
            <Button variant={cameraBlocked ? "primary" : "outline"} size={cameraBlocked ? "lg" : "md"} onClick={() => library.current?.click()}>
              <ImageUp className="size-4" /> Choose a photo
            </Button>
          </div>
        )}
        <input ref={library} type="file" accept="image/*" hidden onChange={(e) => fromFile(e.currentTarget.files?.[0])} />
        {error && stage === "choose" && (
          <p role="alert" className="text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 px-3 py-2">
            {error}
          </p>
        )}
        <p className="text-xs text-subtle">
          Your photo stays on your device. Only a face fingerprint is compared with the event photos, and it isn&apos;t stored.
        </p>
      </ShareDialog>

      {matches && (
        <section aria-label="Photos of you" className="mt-6">
          <div className="flex flex-wrap items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {thumb && <img src={thumb} alt="The face we searched for" className="size-14 object-cover border border-border" />}
            <div className="flex-1 min-w-52">
              <h2 className="display text-2xl">
                {shown.length ? `${shown.length} ${shown.length === 1 ? "photo" : "photos"} of you` : "No photos of you at this setting"}
              </h2>
              {!shown.length && (
                <p className="text-sm text-subtle">
                  {matches.length
                    ? "Switch to Loose to see possible matches."
                    : "Try another selfie: face the camera, in good light, without sunglasses."}
                </p>
              )}
            </div>
            <MatchLevelToggle level={level} onLevel={setLevel} counts={counts} />
            <Button onClick={show}>
              <Camera className="size-4" /> Try another photo
            </Button>
            <Button onClick={clear}>
              <ArrowLeft className="size-4" /> All photos
            </Button>
          </div>
          {shown.length > 0 && (
            <Gallery
              // A new grid per level, so selection and scroll don't carry over to a different set.
              key={level}
              path={[]}
              base={token ? shareHref(token) : undefined}
              folderName="Photos of me"
              items={shown.map((m) => m.item)}
              downloadAll={shown.map((m) => m.item)}
              listedOrder="Best match"
            />
          )}
        </section>
      )}
      <div hidden={!!matches}>{children}</div>
    </>
  );
}
