import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type Ctx<T extends Record<string, string>> = { params: Promise<T> };

export function json(data: unknown, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ZodError) return json({ error: "Invalid input", issues: e.issues }, 400);
      const msg = e instanceof Error ? e.message : String(e);
      console.error(e);
      return json({ error: msg }, /not found|No .* found/i.test(msg) ? 404 : 500);
    }
  };
}
