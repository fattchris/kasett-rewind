#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { generateConfig } from './generate-config.js';

/**
 * CLI entry point for kasett-rewind.
 * Uses Node.js built-in parseArgs (no external dependencies).
 *
 * Commands:
 *   generate-config  — Output the openclaw.json config block
 *
 * Usage:
 *   npx kasett-rewind generate-config [--window-size 2] [--no-thread-tracking] [--budget-split 0.3,0.3,0.4]
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  switch (command) {
    case 'generate-config':
      await runGenerateConfig(args.slice(1));
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('');
      printUsage();
      process.exitCode = 1;
  }
}

/**
 * Run the generate-config command with parsed flags.
 */
async function runGenerateConfig(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: args as string[],
    options: {
      'window-size': { type: 'string', short: 'w' },
      'no-thread-tracking': { type: 'boolean' },
      'budget-split': { type: 'string', short: 'b' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  if (values.help) {
    printGenerateConfigHelp();
    return;
  }

  const windowSize = values['window-size']
    ? parseInt(values['window-size'], 10)
    : undefined;

  const threadTracking = values['no-thread-tracking'] ? false : undefined;

  const budgetSplit = values['budget-split']
    ? values['budget-split'].split(',').map(Number)
    : undefined;

  const output = generateConfig({ windowSize, threadTracking, budgetSplit });
  console.log(output);
}

/**
 * Print top-level usage information.
 */
function printUsage(): void {
  console.log(`kasett-rewind — OpenClaw compaction plugin

USAGE:
  kasett-rewind <command> [options]

COMMANDS:
  generate-config    Generate openclaw.json configuration block

OPTIONS:
  -h, --help         Show this help message

EXAMPLES:
  kasett-rewind generate-config
  kasett-rewind generate-config --window-size 3
  kasett-rewind generate-config --no-thread-tracking
  kasett-rewind generate-config --budget-split 0.25,0.25,0.5`);
}

/**
 * Print help for the generate-config command.
 */
function printGenerateConfigHelp(): void {
  console.log(`kasett-rewind generate-config — Generate openclaw.json config

USAGE:
  kasett-rewind generate-config [options]

OPTIONS:
  -w, --window-size <n>      Number of summaries to retain (1-5, default: 2)
  --no-thread-tracking       Disable structured thread tracking
  -b, --budget-split <csv>   Comma-separated budget proportions (must sum to 1.0)
                             Length must be windowSize + 1
  -h, --help                 Show this help message

EXAMPLES:
  kasett-rewind generate-config
  kasett-rewind generate-config -w 3 -b 0.2,0.2,0.2,0.4
  kasett-rewind generate-config --no-thread-tracking`);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
