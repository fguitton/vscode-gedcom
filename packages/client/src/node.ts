/** Extension entry for the Node extension host. */

import * as path from 'node:path';

import type { ExtensionContext } from 'vscode';
import { LanguageClient, TransportKind, type ServerOptions } from 'vscode-languageclient/node';

import { registerCommands } from './commands.ts';
import { registerGraphView, type GedcomTestHooks } from './graph-view.ts';
import { registerVersionStatus } from './version-status.ts';
import { clientOptions, OUTPUT_CHANNEL_NAME, SERVER_ID, SERVER_NAME } from './shared.ts';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): GedcomTestHooks {
  registerCommands(context);
  const hooks = registerGraphView(context);
  registerVersionStatus(context);

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
    outputChannelName: OUTPUT_CHANNEL_NAME,
  });

  void client.start();

  return hooks;
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}
