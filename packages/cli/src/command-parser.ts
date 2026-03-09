export type CliFlags = Record<string, string | boolean>;

export interface ParsedCliArgs {
  command: string;
  args: string[];
  flags: CliFlags;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const [command = "help", ...rest] = argv;
  const flags: CliFlags = {};
  const args: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (token.startsWith("--")) {
      const withoutPrefix = token.slice(2);
      const equalsIndex = withoutPrefix.indexOf("=");

      if (equalsIndex >= 0) {
        const key = withoutPrefix.slice(0, equalsIndex);
        const value = withoutPrefix.slice(equalsIndex + 1);
        flags[key] = value.length === 0 ? true : value;
        continue;
      }

      const next = rest[index + 1];
      if (next && !next.startsWith("--")) {
        flags[withoutPrefix] = next;
        index += 1;
        continue;
      }

      flags[withoutPrefix] = true;
      continue;
    }

    args.push(token);
  }

  return { command, args, flags };
}

export function flagString(flags: CliFlags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

export function flagNumber(flags: CliFlags, key: string): number | undefined {
  const value = flagString(flags, key);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function tokenizeCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += "\\";
  }

  if (quote) {
    throw new Error("Unterminated quote in command input.");
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
