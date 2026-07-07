import { Hono } from "hono";
import { getSignedCookie } from "hono/cookie";
import { systemClock } from "./kernel/clock";
import { EventBus } from "./kernel/event-bus";
import { ok } from "./kernel/result";
import { StationId } from "./kernel/station-id";
import {
  type AnchorResolverPort,
  CollaborationService,
  createCollaborationRoutes,
  type PromotionPort,
  type UserDirectoryPort,
} from "./modules/collaboration";
import { DrizzleCollaborationRepo } from "./modules/collaboration/wiring";
import { ContentService, createContentRoutes } from "./modules/content";
import {
  BroadcasterService,
  createBroadcasterRoutes,
  createPeopleRoutes,
  PeopleService,
} from "./modules/people";
import { DrizzleBroadcasterRepo, DrizzlePeopleRepo } from "./modules/people/wiring";
import { createPlayoutRoutes, onAirToContract, PlayoutService } from "./modules/playout";
import {
  AzuracastClient,
  AzuracastDirectoryAdapter,
  AzuracastFilesAdapter,
  AzuracastMirrorScheduleAdapter,
  AzuracastPlaylistAdapter,
  AzuracastPlayoutStateAdapter,
  AzuracastStreamerAdapter,
  createDriverRoutes,
  DrizzleNowCacheRepo,
  DrizzleProjectionRepo,
  PlayoutDriver,
  type ProjectableSlot,
  type SlotSinkPort,
  type SlotSourcePort,
} from "./modules/playout/wiring";
import {
  createEpisodeRoutes,
  createSchedulingRoutes,
  createShowRoutes,
  decodeOccurrenceId,
  EpisodeQueueService,
  type MediaScanPort,
  SchedulingService,
  ShowService,
} from "./modules/scheduling";
import { DrizzleSchedulingRepo } from "./modules/scheduling/wiring";
import { createAuthMiddleware, SESSION_COOKIE } from "./platform/auth";
import { type AppConfig, loadConfig } from "./platform/config";
import { createDb, resolveDataPath } from "./platform/db";
import { createApiApp } from "./platform/http";
import { createLogger } from "./platform/logger";
import { registerOpenApi } from "./platform/openapi";
import { loadOrCreateSessionSecret } from "./platform/secret";
import { createSseHub, createSseRoutes } from "./platform/sse";

/**
 * The public read seam (docs/2 §6.4-6.5): everything else needs a session.
 * `now` feeds the galaxy satellites; SSE only ever pushes refetch hints and
 * on-air state, both public by design.
 */
const PUBLIC_PATHS = [
  /^\/api\/v1\/health$/,
  /^\/api\/v1\/openapi\.json$/,
  /^\/api\/v1\/auth\/(login|setup)$/,
  /^\/api\/v1\/stations\/[^/]+\/now$/,
  /^\/api\/v1\/stations\/[^/]+\/sse$/,
];

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

  // scheduling: the grid engine over the OndeStudio DB; the mirror reads
  // AzuraCast's own schedule read-only (Increment 1, docs/2 §2.5)
  const schedulingRepo = new DrizzleSchedulingRepo(db);
  const schedulingService = new SchedulingService({
    repo: schedulingRepo,
    mirror: new AzuracastMirrorScheduleAdapter(azuracast, config.stationTz),
    bus,
    clock: systemClock,
    logger: logger.child({ component: "scheduling" }),
    zone: config.stationTz,
  });
  const showService = new ShowService({
    repo: schedulingRepo,
    grid: schedulingService,
    bus,
    clock: systemClock,
    zone: config.stationTz,
  });

  // content: media browse through the playout files adapter; ownership badges
  // come from the shows' drop folders (PD §5.4)
  const filesAdapter = new AzuracastFilesAdapter(azuracast);
  const contentService = new ContentService({
    media: filesAdapter,
    ownership: { ownedFolders: (station) => showService.dropFolders(station) },
  });

  // episode queue (PD §4.5, ADR-0013): a show's drop folder feeds occurrences.
  // MediaScanPort reads the folder's files through the same files adapter,
  // carrying the az file id (which the browse contract drops) so episodes have
  // an identity and the driver can assign real media.
  const mediaScan: MediaScanPort = {
    listFolderFiles: async (station, folderPath) => {
      const files = await filesAdapter.listFiles(station);
      if (!files.ok) return files;
      const prefix = `${folderPath.replace(/\/+$/, "")}/`;
      return ok(
        files.value
          .filter((f) => f.path.startsWith(prefix))
          .map((f) => ({
            azFileId: f.azFileId,
            path: f.path,
            title: f.title ?? f.path.split("/").pop() ?? f.path,
            artist: f.artist,
            durationSec: f.durationSec,
          })),
      );
    },
  };
  const episodeQueueService = new EpisodeQueueService({
    repo: schedulingRepo,
    grid: schedulingService,
    media: mediaScan,
    bus,
    clock: systemClock,
    zone: config.stationTz,
  });

  // driver (M3, RFC 0001): project validated weekly show/series/echo slots to
  // AzuraCast as tagged playlists. Writes reach ONLY config.writeStations
  // (docs/2 §7.7); the ports bridge scheduling's model to the write adapter.
  const PROJECTED_KINDS = new Set(["show", "series", "echo"]);
  const slotSource: SlotSourcePort = {
    listProjectable: async (station) => {
      const records = await schedulingService.listSlots(station);
      // Deterministic episode selection (PD §4.11): the media of each slot's
      // nearest upcoming occurrence, so a projected playlist airs the right file
      // and swaps as occurrences advance (ADR-0013).
      const episodeMedia = await episodeQueueService.currentEpisodeMediaBySlot(station);
      const projectable: ProjectableSlot[] = [];
      for (const { slot, showName } of records) {
        if (slot.negotiationDefault !== "validated" || !PROJECTED_KINDS.has(slot.kind)) continue;
        const item = slot.rule.weeklyScheduleItems(slot.durationMin);
        if (!item) continue; // one-off / non-weekly stays OS-truth on the grid (RFC 0001)
        const title = slot.displayTitle(showName);
        const media = episodeMedia.get(slot.id);
        projectable.push({
          slotId: slot.id,
          title,
          name: `[OndeStudio] ${title}`,
          scheduleItems: [item],
          mediaIds: media ? [media] : [],
        });
      }
      return ok(projectable);
    },
  };
  const slotSink: SlotSinkPort = {
    applyScheduleFromAzuracast: async (station, slotId, sched) => {
      const result = await schedulingService.updateSlot(station, slotId, {
        recurrence: { type: "weekly", weekdays: sched.weekdays, time: sched.time },
        durationMin: sched.durationMin,
      });
      return result.ok ? ok(undefined) : result;
    },
    retractSlot: (station, slotId) => schedulingService.retractSlot(station, slotId),
  };
  const driver = new PlayoutDriver({
    write: new AzuracastPlaylistAdapter(azuracast, config.writeStations),
    projections: new DrizzleProjectionRepo(db),
    slots: slotSource,
    sink: slotSink,
    writeStations: config.writeStations,
    adapterHealthy: () => azuracast.health().circuit === "closed",
    clock: systemClock,
    logger: logger.child({ component: "driver" }),
  });

  // collaboration: the board over polymorphic anchors — its ports are small
  // composition-root adapters over scheduling and people (docs/2 §3.4)
  const anchors: AnchorResolverPort = {
    resolveLabel: async (anchor) => {
      if (anchor.type === "show") {
        const show = await schedulingRepo.getShow(Number(anchor.id));
        return show?.name ?? null;
      }
      if (anchor.type === "slot") {
        const record = await schedulingRepo.getSlot(Number(anchor.id));
        return record ? record.slot.displayTitle(record.showName) : null;
      }
      if (anchor.type === "occurrence") {
        const key = decodeOccurrenceId(anchor.id);
        if (!key.ok) return null;
        const record = await schedulingRepo.getSlot(key.value.slotId);
        return record ? record.slot.displayTitle(record.showName) : null;
      }
      return anchor.id; // media: the path IS the label
    },
  };
  const promotion: PromotionPort = {
    createShow: async (name) => ok(await schedulingRepo.findOrCreateShow(name)),
    // Station-scoped (ports.ts): a slot on another station answers "no", so
    // cards cannot promote/anchor across the station boundary.
    slotExists: async (slotId, station) =>
      (await schedulingRepo.getSlot(slotId))?.slot.stationId === station,
  };
  const userDirectory: UserDirectoryPort = {
    getUsers: async (ids) => {
      const wanted = new Set(ids);
      const all = await peopleService.listUsers();
      return new Map(
        all
          .filter((user) => wanted.has(user.id))
          .map((user) => [user.id, { id: user.id, displayName: user.displayName }]),
      );
    },
    allUserIds: async () => (await peopleService.listUsers()).map((user) => user.id),
  };
  const collaborationService = new CollaborationService({
    repo: new DrizzleCollaborationRepo(db),
    anchors,
    promotion,
    users: userDirectory,
    bus,
    clock: systemClock,
    logger: logger.child({ component: "collaboration" }),
  });

  // cross-cutting reactions live on the bus (docs/2 §3.4)
  bus.on("playout.on-air-changed", ({ station, status }) => {
    sseHub.publish(station, "onair", "onair", onAirToContract(status));
  });
  bus.on("scheduling.grid-changed", (event) => {
    sseHub.publish(event.station, "grid", "grid", event);
    // Apply-with-undo (§7.5): debounce the AzuraCast push so an undo cancels it.
    driver.scheduleRun(event.station);
  });
  bus.on("collaboration.card-changed", (event) => {
    sseHub.publish(event.station, "board", "board", event);
  });

  // people: identity + sessions (docs/2 §12), seeded from the AzuraCast directory
  const peopleService = new PeopleService({
    repo: new DrizzlePeopleRepo(db),
    directory: new AzuracastDirectoryAdapter(azuracast),
    clock: systemClock,
    logger: logger.child({ component: "people" }),
  });
  // M4 fan-out: writes reach ONLY config.writeStations (docs/2 §7.7) — the
  // adapter enforces it a second time (defense in depth around `oz`).
  const broadcasterService = new BroadcasterService({
    repo: new DrizzleBroadcasterRepo(db),
    streamers: new AzuracastStreamerAdapter(azuracast, config.writeStations),
    mainStation: config.mainStation,
    testStation: config.testStation,
    writeStations: config.writeStations,
    logger: logger.child({ component: "broadcasters" }),
  });
  const cookieSecret = loadOrCreateSessionSecret(
    config.sessionSecret,
    resolveDataPath("data/session-secret"),
  );

  const api = createApiApp(logger);
  // Auth gate first — everything registered below is team-only unless public.
  api.use(
    "*",
    createAuthMiddleware({
      cookieSecret,
      publicPaths: PUBLIC_PATHS,
      verify: async (sessionId) => {
        const user = await peopleService.verifySession(sessionId);
        if (!user) return null;
        return { id: user.id, displayName: user.displayName, email: user.email, role: user.role };
      },
    }),
  );
  api.route("/", createPeopleRoutes(peopleService, cookieSecret));
  api.route(
    "/",
    createBroadcasterRoutes(
      broadcasterService,
      config.writeStations.map((s) => s.value),
    ),
  );
  api.route("/", createPlayoutRoutes(playoutService));
  api.route("/", createSchedulingRoutes(schedulingService));
  api.route("/", createShowRoutes(showService));
  api.route("/", createEpisodeRoutes(episodeQueueService));
  api.route("/", createContentRoutes(contentService));
  api.route("/", createCollaborationRoutes(collaborationService));
  api.route("/", createDriverRoutes(driver, config.writeStations));
  api.route(
    "/",
    createSseRoutes(sseHub, logger, {
      snapshots: {
        // Fresh (re)connections get the current on-air state immediately; grid
        // subscribers refetch their window on connect, so no snapshot needed.
        onair: async (station) => {
          const parsed = StationId.parse(station);
          if (!parsed.ok) return null;
          const result = await playoutService.getNow(parsed.value);
          return result.ok ? onAirToContract(result.value) : null;
        },
      },
      // onair is the galaxy seam; grid/board activity hints are team-only.
      publicChannels: ["onair"],
      isAuthorized: async (c) => {
        const sessionId = await getSignedCookie(c, cookieSecret, SESSION_COOKIE);
        return Boolean(sessionId && (await peopleService.verifySession(sessionId)));
      },
    }),
  );
  api.get("/health", (c) => c.json({ status: "ok", adapters: { azuracast: azuracast.health() } }));
  registerOpenApi(api);

  const app = new Hono();
  app.route("/api/v1", api);

  // Ingest: poll each station's now-playing (AzuraCast SSE upgrade: ADR-0011).
  const startIngest = (): (() => void) => {
    // Best-effort account seed at boot (docs/2 §7.6) — upstream may be down.
    void peopleService
      .importAccounts()
      .then((result) => {
        if (!result.ok) logger.warn("account import failed", { reason: result.error.message });
      })
      .catch((error) => logger.error("account import crashed", { error: String(error) }));
    const timers = config.stations.map((station) => {
      void playoutService.refreshNow(station);
      return setInterval(
        () => void playoutService.refreshNow(station),
        config.nowPollSeconds * 1000,
      );
    });

    // Driver: catch up existing validated slots at boot, then sweep for drift
    // (≤30s freshness, §6). No-op when no station is writable (docs/2 §7.7).
    let driverTimer: ReturnType<typeof setInterval> | null = null;
    if (driver.isDriving) {
      void driver.runOnce();
      driverTimer = setInterval(() => void driver.runOnce(), 30_000);
    }

    return () => {
      for (const timer of timers) clearInterval(timer);
      if (driverTimer) clearInterval(driverTimer);
      driver.stop();
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
