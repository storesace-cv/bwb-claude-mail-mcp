import { randomUUID } from "node:crypto";
import type { JobResult } from "./run.js";

export type ManualJobKind = "mail" | "wa" | "triage" | "agt";

export interface ManualJob {
  id: string;
  kind: ManualJobKind;
  title: string;
  status: "running" | "done" | "error";
  startedAt: number;
  results?: JobResult | JobResult[];
  error?: string;
}

const jobs = new Map<string, ManualJob>();

export function startManualJob(
  title: string,
  kind: ManualJobKind,
  run: () => Promise<JobResult | JobResult[]>
): string {
  const id = randomUUID();
  jobs.set(id, { id, kind, title, status: "running", startedAt: Date.now() });
  void run()
    .then((results) => {
      const cur = jobs.get(id);
      if (!cur) return;
      jobs.set(id, { ...cur, status: "done", results });
    })
    .catch((err) => {
      const cur = jobs.get(id);
      if (!cur) return;
      jobs.set(id, {
        ...cur,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    });
  return id;
}

export function getManualJob(id: string): ManualJob | undefined {
  return jobs.get(id);
}
