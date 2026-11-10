import { describe, expect, test } from "bun:test";
import {
  buildPageCsp,
  classifyRequest,
  isAdminAuthorized,
  RateLimiter,
  resolveClientIp
} from "./hardening";

describe("RateLimiter", () => {
  test("allows up to the limit, then blocks until the window resets", () => {
    const limiter = new RateLimiter({
      signup: { limit: 1, windowMs: 1000 },
      write: { limit: 2, windowMs: 1000 },
      read: { limit: 3, windowMs: 1000 }
    });

    expect(limiter.check("write", "1.1.1.1", 0).allowed).toBe(true);
    expect(limiter.check("write", "1.1.1.1", 10).allowed).toBe(true);
    const blocked = limiter.check("write", "1.1.1.1", 20);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);

    // Other clients and other buckets are counted separately.
    expect(limiter.check("write", "2.2.2.2", 20).allowed).toBe(true);
    expect(limiter.check("read", "1.1.1.1", 20).allowed).toBe(true);

    expect(limiter.check("write", "1.1.1.1", 1001).allowed).toBe(true);
  });

  test("classifies requests into buckets", () => {
    expect(classifyRequest("GET", "/feed/usr_1")).toBe("read");
    expect(classifyRequest("POST", "/users")).toBe("signup");
    expect(classifyRequest("POST", "/content")).toBe("write");
    expect(classifyRequest("POST", "/users/extra")).toBe("write");
  });
});

describe("resolveClientIp", () => {
  const request = new Request("http://localhost/", {
    headers: { "fly-client-ip": "203.0.113.9, 10.0.0.1" }
  });

  test("ignores forwarding headers unless one is trusted", () => {
    expect(resolveClientIp(request, "10.0.0.5")).toBe("10.0.0.5");
    expect(resolveClientIp(request, "10.0.0.5", "fly-client-ip")).toBe("203.0.113.9");
    expect(resolveClientIp(request, "10.0.0.5", "x-real-ip")).toBe("10.0.0.5");
    expect(resolveClientIp(request, undefined)).toBe("unknown");
  });
});

describe("buildPageCsp", () => {
  test("allows only the inline blocks that ship with the page", () => {
    const csp = buildPageCsp("<style>a{}</style><script>let a = 1;</script>");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).toMatch(/style-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("unsafe-inline");
    expect(buildPageCsp("<p>plain</p>")).toContain("script-src 'none'");
  });
});

describe("isAdminAuthorized", () => {
  const withAuth = (value?: string) =>
    new Request("http://localhost/admin", { headers: value ? { authorization: value } : {} });
  const basic = (user: string, password: string) =>
    `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

  test("accepts the admin token as the basic auth password only", () => {
    expect(isAdminAuthorized(withAuth(basic("admin", "s3cret")), "s3cret")).toBe(true);
    expect(isAdminAuthorized(withAuth(basic("anyone", "s3cret")), "s3cret")).toBe(true);
    expect(isAdminAuthorized(withAuth(basic("admin", "wrong")), "s3cret")).toBe(false);
    expect(isAdminAuthorized(withAuth(basic("s3cret", "")), "s3cret")).toBe(false);
    expect(isAdminAuthorized(withAuth("Bearer s3cret"), "s3cret")).toBe(false);
    expect(isAdminAuthorized(withAuth(), "s3cret")).toBe(false);
  });
});
