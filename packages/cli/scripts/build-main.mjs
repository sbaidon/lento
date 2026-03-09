import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const distDir = resolve(import.meta.dir, "../dist");
const outputPath = resolve(distDir, "main.js");

mkdirSync(distDir, { recursive: true });

const wrapper = `#!/usr/bin/env bun
import { runCli } from "./index.js";

await runCli(Bun.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
`;

writeFileSync(outputPath, wrapper, "utf8");
chmodSync(outputPath, 0o755);
