import { collectCommand } from "./commands/collect";
import { healthCommand } from "./commands/health";

const command = process.argv[2] ?? "collect";
const args = process.argv.slice(3);
const exitCode = command === "health"
  ? await healthCommand({ env: process.env, json: args.includes("--json") })
  : command === "collect"
    ? await collectCommand({ env: process.env, argv: args })
    : 1;
if (exitCode !== 0) process.exitCode = exitCode;
