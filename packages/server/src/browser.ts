/**
 * Server entry for the web extension host.
 *
 * Runs inside a web worker, so the connection rides the worker's `postMessage`
 * channel instead of IPC. This file exists only to build that connection — every
 * feature is shared with the Node entry.
 */

import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
} from 'vscode-languageserver/browser';

import { startServer } from './server.ts';

/**
 * Inside a worker, `self` is a `DedicatedWorkerGlobalScope`. That type lives in
 * TypeScript's WebWorker lib, which cannot be enabled alongside DOM — and DOM is
 * needed by the client, which constructs the worker. `Worker` is structurally
 * identical for the two members used here, `postMessage` and `addEventListener`,
 * and is what the message reader accepts anyway.
 */
declare const self: Worker;

startServer(createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self)));
