/** Server entry for the Node extension host. Communicates over IPC. */

import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';

import { startServer } from './server.ts';

startServer(createConnection(ProposedFeatures.all));
