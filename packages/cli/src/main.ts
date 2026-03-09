#!/usr/bin/env bun

import { runCli } from "./index";

await runCli(Bun.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
