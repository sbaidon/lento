import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

const thresholds = {
  core: { lines: 70, functions: 65 },
  server: { lines: 75, functions: 80 },
  agents: { lines: 70, functions: 65 },
  cli: { lines: 60, functions: 65 }
};

const targets = [
  { key: "core", lcov: "coverage/core/lcov.info", sourcePrefix: "src/", exclude: [] },
  { key: "server", lcov: "coverage/server/lcov.info", sourcePrefix: "src/", exclude: [] },
  { key: "agents", lcov: "coverage/agents/lcov.info", sourcePrefix: "src/", exclude: [] },
  {
    key: "cli",
    lcov: "coverage/cli/lcov.info",
    sourcePrefix: "src/",
    // TUI is highly interactive and validated through integration smoke tests.
    exclude: ["src/tui.ts"]
  }
];

function parseCoverageForPrefix(lcovContent, sourcePrefix, exclude = []) {
  const records = lcovContent.split("end_of_record");
  let linesFound = 0;
  let linesHit = 0;
  let funcsFound = 0;
  let funcsHit = 0;

  for (const record of records) {
    const lines = record
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      continue;
    }

    const sf = lines.find((line) => line.startsWith("SF:"));
    if (!sf) {
      continue;
    }

    const sourcePath = sf.slice(3);
    if (!sourcePath.startsWith(sourcePrefix)) {
      continue;
    }
    if (exclude.includes(sourcePath)) {
      continue;
    }

    for (const line of lines) {
      if (line.startsWith("LF:")) {
        linesFound += Number(line.slice(3));
      } else if (line.startsWith("LH:")) {
        linesHit += Number(line.slice(3));
      } else if (line.startsWith("FNF:")) {
        funcsFound += Number(line.slice(4));
      } else if (line.startsWith("FNH:")) {
        funcsHit += Number(line.slice(4));
      }
    }
  }

  const linePct = linesFound === 0 ? 100 : (linesHit / linesFound) * 100;
  const functionPct = funcsFound === 0 ? 100 : (funcsHit / funcsFound) * 100;

  return {
    linesFound,
    linesHit,
    funcsFound,
    funcsHit,
    linePct,
    functionPct
  };
}

let failed = false;

console.log("Coverage summary (filtered to package sources):");
for (const target of targets) {
  const absoluteLcovPath = resolve(root, target.lcov);
  const lcovContent = readFileSync(absoluteLcovPath, "utf8");
  const result = parseCoverageForPrefix(lcovContent, target.sourcePrefix, target.exclude);
  const threshold = thresholds[target.key];
  const lineOk = result.linePct >= threshold.lines;
  const functionOk = result.functionPct >= threshold.functions;
  const status = lineOk && functionOk ? "PASS" : "FAIL";

  if (!lineOk || !functionOk) {
    failed = true;
  }

  console.log(
    `- ${target.key}: ${status} lines=${result.linePct.toFixed(2)}% (>=${threshold.lines}%) funcs=${result.functionPct.toFixed(2)}% (>=${threshold.functions}%)`
  );
}

if (failed) {
  console.error("Coverage thresholds not met.");
  process.exit(1);
}

console.log("Coverage thresholds satisfied.");
