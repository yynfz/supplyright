import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Wraps a route handler: maps HttpError/ZodError to JSON responses with Indonesian messages. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError) {
        const first = e.issues[0];
        return NextResponse.json(
          { error: `Input tidak valid: ${first?.path.join(".") || "body"} - ${first?.message}` },
          { status: 400 },
        );
      }
      console.error("[api]", e);
      return NextResponse.json({ error: "Kesalahan server internal." }, { status: 500 });
    }
  };
}

export function dbError(error: { message: string } | null, context: string): never | void {
  if (error) {
    console.error(`[supabase] ${context}:`, error.message);
    throw new HttpError(500, `Gagal ${context}.`);
  }
}
