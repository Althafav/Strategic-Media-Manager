import { isMxfName, thumbSrc } from "@/lib/format";
import type { MediaItem } from "@/lib/onedrive/types";

/** A row of the `nodes` search index. */
export type NodeRow = {
  id: string;
  event_id: string;
  name: string;
  kind: "folder" | "file";
  size: number;
  child_count: number | null;
  mime: string | null;
  is_image: boolean;
  is_video: boolean;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  camera: string | null;
  modified_at: string | null;
  path: string | null;
};

/** Index row -> gallery item. Thumbnails go through /api/thumb, so they don't expire like OneDrive's signed URLs. */
export function nodeToItem(r: NodeRow, event: string): MediaItem {
  // MXF rows indexed before they counted as video still say is_video = false.
  const mxf = r.kind === "file" && isMxfName(r.name);
  const hasThumb = r.is_image || (r.is_video && !mxf);
  return {
    id: r.id,
    event,
    name: r.name,
    kind: r.kind,
    size: Number(r.size),
    childCount: r.child_count ?? undefined,
    mime: r.mime ?? undefined,
    isImage: r.is_image,
    isVideo: r.is_video || mxf,
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    takenAt: r.taken_at ?? undefined,
    camera: r.camera ?? undefined,
    modifiedAt: r.modified_at ?? undefined,
    thumb: hasThumb ? thumbSrc({ event, id: r.id }, 400) : undefined,
    preview: hasThumb ? thumbSrc({ event, id: r.id }, 1920) : undefined,
    location: r.path ? r.path.split("/") : [],
  };
}

const VIDEO_EXT = /\.(mp4|mov|m4v|avi|mkv|webm|wmv|mts|3gp|mxf)$/i;

/**
 * A hand-picked item (photo request, album) as a gallery item. Details come from its index row; items the index
 * doesn't have yet (not synced) fall back to the stored name/kind. `location` is the folder stored with the pick.
 */
export function pickedItem(
  pick: { id: string; name: string; kind: "file" | "folder" },
  event: string,
  location: string[],
  node: NodeRow | undefined,
): MediaItem {
  if (node) return node.path == null ? { ...nodeToItem(node, event), location } : nodeToItem(node, event);
  const isVideo = pick.kind === "file" && VIDEO_EXT.test(pick.name);
  const ref = { event, id: pick.id };
  return {
    id: pick.id,
    event,
    name: pick.name,
    kind: pick.kind,
    size: 0,
    isImage: pick.kind === "file" && !isVideo,
    isVideo,
    thumb: pick.kind === "file" ? thumbSrc(ref, 400) : undefined,
    preview: pick.kind === "file" ? thumbSrc(ref, 1920) : undefined,
    location,
  };
}
