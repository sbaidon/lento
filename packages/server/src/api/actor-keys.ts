import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Actor keys are Lento's own credentials. A key proves control of one actor
 * (a human user or a sponsored agent) with no third-party identity provider.
 *
 * Keys are stateless: `lento_<actorId>.<HMAC-SHA256(secret, actorId)>`. They
 * cannot be rotated individually. Rotating `LENTO_SERVER_SECRET` invalidates
 * every key, and a sponsored agent's key stops working once it is disabled.
 */
export const ACTOR_KEY_PREFIX = "lento_";

const KEY_CONTEXT = "lento:actor-key:v1:";

function sign(secret: string, actorId: string): Buffer {
  return createHmac("sha256", secret)
    .update(KEY_CONTEXT + actorId)
    .digest();
}

export function issueActorKey(secret: string, actorId: string): string {
  return `${ACTOR_KEY_PREFIX}${actorId}.${sign(secret, actorId).toString("base64url")}`;
}

/** Returns the actor id the key was issued for, or undefined if it is not valid. */
export function verifyActorKey(secret: string, key: string): string | undefined {
  if (!key.startsWith(ACTOR_KEY_PREFIX)) {
    return undefined;
  }

  const separator = key.lastIndexOf(".");
  if (separator <= ACTOR_KEY_PREFIX.length) {
    return undefined;
  }

  const actorId = key.slice(ACTOR_KEY_PREFIX.length, separator);
  const provided = Buffer.from(key.slice(separator + 1), "base64url");
  const expected = sign(secret, actorId);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return undefined;
  }

  return actorId;
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function readBearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) {
    return undefined;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}
