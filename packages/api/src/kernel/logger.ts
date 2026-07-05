/**
 * Structured logging contract. The JSON-lines implementation lives in
 * platform — kernel stays IO-free so domain and services can log through an
 * injected interface without touching infrastructure.
 */
export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A copy that stamps `fields` on every line — e.g. `logger.child({ component: "playout" })`. */
  child(fields: LogFields): Logger;
}

export type LogFields = Record<string, unknown>;
