import { ApiErrorSchema } from "@ondestudio/shared";
import type { ZodType } from "zod";

const API_BASE = "/api/v1";

/**
 * GET a JSON resource and parse it with its shared Zod schema, so the client
 * never trusts the wire: a server/client contract drift surfaces as a loud,
 * named error here instead of an undefined-property crash three components
 * deeper (docs/2 §2.2).
 */
export async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });

  if (!res.ok) {
    throw new Error(`GET ${path} failed with ${res.status}: ${await readErrorMessage(res)}`);
  }

  const result = schema.safeParse(await res.json());
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`GET ${path}: response does not match the shared schema — ${detail}`);
  }
  return result.data;
}

/** Every non-2xx body is the uniform envelope (docs/2 §6.1) — but never assume it. */
async function readErrorMessage(res: Response): Promise<string> {
  try {
    const parsed = ApiErrorSchema.safeParse(await res.json());
    if (parsed.success) return parsed.data.error;
  } catch {
    // Non-JSON body (proxy error page, empty body…) — fall through.
  }
  return res.statusText || "unknown error";
}
