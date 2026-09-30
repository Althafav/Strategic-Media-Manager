/** Client-safe photo request types and labels (the queries live in requests.ts, which is server-only). */
export const REQUEST_STATUSES = ["pending", "in_progress", "fulfilled", "declined"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "New",
  in_progress: "In progress",
  fulfilled: "Fulfilled",
  declined: "Declined",
};

export const MAX_REQUEST_LENGTH = 2000;

export type PhotoRequestRow = {
  id: string;
  event_id: string;
  requested_by: string;
  message: string;
  folder_path: string[];
  status: RequestStatus;
  coordinator_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

export const isRequestStatus = (v: unknown): v is RequestStatus => REQUEST_STATUSES.includes(v as RequestStatus);
