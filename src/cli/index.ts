#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { runInit } from "./init.js";
import { runShow } from "./show.js";
import { runStatus } from "./status.js";
import { runLog } from "./log.js";
import { runAuditMerge } from "../merge/auditMerge.js";

const HELP_TEXT = `─────────────────────────────────────────
audit — prompt-native version control for AI-generated code

Usage:
  audit init              Set up git-audit in this repo
  audit status            Codebase-wide trust and risk overview
  audit show <function>   Full audit history for a function
  audit log               All prompt events and what they caused
  audit merge             Check for audit conflicts before merging
  audit help              Show this help text
─────────────────────────────────────────`;

const subcommand = process.argv[2];
const arg = process.argv[3];

try {
  switch (subcommand) {
    case "init":
      await runInit();
      break;

    case "show":
      if (!arg) {
        process.stdout.write("Usage: audit show <function>\n");
        process.exit(1);
      }
      await runShow(arg);
      break;

    case "status":
      await runStatus();
      break;

    case "log":
      await runLog();
      break;

    case "merge":
      await runAuditMerge(process.argv[3], process.argv[4]);
      break;

    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(HELP_TEXT + "\n");
      break;

    default:
      process.stdout.write(`Unknown command: ${subcommand}\n`);
      process.stdout.write(HELP_TEXT + "\n");
      break;
  }
} catch (err) {
  process.stderr.write(`audit error: ${(err as Error).message}\n`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // routing logic runs at module level, no extra call needed
}
