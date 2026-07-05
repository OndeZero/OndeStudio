import type { LogFields, Logger } from "../kernel/logger";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export type LogLevel = keyof typeof LEVELS;

/**
 * JSON-lines structured logger (docs/2 §13): one line per event, greppable
 * fields over prose. `sink` is injectable so tests can capture output.
 */
export function createLogger(
  level: LogLevel,
  sink: (line: string) => void = console.log,
  base: LogFields = {},
): Logger {
  const threshold = LEVELS[level];
  const write = (lvl: LogLevel, msg: string, fields?: LogFields): void => {
    if (LEVELS[lvl] < threshold) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...base, ...fields }));
  };
  return {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
    child: (fields) => createLogger(level, sink, { ...base, ...fields }),
  };
}

/** For tests and tools that must stay silent. */
export const silentLogger: Logger = createLogger("error", () => {});
