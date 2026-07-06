import { DomainError } from "../../../../kernel/domain-error";
import type { Logger } from "../../../../kernel/logger";
import { err, ok, type Result } from "../../../../kernel/result";

export interface AzuracastClientOptions {
  baseUrl: string;
  apiKey: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Extra attempts after the first failure (network/5xx only). */
  maxRetries?: number;
  /** Consecutive failures before the circuit opens. */
  breakerThreshold?: number;
  breakerCooldownMs?: number;
}

/** Surfaced on /health so a degraded AzuraCast link is visible, never silent (docs/2 §13). */
export interface AdapterHealth {
  circuit: "closed" | "open";
  consecutiveFailures: number;
  /** Alive-but-rejecting (4xx) tracking — a revoked API key shows up here, loudly. */
  consecutiveRejections: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastRejectedAt: string | null;
  lastRejectedStatus: number | null;
}

/**
 * Minimal typed AzuraCast HTTP client with bounded retry/backoff and a
 * circuit breaker (docs/2 §7.2): a flaky AzuraCast degrades the overlay fast
 * and visibly instead of piling up hanging requests. Air is never at stake —
 * the overlay only reads/writes the management API, never the stream.
 */
export class AzuracastClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;

  private consecutiveFailures = 0;
  private consecutiveRejections = 0;
  private openedAt: number | null = null;
  private lastSuccessAt: Date | null = null;
  private lastFailureAt: Date | null = null;
  private lastRejectedAt: Date | null = null;
  private lastRejectedStatus: number | null = null;

  constructor(private readonly options: AzuracastClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.breakerThreshold = options.breakerThreshold ?? 5;
    this.breakerCooldownMs = options.breakerCooldownMs ?? 30_000;
  }

  async getJson<T>(path: string): Promise<Result<T, DomainError>> {
    if (this.circuitOpen()) {
      return err(DomainError.upstreamUnavailable("azuracast circuit open — cooling down"));
    }

    let lastFailure = "unknown failure";
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await sleep(300 * 2 ** (attempt - 1));
      try {
        const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
          headers: { "X-API-Key": this.options.apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.ok) {
          // Parse INSIDE the try: a 200 with a non-JSON body (misconfigured
          // proxy, captive portal) is a failed attempt that must count toward
          // the breaker — recording success before parsing would keep the
          // circuit closed forever in that failure mode.
          const body = (await response.json()) as T;
          this.recordSuccess();
          return ok(body);
        }
        // A non-429 4xx means AzuraCast is alive but rejected us (revoked key,
        // unknown path): no retry, circuit stays closed — but it is NOT a
        // success. Rejections are logged and tracked so /health never shows a
        // healthy adapter over a permanently rejected key.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          this.recordRejection(response.status);
          this.options.logger.warn("azuracast rejected request", {
            path,
            status: response.status,
          });
          if (response.status === 404) return err(DomainError.notFound(`azuracast ${path}`));
          return err(
            DomainError.upstreamUnavailable(`azuracast rejected ${path} (${response.status})`),
          );
        }
        lastFailure = `http ${response.status}`;
      } catch (error) {
        lastFailure = String(error);
      }
      this.options.logger.warn("azuracast request failed", { path, attempt, reason: lastFailure });
    }

    this.recordFailure();
    return err(DomainError.upstreamUnavailable(`azuracast unreachable: ${lastFailure}`));
  }

  /**
   * Write request — SINGLE attempt, no retry: a timed-out POST may have
   * landed, and blind retries would duplicate objects (docs/2 §6.1 wants
   * idempotency by OS id, not by hammering). Breaker bookkeeping is shared
   * with reads.
   */
  async sendJson<T>(
    method: "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<Result<T, DomainError>> {
    if (this.circuitOpen()) {
      return err(DomainError.upstreamUnavailable("azuracast circuit open — cooling down"));
    }
    try {
      const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method,
        headers: {
          "X-API-Key": this.options.apiKey,
          Accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.ok) {
        const text = await response.text();
        this.recordSuccess();
        return ok((text ? JSON.parse(text) : null) as T);
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        this.recordRejection(response.status);
        this.options.logger.warn("azuracast rejected write", {
          method,
          path,
          status: response.status,
        });
        if (response.status === 404) return err(DomainError.notFound(`azuracast ${path}`));
        return err(
          DomainError.upstreamUnavailable(
            `azuracast rejected ${method} ${path} (${response.status})`,
          ),
        );
      }
      this.recordFailure();
      return err(
        DomainError.upstreamUnavailable(`azuracast write failed: http ${response.status}`),
      );
    } catch (error) {
      this.recordFailure();
      return err(DomainError.upstreamUnavailable(`azuracast unreachable: ${String(error)}`));
    }
  }

  health(): AdapterHealth {
    return {
      circuit: this.circuitOpen() ? "open" : "closed",
      consecutiveFailures: this.consecutiveFailures,
      consecutiveRejections: this.consecutiveRejections,
      lastSuccessAt: this.lastSuccessAt ? this.lastSuccessAt.toISOString() : null,
      lastFailureAt: this.lastFailureAt ? this.lastFailureAt.toISOString() : null,
      lastRejectedAt: this.lastRejectedAt ? this.lastRejectedAt.toISOString() : null,
      lastRejectedStatus: this.lastRejectedStatus,
    };
  }

  private circuitOpen(): boolean {
    if (this.openedAt === null) return false;
    if (Date.now() - this.openedAt >= this.breakerCooldownMs) {
      // Half-open: allow the next request through; success closes, failure re-opens.
      this.openedAt = null;
      return false;
    }
    return true;
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.consecutiveRejections = 0;
    this.openedAt = null;
    this.lastSuccessAt = new Date();
  }

  /** Upstream alive (so the circuit resets) but the request was refused — not a success. */
  private recordRejection(status: number): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.consecutiveRejections += 1;
    this.lastRejectedAt = new Date();
    this.lastRejectedStatus = status;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    this.lastFailureAt = new Date();
    if (this.consecutiveFailures >= this.breakerThreshold) {
      this.openedAt = Date.now();
      this.options.logger.error("azuracast circuit opened", {
        consecutiveFailures: this.consecutiveFailures,
      });
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
