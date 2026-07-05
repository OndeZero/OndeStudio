import { Hono } from "hono";
import { EventBus } from "./kernel/event-bus";
import {
  AzuracastClient,
  AzuracastPlayoutStateAdapter,
  createPlayoutRoutes,
  DrizzleNowCacheRepo,
  onAirToContract,
  PlayoutService,
} from "./modules/playout";
import { type AppConfig, loadConfig } from "./platform/config";
import { createDb } from "./platform/db";
import { createApiApp } from "./platform/http";
import { createLogger } from "./platform/logger";
import { registerOpenApi } from "./platform/openapi";
import { createSseHub, createSseRoutes } from "./platform/sse";

/**
 * Composition root (docs/2 §3.3): the ONLY place modules, adapters, platform
 * and the event bus are wired together. Everything else depends on interfaces.
 */
export function buildServer(config: AppConfig = loadConfig()) {
  const logger = createLogger(config.logLevel);
  const db = createDb(config.dbPath, logger);
  const bus = new EventBus((event, error) =>
    logger.error("event handler failed", { event, error: String(error) }),
  );
  const sseHub = createSseHub(logger);

  // playout: AzuraCast-backed adapters behind the ports (phase 1)
  const azuracast = new AzuracastClient({
    ...config.azuracast,
    logger: logger.child({ component: "azuracast" }),
  });
  const playoutService = new PlayoutService({
    playoutState: new AzuracastPlayoutStateAdapter(azuracast),
    nowCache: new DrizzleNowCacheRepo(db),
    bus,
    logger: logger.child({ component: "playout" }),
  });

  // cross-cutting reactions live on the bus (docs/2 §3.4)
  bus.on("playout.on-air-changed", ({ station, status }) => {
    sseHub.publish(station, "onair", "onair", onAirToContract(status));
  });

  const api = createApiApp(logger);
  api.route("/", createPlayoutRoutes(playoutService));
  api.route("/", createSseRoutes(sseHub, logger));
  api.get("/health", (c) => c.json({ status: "ok", adapters: { azuracast: azuracast.health() } }));
  registerOpenApi(api);

  const app = new Hono();
  app.route("/api/v1", api);

  // Ingest: poll each station's now-playing (AzuraCast SSE upgrade: ADR-0011).
  const startIngest = (): (() => void) => {
    const timers = config.stations.map((station) => {
      void playoutService.refreshNow(station);
      return setInterval(
        () => void playoutService.refreshNow(station),
        config.nowPollSeconds * 1000,
      );
    });
    return () => {
      for (const timer of timers) clearInterval(timer);
    };
  };

  return { app, config, logger, startIngest };
}

if (import.meta.main) {
  const { app, config, logger, startIngest } = buildServer();
  startIngest();
  Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch: app.fetch,
    // SSE streams are kept alive by the 15s heartbeat; don't let idle cut them sooner.
    idleTimeout: 60,
  });
  logger.info("ondestudio api listening", { host: config.host, port: config.port });
}
