/**
 * Extension entry for the web extension host (vscode.dev, github.dev).
 *
 * The extension host is itself a web worker and cannot spawn a process, so the
 * server runs in a nested worker created from a bundled script. That bundle must
 * be a single self-contained file: `importScripts` is unavailable and module
 * imports are not supported there.
 */

import { Uri, type ExtensionContext } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/browser';

import { registerCommands } from './commands.ts';
import { registerGraphView, type GedcomTestHooks } from './graph-view.ts';
import { registerVersionStatus } from './version-status.ts';
import { clientOptions, OUTPUT_CHANNEL_NAME, SERVER_ID, SERVER_NAME } from './shared.ts';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): GedcomTestHooks {
  registerCommands(context);
  // Both read the document directly, so they work identically in either host.
  const hooks = registerGraphView(context);
  registerVersionStatus(context);

  const serverPath = Uri.joinPath(context.extensionUri, 'dist', 'browser', 'server.js');
  const worker = new Worker(serverPath.toString(true));

  // In the browser the worker itself *is* the server options; the argument order
  // matches the Node client, unlike the shape of the third argument.
  client = new LanguageClient(SERVER_ID, SERVER_NAME, worker, {
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
