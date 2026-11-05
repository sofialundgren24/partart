"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "content-type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface JobRow { id: string; type: string; status: "queued" | "running" | "done" | "failed"; progress: number; message: string; error: string | null }

/** Poll a background job until it settles. */
export function useJob(jobId: string | null, onDone?: (j: JobRow) => void) {
  const [job, setJob] = useState<JobRow | null>(null);
  const cb = useRef(onDone);
  cb.current = onDone;
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const tick = async () => {
      try {
        const j = await api<JobRow>(`/api/jobs/${jobId}`);
        if (!alive) return;
        setJob(j);
        if (j.status === "done" || j.status === "failed") { cb.current?.(j); return; }
      } catch { /* keep polling */ }
      if (alive) setTimeout(tick, 900);
    };
    tick();
    return () => { alive = false; };
  }, [jobId]);
  return job;
}

export function useFetch<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    api<T>(url).then((d) => alive && (setData(d), setError(null))).catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [url, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, error, reload, setData };
}
