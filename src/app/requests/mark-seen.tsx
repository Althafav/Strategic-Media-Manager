"use client";

import { useEffect } from "react";
import { REQUESTS_SEEN_EVENT, type RequestsSeen } from "@/lib/request-types";
import { markRequestsSeenAction } from "./actions";

/**
 * Renders nothing. Once the page has shown the viewer their new requests or replies, records that they've seen them
 * and clears them from the header badge. The page keeps its own highlights until the next visit.
 */
export function MarkSeen({ inboxUpTo, sent, id }: { inboxUpTo?: string; sent?: boolean; id?: string }) {
  useEffect(() => {
    const detail: RequestsSeen = { inbox: !!inboxUpTo, sent, reply: !!id };
    window.dispatchEvent(new CustomEvent(REQUESTS_SEEN_EVENT, { detail }));
    void markRequestsSeenAction({ inboxUpTo, sent, id }).catch(() => {});
  }, [inboxUpTo, sent, id]);
  return null;
}
