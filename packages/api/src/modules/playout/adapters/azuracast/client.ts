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
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
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
  private openedAt: number | null = null;
  private lastSuccessAt: Date | null = null;
  private lastFailureAt: Date | null = null;

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
          this.recordSuccess();
          return ok((await response.json()) as T);
        }
        // A 4xx means AzuraCast is alive and answered: no retry, breaker resets.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          this.recordSuccess();
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

  health(): AdapterHealth {
    return {
      circuit: this.circuitOpen() ? "open" : "closed",
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessAt: this.lastSuccessAt ? this.lastSuccessAt.toISOString() : null,
      lastFailureAt: this.lastFailureAt ? this.lastFailureAt.toISOString() : null,
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
    this.openedAt = null;
    this.lastSuccessAt = new Date();
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
