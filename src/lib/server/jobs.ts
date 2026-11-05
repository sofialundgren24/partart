// DB-backed background jobs with an in-process runner. Jobs survive restarts: anything left "running" by a dead
// process is re-queued on the next kick. Each handler must be idempotent (safe to retry).
// Production: replace `kick` with a separate worker process (e.g. BullMQ/Redis or a Postgres queue).
import { db } from "./db";

export type JobHandler = (job: { id: string; projectId: string; payload: unknown }, progress: (p: number, msg: string) => Promise<void>) => Promise<unknown>;

const g = globalThis as unknown as { __partartJobs?: { handlers: Map<string, JobHandler>; running: boolean; recovered: boolean } };
const state = (g.__partartJobs ??= { handlers: new Map(), running: false, recovered: false });

export function registerJob(type: string, handler: JobHandler) {
  state.handlers.set(type, handler);
}

export async function enqueue(type: string, projectId: string, payload: unknown = {}) {
  const job = await db.job.create({ data: { type, projectId, payloadJson: JSON.stringify(payload) } });
  kick();
  return job;
}

export function kick() {
  if (state.running) return;
  state.running = true;
  setImmediate(async () => {
    try {
      if (!state.recovered) {
        state.recovered = true;
        await db.job.updateMany({ where: { status: "running" }, data: { status: "queued", message: "Re-queued after restart" } });
      }
      for (;;) {
        const job = await db.job.findFirst({ where: { status: "queued" }, orderBy: { createdAt: "asc" } });
        if (!job) break;
        await runOne(job.id);
      }
    } finally {
      state.running = false;
    }
  });
}

async function runOne(id: string) {
  const job = await db.job.update({ where: { id }, data: { status: "running", startedAt: new Date(), attempts: { increment: 1 }, progress: 0 } });
  const handler = state.handlers.get(job.type);
  if (!handler) {
    await db.job.update({ where: { id }, data: { status: "failed", error: `No handler for ${job.type}`, finishedAt: new Date() } });
    return;
  }
  const progress = async (p: number, message: string) => {
    await db.job.update({ where: { id }, data: { progress: p, message } });
  };
  try {
    const result = await handler({ id, projectId: job.projectId, payload: JSON.parse(job.payloadJson) }, progress);
    await db.job.update({ where: { id }, data: { status: "done", progress: 1, resultJson: JSON.stringify(result ?? null), finishedAt: new Date(), message: "Done" } });
  } catch (e) {
    const err = e instanceof Error ? `${e.message}` : String(e);
    console.error(`[job ${job.type} ${id}]`, e);
    const retry = job.attempts < job.maxAttempts;
    await db.job.update({ where: { id }, data: { status: retry ? "queued" : "failed", error: err, message: retry ? `Retrying after error: ${err}` : `Failed: ${err}`, finishedAt: retry ? null : new Date() } });
  }
}
