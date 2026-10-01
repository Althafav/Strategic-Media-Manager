export type MediaItem = {
  id: string;
  event: string; // slug of the event (share link) the item belongs to
  name: string;
  kind: "folder" | "file";
  size: number;
  childCount?: number;
  mime?: string;
  isImage: boolean;
  isVideo: boolean;
  width?: number;
  height?: number;
  takenAt?: string;
  camera?: string;
  modifiedAt?: string;
  hasThumb?: boolean; // the drive has a thumbnail for this item; the URLs below are built from it
  thumb?: string; // ~400px, an /api/thumb URL (carries t/sig), built by withPreviews
  preview?: string; // ~1920px, an /api/thumb URL (carries t/sig), built by withPreviews
  location?: string[]; // parent folders relative to the event root (search results)
  t?: string; // share token, when seen through a share link
  sig?: string; // signature proving the item is inside that share
};
