/** Client configuration common to both extension hosts. */

import type { LanguageClientOptions } from 'vscode-languageclient';

export const SERVER_ID = 'gedcom';
export const SERVER_NAME = 'GEDCOM Language Server';
export const OUTPUT_CHANNEL_NAME = 'GEDCOM';

export const clientOptions: LanguageClientOptions = {
  documentSelector: [{ language: 'gedcom' }],
  synchronize: {
    configurationSection: 'gedcom',
  },
};
