import { randomUUID } from "node:crypto";
import type { JobResult } from "./run.js";
import { emptyTrace, runWithJobSink, type JobTrace } from "./progress.js";

export type ManualJobKind = "mail" | "wa" | "triage" | "agt";

export interface ManualJob {
  id: string;
  kind: ManualJobKind;
  title: string;
  status: "running" | "done" | "error";
  startedAt: number;
  trace: JobTrace;
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
  const job: ManualJob = {
    id,
    kind,
    title,
    status: "running",
    startedAt: Date.now(),
    trace: emptyTrace(),
  };
  jobs.set(id, job);
  void runWithJobSink(job.trace, run)
    .then((results) => {
      const cur = jobs.get(id);
      if (!cur) return;
      cur.trace.pct = 100;
      cur.trace.stepLabel = "Concluído.";
      cur.trace.lastEventAt = Date.now();
      jobs.set(id, { ...cur, status: "done", results });
    })
    .catch((err) => {
      const cur = jobs.get(id);
      if (!cur) return;
      const msg = err instanceof Error ? err.message : String(err);
      cur.trace.errors.push(`${new Date().toISOString().slice(11, 19)}  ${msg}`);
      jobs.set(id, { ...cur, status: "error", error: msg });
    });
  return id;
}

export function getManualJob(id: string): ManualJob | undefined {
  return jobs.get(id);
}
