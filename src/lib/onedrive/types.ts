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
  thumb?: string; // ~400px, signed, short-lived
  preview?: string; // ~1920px, signed, short-lived
  location?: string[]; // parent folders relative to the event root (search results)
  t?: string; // share token, when seen through a share link
  sig?: string; // signature proving the item is inside that share
};
