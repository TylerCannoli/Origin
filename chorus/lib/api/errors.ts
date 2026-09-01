import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/auth/server";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new ApiError(404, `${what} not found`);
export const forbidden = (msg = "You do not have access to this resource") => new ApiError(403, msg);
export const badRequest = (msg: string, details?: unknown) => new ApiError(400, msg, details);

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response>;

/** Wraps a route handler with uniform JSON error responses. */
export function handle<Ctx = { params: Promise<Record<string, string>> }>(fn: Handler<Ctx>): Handler<Ctx> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message, details: err.details ?? null }, { status: err.status });
      }
      if (err instanceof UnauthorizedError) {
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: "Invalid request", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          { status: 400 },
        );
      }
      console.error("[api] unhandled error", err);
      return NextResponse.json({ error: "Something went wrong on our side. Try again in a moment." }, { status: 500 });
    }
  };
}

export async function readJson<T>(req: Request, parse: (data: unknown) => T): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  return parse(body);
}

export const json = <T>(data: T, init?: ResponseInit) => NextResponse.json(data, init);
