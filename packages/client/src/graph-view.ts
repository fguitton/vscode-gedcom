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

import { neighbourhood, recordAt, type Direction, type Graph } from '@vscode-gedcom/core';
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
import { revealLine } from './commands.ts';

export const GRAPH_VIEW_ID = 'gedcom.graph';

/** Messages from the webview: a node was clicked, or a control was used. */
type PanelMessage =
  | { readonly type: 'reveal'; readonly line: number }
  | { readonly type: 'direction'; readonly value: Direction };

export class GedcomGraphViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  /** The document the panel is currently showing, so clicks reveal in the right one. */
  private documentUri: Uri | undefined;
  /**
   * Which way through the generations to travel. View state rather than a
   * setting: it is something a reader flips while looking, not something they
   * configure once.
   */
  private direction: Direction = 'both';

  resolveWebviewView(
    view: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken,
  ): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = shell();

    view.webview.onDidReceiveMessage((message: PanelMessage) => {
      if (message.type === 'reveal') void this.reveal(message.line);
      else if (message.type === 'direction') {
        this.direction = message.value;
        this.update(window.activeTextEditor);
      }
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
    const configuration = workspace.getConfiguration('gedcom');
    const graph = neighbourhood(analysis, focus, {
      depth: configuration.get<number>('graph.depth', 2),
      includeReferences: configuration.get<boolean>('graph.includeReferences', false),
      direction: this.direction,
    });

    void this.view.webview.postMessage({
      type: 'graph',
      graph: serialize(graph),
      direction: this.direction,
    });
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
  #controls {
    display: flex;
    gap: .25rem;
    padding: .35rem .5rem;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
  }
  #controls button {
    font-family: inherit;
    font-size: calc(var(--vscode-font-size) * .9);
    color: var(--vscode-foreground);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: .15rem .5rem;
    cursor: pointer;
  }
  #controls button:hover { background: var(--vscode-toolbar-hoverBackground); }
  #controls button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  #controls button[aria-pressed="true"] {
    background: var(--vscode-inputOption-activeBackground);
    border-color: var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder));
    color: var(--vscode-inputOption-activeForeground, var(--vscode-foreground));
  }
  /* The controls take a fixed strip; the drawing gets the rest. */
  #scroll { overflow: auto; width: 100%; height: calc(100vh - 2rem); }
  .edge { stroke: var(--vscode-editorIndentGuide-activeBackground, currentColor); stroke-width: 1; opacity: .5; }
  .edge-label text {
    fill: var(--vscode-descriptionForeground);
    font-size: 9px;
  }
  .edge-label-plate {
    fill: var(--vscode-sideBar-background, var(--vscode-editor-background));
    opacity: .85;
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
<div id="controls" role="group" aria-label="Direction of travel">
  <button type="button" data-direction="both" aria-pressed="true">Both</button>
  <button type="button" data-direction="ancestors" aria-pressed="false">Ancestors</button>
  <button type="button" data-direction="descendants" aria-pressed="false">Descendants</button>
</div>
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
  /** Vertical space one edge label needs, for nudging collisions apart. */
  const LABEL_HEIGHT = 13;

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
    const labelled = [];

    for (const edge of graph.edges) {
      const a = byXref.get(edge.from);
      const b = byXref.get(edge.to);
      if (!a || !b) continue;

      // Always draw left to right, whichever way the pointer happens to be
      // written. A relationship recorded from the far end would otherwise loop
      // backwards across the columns for no reason the reader can see.
      const from = a.x <= b.x ? a : b;
      const to = a.x <= b.x ? b : a;

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

      // The label reads from the left-hand node to the right-hand one, so it
      // follows the direction the edge is actually drawn in.
      const text = from.xref === edge.from ? edge.label : edge.reverseLabel;
      labelled.push({ text: text, x: mid, y: (y1 + y2) / 2 });
    }

    // Labels after every curve, so no edge is drawn across one, and nudged apart
    // where two would otherwise sit on the same spot.
    const occupied = [];
    for (const label of labelled) {
      let y = label.y;
      while (occupied.some((taken) => Math.abs(taken - y) < LABEL_HEIGHT)) y += LABEL_HEIGHT;
      occupied.push(y);

      const group = el('g', { class: 'edge-label' });
      const text = el('text', { x: label.x, y: y + 3, 'text-anchor': 'middle' }, label.text);

      // A backing plate, because a label sitting on a bundle of curves is
      // unreadable however it is coloured. Sized from the text, since SVG has no
      // way to ask for a background.
      const width = label.text.length * 5.4 + 8;
      group.appendChild(
        el('rect', {
          class: 'edge-label-plate',
          x: label.x - width / 2,
          y: y - 7,
          width: width,
          height: 13,
          rx: 2,
        }),
      );
      group.appendChild(text);
      svg.appendChild(group);
    }

    for (const node of graph.nodes) {
      const group = el('g', {
        class: 'node' + (node.xref === graph.focus ? ' focus' : ''),
        transform: 'translate(' + node.x + ',' + node.y + ')',
        tabindex: '0',
        role: 'button',
        'aria-label': node.kind + ': ' + node.label + ', ' + node.detail,
      });

      group.appendChild(el('rect', { width: NODE_WIDTH, height: NODE_HEIGHT }));
      group.appendChild(el('text', { class: 'label', x: 8, y: 17 }, truncate(node.label, 24)));

      // Dates rather than the record type. A tree full of people sharing a name
      // is unreadable without them, and "Individual" on every box says nothing
      // that the shape of the graph has not already said.
      group.appendChild(el('text', { class: 'tag', x: 8, y: 31 }, truncate(node.detail, 26)));

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

  const buttons = Array.from(document.querySelectorAll('#controls button'));
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const value = button.dataset.direction;
      for (const other of buttons) {
        other.setAttribute('aria-pressed', String(other === button));
      }
      vscode.postMessage({ type: 'direction', value: value });
    });
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'graph') {
      // The host is the authority on which direction is active, so the buttons
      // follow it rather than only their own clicks.
      for (const button of buttons) {
        button.setAttribute('aria-pressed', String(button.dataset.direction === message.direction));
      }
      render(message.graph);
    } else if (message.type === 'empty') {
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
    //
    // The arguments are for the code lens above each record, which needs to say
    // *which* record; invoked from the palette or the title bar there are none,
    // and the panel follows the cursor as before.
    commands.registerCommand('gedcom.showGraph', async (uri?: string, line?: number) => {
      if (uri !== undefined && line !== undefined) await revealLine(uri, line);
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
