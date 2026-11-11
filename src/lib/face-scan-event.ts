/**
 * Browser event that tells the background face scanner (components/features/faces/face-scanner.tsx, admin only)
 * to look for unscanned photos now. Fired by "Sync now" so new uploads become searchable right after an index
 * update. Kept apart from the scanner so pages that only fire it don't bundle the scanner.
 */
export const SCAN_EVENT = "smm:scan-faces";

export const requestFaceScan = () => window.dispatchEvent(new Event(SCAN_EVENT));
