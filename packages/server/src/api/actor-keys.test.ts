import { describe, expect, test } from "bun:test";
import { issueActorKey, readBearerToken, verifyActorKey } from "./actor-keys";

describe("actor keys", () => {
  test("round-trips the actor id and rejects anything tampered", () => {
    const key = issueActorKey("secret-a", "usr_123");
    expect(key.startsWith("lento_usr_123.")).toBe(true);
    expect(verifyActorKey("secret-a", key)).toBe("usr_123");

    expect(verifyActorKey("secret-b", key)).toBeUndefined();
    expect(verifyActorKey("secret-a", key.replace("usr_123", "usr_124"))).toBeUndefined();
    expect(verifyActorKey("secret-a", `${key}x`)).toBeUndefined();
    expect(verifyActorKey("secret-a", "lento_usr_123")).toBeUndefined();
    expect(verifyActorKey("secret-a", "lento_.abc")).toBeUndefined();
    expect(verifyActorKey("secret-a", "mbid_whatever")).toBeUndefined();
  });

  test("reads bearer tokens from the authorization header", () => {
    const request = (value?: string) =>
      new Request("http://localhost/", { headers: value ? { authorization: value } : {} });

    expect(readBearerToken(request("Bearer abc.def"))).toBe("abc.def");
    expect(readBearerToken(request("bearer   abc"))).toBe("abc");
    expect(readBearerToken(request("Basic abc"))).toBeUndefined();
    expect(readBearerToken(request())).toBeUndefined();
  });
});
