import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The cookie-signing secret. Prefer SESSION_SECRET from the environment; when
 * absent, generate one once and keep it next to the database — zero-ops for a
 * single-server deployment (docs/2 §13), and sessions survive restarts.
 */
export function loadOrCreateSessionSecret(
  fromEnv: string | undefined,
  secretFilePath: string,
): string {
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (existsSync(secretFilePath)) {
    const stored = readFileSync(secretFilePath, "utf8").trim();
    if (stored.length >= 32) return stored;
  }
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  mkdirSync(dirname(secretFilePath), { recursive: true });
  writeFileSync(secretFilePath, `${secret}\n`, { mode: 0o600 });
  return secret;
}
