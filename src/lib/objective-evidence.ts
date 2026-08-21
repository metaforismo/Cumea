import type { EvidenceRecord } from "@/state/store";

export type EvidenceDisplayState = "pending" | "claimed" | "observed" | "verified" | "failed";

/** UI projection only. Canonical verification is computed server-side. */
export function evidenceDisplayState(records: readonly Pick<EvidenceRecord, "level">[]): EvidenceDisplayState {
  if (records.some((record) => record.level === "rejected")) return "failed";
  if (records.some((record) => record.level === "verified")) return "verified";
  if (records.some((record) => record.level === "observed")) return "observed";
  if (records.some((record) => record.level === "claimed")) return "claimed";
  return "pending";
}
