import { z } from "zod";
import { type Result, unwrap } from "../kernel/result";
import { StationId } from "../kernel/station-id";

/**
 * Everything OndeStudio needs from the environment, validated at boot — fail
 * fast with a readable message instead of failing weirdly later (docs/2 §13).
 * Secrets live in the repo-local `.env` (gitignored); `.env.example` documents them.
 */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4400),
  HOST: z.string().default("127.0.0.1"),
  DB_PATH: z.string().default("data/ondestudio.sqlite"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  AZURACAST_BASE_URL: z.url(),
  AZURACAST_API_KEY: z.string().min(1),
  AZURACAST_STATION_MAIN: z.string().default("oz"),
  AZURACAST_STATION_TEST: z.string().default("wz-test"),
  NOW_POLL_SECONDS: z.coerce.number().int().min(2).max(300).default(10),
  /** Station reference timezone (PD §8.1: server-referenced, Europe/Paris). */
  STATION_TZ: z
    .string()
    .default("Europe/Paris")
    .refine(isValidTimeZone, { message: "not a valid IANA timezone" }),
  /** Cookie-signing secret; when absent one is generated into data/session-secret. */
  SESSION_SECRET: z.string().min(32).optional(),
  /**
   * Stations OndeStudio may WRITE to (docs/2 §7.7). Production (`oz`) joins
   * only after the per-feature adoption step AND the dedicated API account.
   */
  AZURACAST_WRITE_STATIONS: z.string().default("wz-test"),
  /**
   * The AzuraCast WebDJ / liquidsoap harbor WebSocket for browser broadcasting
   * (PD §5.6) — e.g. `wss://host/radio/<dj_port>/<mount>`. Optional: unset
   * disables the self-service "broadcast from here" console.
   */
  AZURACAST_WEBDJ_URL: z.string().url().optional(),
});

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export interface AppConfig {
  port: number;
  host: string;
  dbPath: string;
  logLevel: "debug" | "info" | "warn" | "error";
  azuracast: { baseUrl: string; apiKey: string };
  /** All stations the overlay watches — today the production mirror pair (PD §2.2). */
  stations: StationId[];
  mainStation: StationId;
  testStation: StationId;
  nowPollSeconds: number;
  stationTz: string;
  sessionSecret: string | undefined;
  /** Fan-out write targets (docs/2 §7.7) — subset of `stations`. */
  writeStations: StationId[];
  /** WebDJ harbor WebSocket for the self-service broadcast console (PD §5.6); null = disabled. */
  webDjUrl: string | null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => ` - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  }
  const e = parsed.data;

  const parseStation = (raw: string): StationId => unwrapBoot(StationId.parse(raw), raw);
  const mainStation = parseStation(e.AZURACAST_STATION_MAIN);
  const testStation = parseStation(e.AZURACAST_STATION_TEST);

  return {
    port: e.PORT,
    host: e.HOST,
    dbPath: e.DB_PATH,
    logLevel: e.LOG_LEVEL,
    azuracast: { baseUrl: e.AZURACAST_BASE_URL.replace(/\/$/, ""), apiKey: e.AZURACAST_API_KEY },
    stations: [mainStation, testStation],
    mainStation,
    testStation,
    nowPollSeconds: e.NOW_POLL_SECONDS,
    stationTz: e.STATION_TZ,
    sessionSecret: e.SESSION_SECRET,
    writeStations: e.AZURACAST_WRITE_STATIONS.split(",")
      .map((raw) => raw.trim())
      .filter((raw) => raw.length > 0)
      .map(parseStation),
    webDjUrl: e.AZURACAST_WEBDJ_URL ?? null,
  };
}

function unwrapBoot(result: Result<StationId, { message: string }>, raw: string): StationId {
  if (!result.ok) throw new Error(`Invalid station shortcode in environment: "${raw}"`);
  return unwrap(result);
}
