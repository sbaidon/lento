import { createHash, timingSafeEqual } from "node:crypto";

/* ---- Rate limiting ------------------------------------------------------ */

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitConfig {
  /** `POST /users`. Kept tight: every signup is a new identity. */
  signup: RateLimitRule;
  /** Every other non-GET request. */
  write: RateLimitRule;
  /** GET and HEAD requests. */
  read: RateLimitRule;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  signup: { limit: 5, windowMs: 60 * 60 * 1000 },
  write: { limit: 30, windowMs: 60 * 1000 },
  read: { limit: 300, windowMs: 60 * 1000 }
};

export type RateLimitBucket = keyof RateLimitConfig;

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the window resets. Only meaningful when not allowed. */
  retryAfterSeconds: number;
}

const MAX_TRACKED_KEYS = 50_000;

/**
 * Fixed-window counters held in memory. Good for a single instance, which is
 * what a SQLite-backed Lento server is. Counters reset on restart.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly config: RateLimitConfig = DEFAULT_RATE_LIMITS) {}

  check(bucket: RateLimitBucket, clientKey: string, now = Date.now()): RateLimitDecision {
    const rule = this.config[bucket];
    const key = `${bucket}:${clientKey}`;
    const current = this.windows.get(key);

    if (!current || current.resetAt <= now) {
      if (this.windows.size >= MAX_TRACKED_KEYS) {
        this.prune(now);
      }
      this.windows.set(key, { count: 1, resetAt: now + rule.windowMs });
      return { allowed: rule.limit >= 1, retryAfterSeconds: 0 };
    }

    if (current.count >= rule.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
      };
    }

    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }

    // Still full of live windows: drop the oldest entries rather than grow without bound.
    if (this.windows.size >= MAX_TRACKED_KEYS) {
      const excess = this.windows.size - MAX_TRACKED_KEYS + 1;
      let removed = 0;
      for (const key of this.windows.keys()) {
        this.windows.delete(key);
        removed += 1;
        if (removed >= excess) {
          break;
        }
      }
    }
  }
}

export function classifyRequest(method: string, pathname: string): RateLimitBucket {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return "read";
  }

  return method === "POST" && pathname === "/users" ? "signup" : "write";
}

/**
 * Resolves the client address. Behind a proxy the socket address is the
 * proxy's, so the operator names the header the proxy sets (for example
 * `fly-client-ip`). Only set that header name when a trusted proxy is in
 * front: a direct client could otherwise spoof it.
 */
export function resolveClientIp(
  request: Request,
  socketAddress: string | undefined,
  trustedHeader?: string
): string {
  if (trustedHeader) {
    const forwarded = request.headers.get(trustedHeader)?.split(",")[0]?.trim();
    if (forwarded) {
      return forwarded;
    }
  }

  return socketAddress ?? "unknown";
}

/* ---- Response headers --------------------------------------------------- */

function hashInlineBlocks(html: string, tag: "script" | "style"): string[] {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const hashes: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const digest = createHash("sha256")
      .update(match[1] ?? "")
      .digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

/**
 * Builds a Content-Security-Policy for a self-contained page: only the inline
 * script and style blocks that ship in the page may run, and the page may
 * only talk to its own origin.
 */
export function buildPageCsp(html: string): string {
  const scripts = hashInlineBlocks(html, "script");
  const styles = hashInlineBlocks(html, "style");
  return [
    "default-src 'none'",
    `script-src ${scripts.length ? scripts.join(" ") : "'none'"}`,
    `style-src ${styles.length ? styles.join(" ") : "'none'"}`,
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}

export function applySecurityHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  if (request.headers.get("x-forwarded-proto") === "https") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/* ---- Admin access ------------------------------------------------------- */

/** Checks HTTP Basic credentials where the password is the admin token. Any username works. */
export function isAdminAuthorized(request: Request, adminToken: string): boolean {
  const header = request.headers.get("authorization");
  const match = header ? /^Basic\s+(\S+)$/i.exec(header.trim()) : null;
  if (!match?.[1]) {
    return false;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) {
    return false;
  }

  // Compare digests so the comparison is constant-time for any input length.
  const provided = createHash("sha256")
    .update(decoded.slice(separator + 1))
    .digest();
  const expected = createHash("sha256").update(adminToken).digest();
  return timingSafeEqual(provided, expected);
}

/* ---- Request logging ---------------------------------------------------- */

export interface RequestLogEntry {
  level: "info";
  msg: "request";
  time: string;
  method: string;
  /** Path only. Query strings and headers are never logged. */
  path: string;
  status: number;
  durationMs: number;
  ip: string;
}

export type RequestLogger = (entry: RequestLogEntry) => void;

export const jsonRequestLogger: RequestLogger = (entry) => {
  console.log(JSON.stringify(entry));
};
