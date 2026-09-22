#!/usr/bin/env node
import { runCli } from './cli-runner.js';
import { asErrorMessage } from './errors.js';

runCli(process.argv).catch((error: unknown) => {
  process.stderr.write(`ssb: ${asErrorMessage(error)}\n`);
  process.exitCode = 1;
});
