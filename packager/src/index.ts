#!/usr/bin/env node

/**
 * IntuneGet Packager - Local Windows packaging service
 *
 * This service enables true self-hosting of IntuneGet by providing
 * a local alternative to the GitHub Actions packaging pipeline.
 *
 * Usage:
 *   npx @ugurkocde/intuneget-packager
 *   or
 *   npm install -g @ugurkocde/intuneget-packager && intuneget-packager
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, validateConfig, printConfig, PackagerConfig } from './config.js';
import { JobPoller, PackagingJob } from './job-poller.js';
import { JobProcessor } from './job-processor.js';
import { createLogger, setLogLevel, LogLevel } from './logger.js';

const logger = createLogger('Main');

// Package version from package.json
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
);

async function main() {
  const program = new Command();

  program
    .name('intuneget-packager')
    .description('IntuneGet local packaging service for Windows')
    .version(packageJson.version)
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-d, --debug', 'Enable debug logging')
    .option('--dry-run', 'Run without processing jobs (useful for testing config)')
    .action(async (options) => {
      // Set log level
      if (options.debug) {
        setLogLevel(LogLevel.DEBUG);
      } else if (options.verbose) {
        setLogLevel(LogLevel.INFO);
      }

      console.log(`
================================================================================
  IntuneGet Packager v${packageJson.version}
  Local Windows packaging service for true self-hosting
================================================================================
`);

      try {
        await run(options);
      } catch (error) {
        logger.error('Fatal error', {
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      }
    });

  // Add subcommand for checking configuration
  program
    .command('check')
    .description('Check configuration without starting the service')
    .action(async () => {
      try {
        const config = loadConfig();
        const issues = validateConfig(config);

        console.log('\nConfiguration Check\n');
        printConfig(config);

        if (issues.length > 0) {
          console.log('\nConfiguration Issues:');
          issues.forEach((issue) => console.log(`  - ${issue}`));
          process.exit(1);
        }

        console.log('\nConfiguration is valid!\n');
        process.exit(0);
      } catch (error) {
        console.error('Configuration error:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Add subcommand for downloading tools
  program
    .command('setup')
    .description('Download required tools (IntuneWinAppUtil, PSAppDeployToolkit)')
    .action(async () => {
      try {
        const config = loadConfig();
        logger.info('Setting up packager tools...');

        // Create tools directory
        await fs.promises.mkdir(config.paths.tools, { recursive: true });

        // Download tools using the JobProcessor's ensureToolsAvailable method
        const processor = new (await import('./job-processor.js')).JobProcessor(
          config,
          null
        );

        // ensureToolsAvailable is a public method that can be called without a poller
        await processor.ensureToolsAvailable();

        logger.info('Tools setup complete!');
        logger.info(`Tools location: ${config.paths.tools}`);
        process.exit(0);
      } catch (error) {
        logger.error('Setup failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      }
    });

  await program.parseAsync(process.argv);
}

async function run(options: { dryRun?: boolean }) {
  // Check if running on Windows
  if (process.platform !== 'win32') {
    logger.error('This packager must run on Windows (IntuneWinAppUtil.exe requires Windows)');
    process.exit(1);
  }

  // Load and validate configuration
  let config: PackagerConfig;
  try {
    config = loadConfig();
    const issues = validateConfig(config);

    if (issues.length > 0) {
      logger.error('Configuration issues found:');
      issues.forEach((issue) => logger.error(`  - ${issue}`));
      process.exit(1);
    }
  } catch (error) {
    logger.error('Failed to load configuration', {
      error: error instanceof Error ? error.message : String(error),
    });
    logger.info('Run "intuneget-packager check" to verify your configuration');
    process.exit(1);
  }

  // Print configuration
  printConfig(config);

  // Create required directories
  await fs.promises.mkdir(config.paths.work, { recursive: true });
  await fs.promises.mkdir(config.paths.tools, { recursive: true });

  if (options.dryRun) {
    logger.info('Dry run mode - not starting job polling');
    logger.info('Configuration is valid. Exiting.');
    process.exit(0);
  }

  // Initialize components
  const poller = new JobPoller(config);
  const processor = new JobProcessor(config, poller);

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    poller.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start polling for jobs
  logger.info('Starting job poller...');
  logger.info(`Packager ID: ${config.packagerId}`);
  logger.info(`Poll interval: ${config.polling.interval}ms`);
  logger.info('');
  logger.info('Waiting for jobs...');
  logger.info('Press Ctrl+C to stop');
  logger.info('');

  await poller.start(async (job: PackagingJob) => {
    logger.info('Processing job', {
      jobId: job.id,
      wingetId: job.winget_id,
      displayName: job.display_name,
      version: job.version,
    });

    await processor.processJob(job);
  });
}

// Run the main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
