#!/usr/bin/env node
// copy-back real-capture test. Run with --help for the whole workflow.
//
//   node scripts/captures.mjs add                (right after Cmd+C in your terminal)
//   node scripts/captures.mjs run --show         (USER-RUN ONLY: prints your own text)
//   node scripts/captures.mjs tally              (the K1 verdict on real copies)
//
// PRIVACY: add, run and tally print counts and ids only. Only run --show prints
// text; it announces that on stderr and refuses unless stdout is a terminal
// (or --allow-redirect is given). The clipboard is read ONLY by `add`,
// through macOS pbpaste, started directly (no shell). Tests never run `add`
// through this script: they inject a fake clipboard into runCli.

import os from "node:os";
import { runCli } from "../src/captures/cli.ts";
import { pbpasteReader } from "../src/captures/clipboard.ts";

// A closed pipe (for example `| head`) is not an error worth a stack trace.
process.stdout.on("error", (err) => {
  if (err.code !== "EPIPE") throw err;
});

process.exitCode = runCli(process.argv.slice(2), {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  stdoutIsTTY: process.stdout.isTTY === true,
  readClipboard: pbpasteReader(),
  home: os.homedir(),
});
