import { randomUUID } from "node:crypto";
import type { JobResult } from "./run.js";

export interface ManualJob {
  id: string;
  title: string;
  status: "running" | "done" | "error";
  startedAt: number;
  results?: JobResult | JobResult[];
  error?: string;
}

const jobs = new Map<string, ManualJob>();

export function startManualJob(
  title: string,
  run: () => Promise<JobResult | JobResult[]>
): string {
  const id = randomUUID();
  jobs.set(id, { id, title, status: "running", startedAt: Date.now() });
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
