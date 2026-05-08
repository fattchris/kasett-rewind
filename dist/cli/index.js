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
 *   npx kasett-rewind generate-config [--window-size 3] [--no-thread-tracking] [--weights 1.0,0.6,0.3]
 */
async function main() {
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
async function runGenerateConfig(args) {
    const { values } = parseArgs({
        args: args,
        options: {
            'window-size': { type: 'string', short: 'w' },
            'no-thread-tracking': { type: 'boolean' },
            'weights': { type: 'string' },
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
    const weights = values['weights']
        ? values['weights'].split(',').map(Number)
        : undefined;
    const output = generateConfig({ windowSize, threadTracking, weights });
    console.log(output);
}
/**
 * Print top-level usage information.
 */
function printUsage() {
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
  kasett-rewind generate-config --weights 1.0,0.7,0.4`);
}
/**
 * Print help for the generate-config command.
 */
function printGenerateConfigHelp() {
    console.log(`kasett-rewind generate-config — Generate openclaw.json config

USAGE:
  kasett-rewind generate-config [options]

OPTIONS:
  -w, --window-size <n>      Number of previous compactions to evaluate (1-5, default: 3)
  --no-thread-tracking       Disable thread tracking
  --weights <csv>            Comma-separated weights, most recent first (must be 0-1)
                             Length must equal windowSize
  -h, --help                 Show this help message

EXAMPLES:
  kasett-rewind generate-config
  kasett-rewind generate-config -w 4 --weights 1.0,0.7,0.4,0.2
  kasett-rewind generate-config --no-thread-tracking`);
}
main().catch((err) => {
    console.error('Fatal error:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map