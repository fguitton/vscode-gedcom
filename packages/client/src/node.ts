/** Extension entry for the Node extension host. */

import * as path from 'node:path';

import type { ExtensionContext } from 'vscode';
import { LanguageClient, TransportKind, type ServerOptions } from 'vscode-languageclient/node';

import { registerGraphView } from './graph-view.ts';
import { clientOptions, OUTPUT_CHANNEL_NAME, SERVER_ID, SERVER_NAME } from './shared.ts';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  registerGraphView(context);

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
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}
