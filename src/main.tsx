#!/usr/bin/env node
import { render } from 'ink';
import React from 'react';
import { App } from './app/App.js';
import { program } from 'commander';

program
  .name('wam')
  .description('WezTerm Agent Manager - manage multiple AI agent sessions across repositories')
  .version('0.1.0')
  .option('-d, --dir <path>', 'default working directory for new instances', process.cwd())
  .action(async (opts) => {
    const { waitUntilExit } = render(
      <App defaultDir={opts.dir} />,
      { exitOnCtrlC: false }
    );
    await waitUntilExit();
  });

program.parse();
