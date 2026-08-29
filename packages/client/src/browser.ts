/**
 * Extension entry for the web extension host (vscode.dev, github.dev).
 *
 * The extension host is itself a web worker and cannot spawn a process, so the
 * server runs in a nested worker created from a bundled script. That bundle must
 * be a single self-contained file: `importScripts` is unavailable and module
 * imports are not supported there.
 */

import { env, Uri, workspace, type ExtensionContext } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/browser';

import { registerCommands } from './commands.ts';
import { registerGdzCustomEditor } from './gdz-editor.ts';
import { GdzFileSystemProvider, GDZ_SCHEME } from './gdz-fs.ts';
import { registerGdzTreeView } from './gdz-tree.ts';
import { registerGedcomXInsights } from './gedcomx-insights.ts';
import { registerVirtualIndent } from './indent.ts';
import { registerGraphView, type GedcomTestHooks } from './graph-view.ts';
import { createLog, logActivation, registerDiagnostics } from './log.ts';
import { describePanel } from './report.ts';
import { registerVersionStatus } from './version-status.ts';
import { clientOptions, SERVER_ID, SERVER_NAME } from './shared.ts';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): GedcomTestHooks {
  const log = createLog();
  context.subscriptions.push(log);

  // No `process` in a worker; the host itself is the platform worth naming.
  const facts = { host: 'browser', platform: env.appHost } as const;
  logActivation(context, log, facts);

  context.subscriptions.push(
    workspace.registerFileSystemProvider(GDZ_SCHEME, new GdzFileSystemProvider(), {
      isCaseSensitive: false,
    }),
  );

  registerGdzCustomEditor(context);
  registerGdzTreeView(context);
  registerCommands(context);
  // Both read the document directly, so they work identically in either host.
  const hooks = registerGraphView(context, log);
  registerGedcomXInsights(context, log);
  registerDiagnostics(context, log, facts, () =>
    describePanel(hooks.graphVisible(), hooks.graphDrawn()),
  );
  registerVersionStatus(context);
  registerVirtualIndent(context);

  const serverPath = Uri.joinPath(context.extensionUri, 'dist', 'browser', 'server.js');
  const worker = new Worker(serverPath.toString(true));

  // In the browser the worker itself *is* the server options; the argument order
  // matches the Node client, unlike the shape of the third argument.
  client = new LanguageClient(SERVER_ID, SERVER_NAME, worker, {
    ...clientOptions,
    outputChannel: log.channel,
  });

  log.info('Language server starting (browser, worker)');
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
