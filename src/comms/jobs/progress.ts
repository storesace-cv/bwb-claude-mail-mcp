import { AsyncLocalStorage } from "node:async_hooks";

const MAX_LINES = 200;

export interface JobTrace {
  step: string;
  stepLabel: string;
  pct: number;
  logs: string[];
  errors: string[];
  lastEventAt: number;
}

const als = new AsyncLocalStorage<JobTrace>();

export function emptyTrace(): JobTrace {
  return {
    step: "",
    stepLabel: "A iniciar…",
    pct: 0,
    logs: [],
    errors: [],
    lastEventAt: Date.now(),
  };
}

export function runWithJobSink<T>(trace: JobTrace, fn: () => Promise<T>): Promise<T> {
  return als.run(trace, fn);
}

function stamp(line: string): string {
  return `${new Date().toISOString().slice(11, 19)}  ${line}`;
}

function push(list: string[], line: string): void {
  list.push(stamp(line));
  if (list.length > MAX_LINES) list.splice(0, list.length - MAX_LINES);
}

function trace(): JobTrace | undefined {
  return als.getStore();
}

export function jobStep(key: string, label: string): void {
  const t = trace();
  if (!t) return;
  t.step = key;
  t.stepLabel = label;
  t.lastEventAt = Date.now();
}

export function jobProgress(pct: number): void {
  const t = trace();
  if (!t) return;
  t.pct = Math.min(99, Math.max(0, Math.round(pct)));
  t.lastEventAt = Date.now();
}

export function jobLog(line: string): void {
  const t = trace();
  if (!t) return;
  push(t.logs, line);
  t.lastEventAt = Date.now();
}

export function jobError(line: string): void {
  const t = trace();
  if (!t) return;
  push(t.errors, line);
  t.lastEventAt = Date.now();
}
