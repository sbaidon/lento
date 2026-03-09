import { runAgentCli } from "./cli";

runAgentCli(Bun.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
