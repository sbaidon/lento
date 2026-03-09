import { describe, expect, test } from "bun:test";
import { parseCliArgs, tokenizeCommandLine } from "./command-parser";

describe("parseCliArgs", () => {
  test("parses command, args, and flags", () => {
    const parsed = parseCliArgs([
      "feed",
      "usr_1",
      "10",
      "--url",
      "http://localhost:3000",
      "--verbose",
      "--limit=20"
    ]);

    expect(parsed.command).toBe("feed");
    expect(parsed.args).toEqual(["usr_1", "10"]);
    expect(parsed.flags).toEqual({
      url: "http://localhost:3000",
      verbose: true,
      limit: "20"
    });
  });
});

describe("tokenizeCommandLine", () => {
  test("keeps quoted strings together", () => {
    const tokens = tokenizeCommandLine(`post usr_1 "hello from lento"`);
    expect(tokens).toEqual(["post", "usr_1", "hello from lento"]);
  });

  test("handles escaped characters", () => {
    const tokens = tokenizeCommandLine(String.raw`post usr_1 hello\ world`);
    expect(tokens).toEqual(["post", "usr_1", "hello world"]);
  });

  test("throws on unterminated quotes", () => {
    expect(() => tokenizeCommandLine(`post "oops`)).toThrow("Unterminated quote");
  });
});
