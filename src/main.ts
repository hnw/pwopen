#!/usr/bin/env node

import { Command } from 'commander';

import { openUrls } from './core/browser';
import { config } from './core/config';
import { collectInputs, validateUrls } from './core/input';

const program = new Command();

program
  .name('pwopen')
  .description('Playwright-based URL opener with Sixel screenshot')
  .version('0.1.0')
  .option('--headed', 'Show browser window (default: headless)')
  .option('--screenshot', 'Render a Sixel screenshot after page load')
  .option('--full-page', 'Capture full page when taking a screenshot')
  .option('--sandbox', 'Enable Chromium sandbox', true)
  .option('--no-sandbox', 'Disable Chromium sandbox')
  .argument('[urls...]', 'URLs to open')
  .parse(process.argv);

async function run(): Promise<void> {
  const options = program.opts<{
    headed?: boolean;
    screenshot?: boolean;
    fullPage?: boolean;
    sandbox?: boolean;
  }>();
  const args = program.args as string[];

  const inputs = await collectInputs(args);
  const urls = validateUrls(inputs);

  if (urls.length === 0) {
    console.warn('[WARN] No valid URLs provided.');
    return;
  }

  await openUrls(urls, {
    headed: Boolean(options.headed),
    screenshot: Boolean(options.screenshot),
    fullPage: Boolean(options.fullPage),
    sandbox: Boolean(options.sandbox),
  });
}

void (async () => {
  try {
    void config;
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ERROR] ${message}`);
    process.exitCode = 1;
  }
})();
