/**
 * The graph panel.
 *
 * Shows the neighbourhood of whatever record the cursor is in. A GEDCOM file is
 * a graph written down as text, and the one thing text cannot show is shape —
 * who connects to whom, and how densely.
 *
 * The panel reads the document directly rather than asking the language server.
 * `packages/core` is already bundled into the client, parsing is cheap next to
 * the round trip, and it keeps the panel working even while the server restarts.
 */

import { neighbourhood, recordAt, type Graph } from '@vscode-gedcom/core';
import {
  commands,
  Range,
  Selection,
  TextEditorRevealType,
  Uri,
  ViewColumn,
  window,
  workspace,
  type CancellationToken,
  type ExtensionContext,
  type TextEditor,
  type WebviewView,
  type WebviewViewProvider,
  type WebviewViewResolveContext,
} from 'vscode';
import { analyzeText } from '@vscode-gedcom/core';

export const GRAPH_VIEW_ID = 'gedcom.graph';

/** Message from the webview when a node is clicked. */
interface RevealMessage {
  readonly type: 'reveal';
  readonly line: number;
}

export class GedcomGraphViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  /** The document the panel is currently showing, so clicks reveal in the right one. */
  private documentUri: Uri | undefined;

  resolveWebviewView(
    view: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken,
  ): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = shell();

    view.webview.onDidReceiveMessage((message: RevealMessage) => {
      if (message.type === 'reveal') void this.reveal(message.line);
    });

    view.onDidChangeVisibility(() => {
      if (view.visible) this.update(window.activeTextEditor);
    });

    this.update(window.activeTextEditor);
  }

  /** Recomputes and pushes the graph for the editor's current cursor position. */
  update(editor: TextEditor | undefined): void {
    if (!this.view?.visible) return;

    if (!editor || editor.document.languageId !== 'gedcom') {
      this.documentUri = undefined;
      void this.view.webview.postMessage({ type: 'empty', reason: 'no-document' });
      return;
    }

    this.documentUri = editor.document.uri;

    const analysis = analyzeText(editor.document.getText());
    const focus = recordAt(analysis, editor.selection.active.line);
    const depth = workspace.getConfiguration('gedcom').get<number>('graph.depth', 2);
    const graph = neighbourhood(analysis, focus, { depth });

    void this.view.webview.postMessage({ type: 'graph', graph: serialize(graph) });
  }

  private async reveal(line: number): Promise<void> {
    if (!this.documentUri) return;

    const document = await workspace.openTextDocument(this.documentUri);
    const editor = await window.showTextDocument(document, {
      viewColumn: ViewColumn.Active,
      preserveFocus: false,
    });

    const position = new Range(line, 0, line, 0);
    editor.selection = new Selection(position.start, position.start);
    editor.revealRange(position, TextEditorRevealType.InCenterIfOutsideViewport);
  }
}

/** `elided` is a Map, which does not survive structured cloning to a webview. */
function serialize(graph: Graph) {
  return { ...graph, elided: [...graph.elided.entries()] };
}

function nonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(
    { length: 32 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
}

/**
 * The panel document.
 *
 * Everything is inline behind a nonce: the content security policy forbids
 * anything else, and the panel has no assets worth loading separately. Colours
 * come from VS Code's theme variables rather than being chosen here, so the
 * panel matches whatever theme the reader is using, high-contrast included.
 */
function shell(): string {
  const id = nonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${id}'; script-src 'nonce-${id}';">
<style nonce="${id}">
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  #empty {
    padding: 1rem;
    color: var(--vscode-descriptionForeground);
  }
  #scroll { overflow: auto; width: 100%; height: 100vh; }
  .edge { stroke: var(--vscode-editorIndentGuide-activeBackground, currentColor); stroke-width: 1; opacity: .5; }
  .edge-label {
    fill: var(--vscode-descriptionForeground);
    font-size: 9px;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .node rect {
    fill: var(--vscode-editorWidget-background);
    stroke: var(--vscode-editorWidget-border, var(--vscode-focusBorder));
    stroke-width: 1;
    rx: 3;
  }
  .node.focus rect {
    stroke: var(--vscode-focusBorder);
    stroke-width: 2;
    fill: var(--vscode-list-activeSelectionBackground);
  }
  .node text.label { fill: var(--vscode-foreground); font-size: 11px; }
  .node.focus text.label { fill: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); }
  .node text.tag {
    fill: var(--vscode-descriptionForeground);
    font-size: 9px;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .node { cursor: pointer; }
  .node:hover rect { stroke: var(--vscode-focusBorder); }
  .node:focus-visible rect { stroke: var(--vscode-focusBorder); stroke-width: 2; }
  .elided { fill: var(--vscode-descriptionForeground); font-size: 9px; }
</style>
</head>
<body>
<div id="empty">Open a GEDCOM file and place the cursor in a record.</div>
<div id="scroll"><svg id="graph" xmlns="http://www.w3.org/2000/svg"></svg></div>
<script nonce="${id}">
(function () {
  const vscode = acquireVsCodeApi();
  const svg = document.getElementById('graph');
  const empty = document.getElementById('empty');
  const scroll = document.getElementById('scroll');
  const NS = 'http://www.w3.org/2000/svg';

  const NODE_WIDTH = 170;
  const NODE_HEIGHT = 40;

  function el(name, attrs, text) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function truncate(text, max) {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  function render(graph) {
    svg.replaceChildren();

    if (!graph.nodes.length) {
      empty.textContent = 'No record at the cursor.';
      empty.style.display = 'block';
      scroll.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    scroll.style.display = 'block';

    const width = graph.width + NODE_WIDTH;
    svg.setAttribute('width', width);
    svg.setAttribute('height', graph.height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + graph.height);

    const byXref = new Map(graph.nodes.map((n) => [n.xref, n]));

    // Edges first so nodes draw over them.
    for (const edge of graph.edges) {
      const from = byXref.get(edge.from);
      const to = byXref.get(edge.to);
      if (!from || !to) continue;

      const x1 = from.x + NODE_WIDTH;
      const y1 = from.y + NODE_HEIGHT / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_HEIGHT / 2;
      const mid = (x1 + x2) / 2;

      svg.appendChild(
        el('path', {
          class: 'edge',
          d: 'M ' + x1 + ' ' + y1 + ' C ' + mid + ' ' + y1 + ', ' + mid + ' ' + y2 + ', ' + x2 + ' ' + y2,
          fill: 'none',
        }),
      );
      svg.appendChild(
        el('text', { class: 'edge-label', x: mid, y: (y1 + y2) / 2 - 3, 'text-anchor': 'middle' }, edge.tag),
      );
    }

    for (const node of graph.nodes) {
      const group = el('g', {
        class: 'node' + (node.xref === graph.focus ? ' focus' : ''),
        transform: 'translate(' + node.x + ',' + node.y + ')',
        tabindex: '0',
        role: 'button',
        'aria-label': node.tag + ' ' + node.label,
      });

      group.appendChild(el('rect', { width: NODE_WIDTH, height: NODE_HEIGHT }));
      group.appendChild(el('text', { class: 'label', x: 8, y: 17 }, truncate(node.label, 24)));
      group.appendChild(el('text', { class: 'tag', x: 8, y: 31 }, node.tag + ' @' + node.xref + '@'));

      const reveal = () => vscode.postMessage({ type: 'reveal', line: node.line });
      group.addEventListener('click', reveal);
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          reveal();
        }
      });

      const elided = (graph.elided || []).find((entry) => entry[0] === node.xref);
      if (elided) {
        group.appendChild(
          el('text', { class: 'elided', x: NODE_WIDTH - 8, y: 31, 'text-anchor': 'end' }, '+' + elided[1]),
        );
      }

      svg.appendChild(group);
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'graph') render(message.graph);
    else if (message.type === 'empty') {
      empty.textContent = 'Open a GEDCOM file and place the cursor in a record.';
      empty.style.display = 'block';
      scroll.style.display = 'none';
    }
  });
}());
</script>
</body>
</html>`;
}

/** Wires the panel to the editor, in whichever host is running. */
export function registerGraphView(context: ExtensionContext): void {
  const provider = new GedcomGraphViewProvider();

  context.subscriptions.push(
    // A panel view behind a `when` clause is close to undiscoverable: it appears
    // as one more tab beside Terminal and Output, only once a GEDCOM file happens
    // to be focused. An explicit command in the palette and a button on the
    // editor title bar give it two ways in that do not rely on noticing a tab.
    commands.registerCommand('gedcom.showGraph', async () => {
      await commands.executeCommand(`${GRAPH_VIEW_ID}.focus`);
      provider.update(window.activeTextEditor);
    }),
    window.registerWebviewViewProvider(GRAPH_VIEW_ID, provider, {
      // The panel is cheap to rebuild from the document, so there is no state
      // worth the memory cost of keeping it alive while hidden.
      webviewOptions: { retainContextWhenHidden: false },
    }),
    window.onDidChangeActiveTextEditor((editor) => provider.update(editor)),
    window.onDidChangeTextEditorSelection((event) => provider.update(event.textEditor)),
    workspace.onDidChangeTextDocument((event) => {
      const editor = window.activeTextEditor;
      if (editor && event.document === editor.document) provider.update(editor);
    }),
  );
}
