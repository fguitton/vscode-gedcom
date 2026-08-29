/** Extension entry for the Node extension host. */

import * as path from 'node:path';

import type { ExtensionContext } from 'vscode';
import { LanguageClient, TransportKind, type ServerOptions } from 'vscode-languageclient/node';

import { registerCommands } from './commands.ts';
import { GdzFileSystemProvider, GDZ_SCHEME } from './gdz-fs.ts';
import { registerGedcomXInsights } from './gedcomx-insights.ts';
import { registerVirtualIndent } from './indent.ts';
import { registerGraphView, type GedcomTestHooks } from './graph-view.ts';
import { createLog, logActivation, registerDiagnostics } from './log.ts';
import { describePanel } from './report.ts';
import { registerVersionStatus } from './version-status.ts';
import { clientOptions, SERVER_ID, SERVER_NAME } from './shared.ts';
import { workspace } from 'vscode';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): GedcomTestHooks {
  const log = createLog();
  context.subscriptions.push(log);

  const facts = { host: 'node', platform: process.platform } as const;
  logActivation(context, log, facts);

  context.subscriptions.push(
    workspace.registerFileSystemProvider(GDZ_SCHEME, new GdzFileSystemProvider(), {
      isCaseSensitive: false,
    }),
  );

  registerCommands(context);
  const hooks = registerGraphView(context, log);
  registerGedcomXInsights(context, log);
  registerDiagnostics(context, log, facts, () =>
    describePanel(hooks.graphVisible(), hooks.graphDrawn()),
  );
  registerVersionStatus(context);
  registerVirtualIndent(context);

  const module = context.asAbsolutePath(path.join('dist', 'node', 'server.cjs'));

  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: {
      module,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  client = new LanguageClient(SERVER_ID, SERVER_NAME, serverOptions, {
    ...clientOptions,
    // Ours rather than one of its own, so the server's lines land in the same
    // channel as everything else and in a report alongside them.
    outputChannel: log.channel,
  });

  log.info('Language server starting (node, ipc)');
  const started = Date.now();
  void client.start().then(
    () => {
      log.info(`Language server ready in ${Date.now() - started} ms`);
    },
    (failure: unknown) => {
      log.error(`Language server failed to start: ${String(failure)}`);
    },
  );

  return hooks;
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}
