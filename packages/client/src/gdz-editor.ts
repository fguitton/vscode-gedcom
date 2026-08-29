/**
 * Custom Editor Provider for .gdz (GEDZIP) archives.
 *
 * When a user opens a .gdz file, this displays a rich interactive archive viewer
 * with file explorer, dataset statistics, media gallery previews, and direct 1-click
 * actions to open gedcom.ged or the visual tree.
 */

import {
  commands,
  Uri,
  window,
  workspace,
  type CancellationToken,
  type CustomDocument,
  type CustomDocumentOpenContext,
  type CustomReadonlyEditorProvider,
  type ExtensionContext,
  type WebviewPanel,
} from 'vscode';
import { analyzeText, detect, readGdz, statistics, toDataUrl } from '@vscode-gedcom/core';
import { toGdzUri } from './gdz-fs.ts';
import { contentSecurityPolicy } from './policy.ts';
import { t } from './l10n.ts';

export const GDZ_EDITOR_VIEW_TYPE = 'gedcom.gdzViewer';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export class GdzCustomEditorProvider implements CustomReadonlyEditorProvider {
  readonly context: ExtensionContext;

  constructor(context: ExtensionContext) {
    this.context = context;
  }

  openCustomDocument(
    uri: Uri,
    _openContext: CustomDocumentOpenContext,
    _token: CancellationToken,
  ): CustomDocument {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: CustomDocument,
    webviewPanel: WebviewPanel,
    _token: CancellationToken,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [Uri.joinPath(document.uri, '..')],
    };

    let rawBytes: Uint8Array;
    try {
      rawBytes = await workspace.fs.readFile(document.uri);
    } catch (err) {
      webview.html = `<html><body><p>Failed to read archive: ${escapeHtml(String(err))}</p></body></html>`;
      return;
    }

    let archive;
    try {
      archive = readGdz(rawBytes);
    } catch (err) {
      webview.html = `<html><body><p>Failed to parse GEDZIP archive: ${escapeHtml(String(err))}</p></body></html>`;
      return;
    }

    const archiveName = document.uri.path.split('/').filter(Boolean).pop() ?? 'archive.gdz';
    const totalSize = formatSize(rawBytes.byteLength);
    const detection = detect(new TextEncoder().encode(archive.gedcomText));
    const analysis = analyzeText(archive.gedcomText);
    const stats = statistics(analysis);

    // Collect file entries
    const fileEntries: {
      path: string;
      name: string;
      size: string;
      isMedia: boolean;
      isGedcom: boolean;
      webviewUri?: string;
    }[] = [];
    for (const [relPath, fileBytes] of archive.files.entries()) {
      const lower = relPath.toLowerCase();
      const isGedcom = lower.endsWith('.ged');
      const isMedia = /\.(jpg|jpeg|png|gif|webp|svg|bmp|pdf)$/i.test(lower);
      const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(lower);

      let imageWebviewUri: string | undefined;
      if (isImage) {
        imageWebviewUri = toDataUrl(fileBytes, relPath);
      }

      fileEntries.push({
        path: relPath,
        name: relPath.split('/').pop() ?? relPath,
        size: formatSize(fileBytes.byteLength),
        isMedia,
        isGedcom,
        webviewUri: imageWebviewUri,
      });
    }

    // Message handler
    webviewPanel.webview.onDidReceiveMessage(async (msg: { command: string; path?: string }) => {
      if (msg.command === 'openFile' && msg.path) {
        const virtualUri = toGdzUri(document.uri, msg.path);
        await commands.executeCommand('vscode.open', virtualUri);
      } else if (msg.command === 'openTree') {
        const virtualUri = toGdzUri(document.uri, archive.gedcomPath);
        await commands.executeCommand('vscode.open', virtualUri);
        await commands.executeCommand('gedcom.showGraph');
      } else if (msg.command === 'unpack') {
        await commands.executeCommand('gedcom.unpackGdz', document.uri);
      } else if (msg.command === 'mount') {
        await commands.executeCommand('gedcom.mountGdz', document.uri);
      }
    });

    const nonce = Math.random().toString(36).slice(2);
    const csp = contentSecurityPolicy({
      nonce,
      images: true,
      dataImages: true,
      cspSource: webview.cspSource,
    });

    const mediaList = fileEntries.filter((f) => f.webviewUri);

    webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(archiveName)}</title>
  <style nonce="${nonce}">
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --card-bg: var(--vscode-sideBar-background, var(--vscode-editorWidget-background));
      --border: var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --sec-btn-bg: var(--vscode-button-secondaryBackground, #3a3d41);
      --sec-btn-fg: var(--vscode-button-secondaryForeground, #ffffff);
      --sec-btn-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
      --badge-bg: var(--vscode-badge-background);
      --badge-fg: var(--vscode-badge-foreground);
    }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      margin: 0;
      padding: 24px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }
    .title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .archive-icon {
      width: 36px;
      height: 36px;
      fill: currentColor;
      opacity: 0.85;
    }
    h1 {
      margin: 0;
      font-size: 1.4rem;
      font-weight: 600;
    }
    .subtitle {
      font-size: 0.85rem;
      opacity: 0.75;
      margin-top: 2px;
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
      background: var(--btn-bg);
      color: var(--btn-fg);
      transition: background 0.15s ease;
    }
    button:hover {
      background: var(--btn-hover);
    }
    button.secondary {
      background: var(--sec-btn-bg);
      color: var(--sec-btn-fg);
    }
    button.secondary:hover {
      background: var(--sec-btn-hover);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      text-align: center;
    }
    .stat-num {
      font-size: 1.3rem;
      font-weight: 700;
      color: var(--btn-bg);
    }
    .stat-label {
      font-size: 0.75rem;
      opacity: 0.8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 4px;
    }
    .section-title {
      font-size: 1.05rem;
      font-weight: 600;
      margin: 24px 0 12px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--badge-bg);
      color: var(--badge-fg);
    }
    .file-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      margin-bottom: 24px;
    }
    .file-table th, .file-table td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border);
      font-size: 0.85rem;
    }
    .file-table th {
      background: rgba(128, 128, 128, 0.08);
      font-weight: 600;
      font-size: 0.8rem;
      text-transform: uppercase;
      opacity: 0.85;
    }
    .file-table tr:last-child td {
      border-bottom: none;
    }
    .file-table tr:hover td {
      background: rgba(128, 128, 128, 0.05);
    }
    .file-link {
      color: var(--vscode-textLink-foreground, #3794ff);
      cursor: pointer;
      text-decoration: none;
      font-weight: 500;
    }
    .file-link:hover {
      text-decoration: underline;
    }
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 16px;
    }
    .gallery-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .gallery-card:hover {
      transform: translateY(-2px);
      border-color: var(--btn-bg);
    }
    .gallery-thumb {
      width: 100%;
      height: 140px;
      object-fit: cover;
      background: rgba(0, 0, 0, 0.1);
    }
    .gallery-caption {
      padding: 8px 10px;
      font-size: 0.8rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <div>
        <h1>${escapeHtml(archiveName)}</h1>
        <div class="subtitle">GEDZIP Archive &bull; ${totalSize} &bull; GEDCOM ${escapeHtml(detection.version || '7.0')}</div>
      </div>
    </div>
    <div class="actions">
      <button id="btnOpenGedcom">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8l3 3v11H1V1h3zm7 1H2v12h12V5h-3V2z"/></svg>
        ${escapeHtml(t('Open {0}', archive.gedcomPath))}
      </button>
      <button class="secondary" id="btnOpenTree">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5 2v3H3v6h2v3h6v-3h2V5h-2V2H5zm5 1v2H6V3h4zM4 6h8v4H4V6zm2 5h4v2H6v-2z"/></svg>
        ${escapeHtml(t('Show Tree'))}
      </button>
      <button class="secondary" id="btnMount">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5l.5-.5h4.2l1.3 1.5H14.5l.5.5v8l-.5.5h-13l-.5-.5v-9.5zm1 1v8h12V5H6.8l-1.3-1.5H2v1z"/></svg>
        ${escapeHtml(t('Mount in Explorer'))}
      </button>
      <button class="secondary" id="btnUnpack">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm0-9v5l3-3-1-1-2 2V5H8z"/></svg>
        ${escapeHtml(t('Unpack Archive'))}
      </button>
    </div>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-num">${stats.records['INDI'] ?? 0}</div>
      <div class="stat-label">${escapeHtml(t('Individuals'))}</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${stats.records['FAM'] ?? 0}</div>
      <div class="stat-label">${escapeHtml(t('Families'))}</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${fileEntries.length}</div>
      <div class="stat-label">${escapeHtml(t('Files in Archive'))}</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${mediaList.length}</div>
      <div class="stat-label">${escapeHtml(t('Media Assets'))}</div>
    </div>
  </div>

  <div class="section-title">
    ${escapeHtml(t('Archive Files'))}
    <span class="badge">${fileEntries.length}</span>
  </div>

  <table class="file-table">
    <thead>
      <tr>
        <th>${escapeHtml(t('File Name'))}</th>
        <th>${escapeHtml(t('Path'))}</th>
        <th>${escapeHtml(t('Size'))}</th>
        <th>${escapeHtml(t('Action'))}</th>
      </tr>
    </thead>
    <tbody>
      ${fileEntries
        .map(
          (f) => `<tr>
        <td><strong>${escapeHtml(f.name)}</strong></td>
        <td><code>${escapeHtml(f.path)}</code></td>
        <td>${escapeHtml(f.size)}</td>
        <td>
          <a class="file-link" data-path="${escapeHtml(f.path)}">${escapeHtml(t('Open'))}</a>
        </td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>

  ${
    mediaList.length > 0
      ? `<div class="section-title">
      ${escapeHtml(t('Media Gallery'))}
      <span class="badge">${mediaList.length}</span>
    </div>
    <div class="gallery-grid">
      ${mediaList
        .map(
          (m) => `<div class="gallery-card" data-path="${escapeHtml(m.path)}">
        <img class="gallery-thumb" src="${m.webviewUri}" alt="${escapeHtml(m.name)}" loading="lazy">
        <div class="gallery-caption" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</div>
      </div>`,
        )
        .join('')}
    </div>`
      : ''
  }

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.getElementById('btnOpenGedcom')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'openFile', path: '${escapeHtml(archive.gedcomPath)}' });
    });

    document.getElementById('btnOpenTree')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'openTree' });
    });

    document.getElementById('btnMount')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'mount' });
    });

    document.getElementById('btnUnpack')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'unpack' });
    });

    document.querySelectorAll('.file-link, .gallery-card').forEach((el) => {
      el.addEventListener('click', () => {
        const path = el.getAttribute('data-path');
        if (path) {
          vscode.postMessage({ command: 'openFile', path });
        }
      });
    });
  </script>
</body>
</html>`;
  }
}

export function registerGdzCustomEditor(context: ExtensionContext): void {
  context.subscriptions.push(
    window.registerCustomEditorProvider(
      GDZ_EDITOR_VIEW_TYPE,
      new GdzCustomEditorProvider(context),
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
  );
}
