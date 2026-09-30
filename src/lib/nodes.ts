import { thumbSrc } from "@/lib/format";
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
  const hasThumb = r.is_image || r.is_video;
  return {
    id: r.id,
    event,
    name: r.name,
    kind: r.kind,
    size: Number(r.size),
    childCount: r.child_count ?? undefined,
    mime: r.mime ?? undefined,
    isImage: r.is_image,
    isVideo: r.is_video,
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
