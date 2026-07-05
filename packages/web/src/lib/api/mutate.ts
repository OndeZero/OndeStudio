import { ApiErrorSchema } from "@ondestudio/shared";
import type { ZodType } from "zod";

const API_BASE = "/api/v1";

/**
 * A failed write, keeping the envelope's domain `kind` (docs/2 §6.1) so the
 * UI can react to expected failures by name — e.g. a 409
 * `illegal-transition` from the negotiation state machine.
 */
export class ApiMutationError extends Error {
  readonly status: number;
  readonly kind: string | undefined;

  constructor(message: string, status: number, kind?: string) {
    super(message);
    this.name = "ApiMutationError";
    this.status = status;
    this.kind = kind;
  }
}

type MutationMethod = "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Send a write and parse the response with its shared Zod schema — the same
 * never-trust-the-wire stance as `apiGet`. The schema-less overload covers
 * 204 responses (DELETE).
 */
export async function apiMutate<T>(
  method: MutationMethod,
  path: string,
  body: unknown,
  schema: ZodType<T>,
): Promise<T>;
export async function apiMutate(
  method: MutationMethod,
  path: string,
  body?: unknown,
): Promise<void>;
export async function apiMutate<T>(
  method: MutationMethod,
  path: string,
  body?: unknown,
  schema?: ZodType<T>,
): Promise<T | undefined> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers:
      body === undefined
        ? { Accept: "application/json" }
        : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });

  if (!res.ok) {
    const envelope = await readEnvelope(res);
    throw new ApiMutationError(
      `${method} ${path} failed with ${res.status}: ${envelope.message}`,
      res.status,
      envelope.kind,
    );
  }
  if (!schema) return undefined;

  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ApiMutationError(
      `${method} ${path}: response does not match the shared schema`,
      res.status,
    );
  }
  return parsed.data;
}

/** Every non-2xx body is the uniform envelope (docs/2 §6.1) — but never assume it. */
async function readEnvelope(res: Response): Promise<{ message: string; kind?: string }> {
  try {
    const parsed = ApiErrorSchema.safeParse(await res.json());
    if (parsed.success) return { message: parsed.data.error, kind: parsed.data.kind };
  } catch {
    // Non-JSON body (proxy error page, empty body…) — fall through.
  }
  return { message: res.statusText || "unknown error" };
}
