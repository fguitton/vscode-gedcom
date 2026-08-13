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
import { DETAILS_VIEW_ID, GedcomDetailsViewProvider } from './details-view.ts';
import { contentSecurityPolicy } from './policy.ts';
import { SelectionStore } from './selection.ts';

export const GRAPH_VIEW_ID = 'gedcom.graph';

/** Messages from the webview: a node was clicked, or a control was used. */
type PanelMessage =
  | { readonly type: 'reveal'; readonly line: number }
  | { readonly type: 'select'; readonly xref: string }
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
  private readonly selection: SelectionStore;

  constructor(selection: SelectionStore) {
    this.selection = selection;
  }

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
      else if (message.type === 'select') {
        // Recentre on whoever was clicked, without touching the editor.
        this.selection.set({ uri: this.documentUri, xref: message.xref });
      } else if (message.type === 'direction') {
        this.direction = message.value;
        this.update(window.activeTextEditor);
      }
    });

    view.onDidChangeVisibility(() => {
      if (view.visible) this.update(window.activeTextEditor);
    });

    this.update(window.activeTextEditor);
  }

  /** Recomputes and pushes the graph for whatever is currently selected. */
  update(editor: TextEditor | undefined): void {
    if (!this.view?.visible) return;

    if (!editor || editor.document.languageId !== 'gedcom') {
      this.documentUri = undefined;
      void this.view.webview.postMessage({ type: 'empty', reason: 'no-document' });
      return;
    }

    this.documentUri = editor.document.uri;

    const analysis = analyzeText(editor.document.getText());
    const chosen = this.selection.current;
    const isDrawable = (xref: string | null): boolean => {
      const tag = xref === null ? undefined : analysis.xrefs.definitions.get(xref)?.tag;
      return tag === 'INDI' || tag === 'FAM';
    };
    // A selection made in the panel wins over the cursor until the cursor moves,
    // which is what lets a reader walk the tree without losing their place.
    const focus =
      chosen.uri?.toString() === editor.document.uri.toString() && chosen.xref !== null
        ? chosen.xref
        : recordAt(analysis, editor.selection.active.line);

    // A submitter, a source or a note has no place in a family tree. Drawn, it
    // is a lone box with no generation and no relationships; the details panel
    // is where that record has something to say.
    if (focus !== null && !isDrawable(focus)) {
      void this.view.webview.postMessage({ type: 'empty', reason: 'not-a-person' });
      return;
    }

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
      content="${contentSecurityPolicy({ nonce: id })}">
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
  .node > rect:first-of-type:hover, .node:hover > rect:first-of-type { stroke: var(--vscode-focusBorder); }
  .node:focus-visible > rect:first-of-type { stroke: var(--vscode-focusBorder); stroke-width: 2; }
  /* Revealed on hover or focus: an arrow on every box at rest would be a column
     of chrome competing with the names. */
  .goto rect { fill: transparent; stroke: none; opacity: 0; }
  .goto .arrow { stroke: var(--vscode-descriptionForeground); stroke-width: 1.2; opacity: 0; }
  .node:hover .goto rect, .node:focus-within .goto rect { opacity: .6; fill: var(--vscode-toolbar-hoverBackground); }
  .node:hover .goto .arrow, .node:focus-within .goto .arrow { opacity: 1; }
  .goto:hover .arrow { stroke: var(--vscode-foreground); }
  .goto:focus-visible rect { opacity: 1; stroke: var(--vscode-focusBorder); }
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

  // Must match packages/core/src/graph.ts, which does the positioning.
  const NODE_WIDTH = 170;
  const NODE_HEIGHT = 40;
  const ROW_HEIGHT = 64;
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

  /**
   * Brings the selected people into view.
   *
   * A neighbourhood two hops wide is routinely taller and broader than the
   * panel, and the selection lands wherever the layout puts it — which, having
   * scrolled somewhere else, is usually off screen. Scrolling is confined to
   * each axis that actually overflows: nudging an axis that fits would only
   * shift a drawing already wholly visible.
   */
  function centreOnFocus(graph) {
    const focused = graph.nodes.filter((node) => (graph.focused || []).indexOf(node.xref) >= 0);
    if (!focused.length) return;

    const left = Math.min(...focused.map((node) => node.x));
    const right = Math.max(...focused.map((node) => node.x + NODE_WIDTH));
    const top = Math.min(...focused.map((node) => node.y));
    const bottom = Math.max(...focused.map((node) => node.y + NODE_HEIGHT));

    if (scroll.scrollWidth > scroll.clientWidth) {
      scroll.scrollLeft = (left + right) / 2 - scroll.clientWidth / 2;
    }
    if (scroll.scrollHeight > scroll.clientHeight) {
      scroll.scrollTop = (top + bottom) / 2 - scroll.clientHeight / 2;
    }
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

    const width = graph.width;
    svg.setAttribute('width', width);
    svg.setAttribute('height', graph.height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + graph.height);

    const byXref = new Map(graph.nodes.map((n) => [n.xref, n]));

    // Edges first so nodes draw over them.
    const labelled = [];

    /**
     * Couples, and the point their children descend from.
     *
     * A couple share a generation and therefore a column, so their edge is a
     * marriage bar down the side rather than a curve across a gutter — which is
     * how a pedigree chart has always drawn one. Every child then descends from
     * the middle of that bar instead of from each parent separately, halving the
     * lines and removing the crossings that two parents fanning independently to
     * four children make unavoidable.
     */
    // Keyed by the family, never by the person: somebody may marry twice, and
    // their children then belong to one marriage or the other. Keyed by person,
    // the second marriage overwrote the first and every child was drawn from
    // whichever union happened to be recorded last.
    const unions = new Map();

    for (const edge of graph.edges) {
      if (edge.kind !== 'spouse') continue;
      const a = byXref.get(edge.from);
      const b = byXref.get(edge.to);
      if (!a || !b || a.x !== b.x) continue;

      const top = a.y <= b.y ? a : b;
      const bottom = a.y <= b.y ? b : a;

      // Children leave from the parent whose line is being traced, not from the
      // midpoint between the couple. The midpoint is nobody: it floats in the
      // gap between two boxes, and the reader following a descent cannot tell
      // which of the two it belongs to. The nearer of the pair to the focus is
      // the one on the path, and ties go to the upper box so it is stable.
      const anchor = a.distance === b.distance ? top : a.distance < b.distance ? a : b;
      if (edge.union) {
        unions.set(edge.union, { x: anchor.x + NODE_WIDTH, y: anchor.y + NODE_HEIGHT / 2 });
      }

      // A marriage bar joins two boxes that sit next to each other. A second
      // marriage puts the other spouse further down the column, and a straight
      // bar to them would be drawn straight through whoever is in between —
      // taking its label with it. That one is routed round the outside.
      const adjacent = bottom.y - top.y <= ROW_HEIGHT;

      if (adjacent) {
        const x = top.x + NODE_WIDTH / 2;
        svg.appendChild(
          el('path', {
            class: 'edge',
            d: 'M ' + x + ' ' + (top.y + NODE_HEIGHT) + ' L ' + x + ' ' + bottom.y,
            fill: 'none',
          }),
        );
        labelled.push({ text: edge.label, x: x, y: (top.y + NODE_HEIGHT + bottom.y) / 2 });
      } else {
        const x = top.x;
        const bulge = x - 16;
        const y1 = top.y + NODE_HEIGHT / 2;
        const y2 = bottom.y + NODE_HEIGHT / 2;
        svg.appendChild(
          el('path', {
            class: 'edge',
            d:
              'M ' + x + ' ' + y1 +
              ' C ' + bulge + ' ' + y1 + ', ' + bulge + ' ' + y2 + ', ' + x + ' ' + y2,
            fill: 'none',
          }),
        );
        labelled.push({ text: edge.label, x: bulge, y: (y1 + y2) / 2 });
      }
    }

    /** Child edges already drawn from a union point, so the partner's is skipped. */
    const drawnFromUnion = new Set();

    for (const edge of graph.edges) {
      if (edge.kind === 'spouse') continue;

      const a = byXref.get(edge.from);
      const b = byXref.get(edge.to);
      if (!a || !b) continue;

      // Siblings and citations cross no generation, so they can land in the same
      // column too. Drawn as a left-to-right curve such an edge doubles back on
      // itself and its label falls behind a box; it is routed down the side of
      // the column instead, the way a marriage bar is.
      if (a.x === b.x) {
        const top = a.y <= b.y ? a : b;
        const bottom = a.y <= b.y ? b : a;
        const x = top.x;
        const bulge = x - 14;
        const y1 = top.y + NODE_HEIGHT / 2;
        const y2 = bottom.y + NODE_HEIGHT / 2;

        svg.appendChild(
          el('path', {
            class: 'edge',
            d:
              'M ' + x + ' ' + y1 +
              ' C ' + bulge + ' ' + y1 + ', ' + bulge + ' ' + y2 + ', ' + x + ' ' + y2,
            fill: 'none',
          }),
        );

        labelled.push({ text: edge.label, x: bulge, y: (y1 + y2) / 2 });
        continue;
      }

      // Always draw left to right, whichever way the pointer happens to be
      // written. A relationship recorded from the far end would otherwise loop
      // backwards across the columns for no reason the reader can see.
      const from = a.x <= b.x ? a : b;
      const to = a.x <= b.x ? b : a;

      let x1 = from.x + NODE_WIDTH;
      let y1 = from.y + NODE_HEIGHT / 2;
      let label = from.xref === edge.from ? edge.label : edge.reverseLabel;

      // Routed from the marriage this child belongs to, which is why the family
      // travels on the edge. Both parents produce the same edge, so the second
      // is skipped rather than drawn on top of the first.
      const union = edge.kind === 'parent' && edge.union ? unions.get(edge.union) : undefined;
      if (union) {
        const key = edge.union + ' ' + to.xref;
        if (drawnFromUnion.has(key)) continue;
        drawnFromUnion.add(key);

        x1 = union.x;
        y1 = union.y;
        // The bar above already says this is a marriage, and the column to the
        // right is the next generation. A row of identical "Child" labels only
        // crowds the drawing.
        label = '';
      }

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

      if (label) labelled.push({ text: label, x: mid, y: (y1 + y2) / 2 });
    }

    for (const node of graph.nodes) {
      const group = el('g', {
        // A family has no box of its own, so putting the cursor in one
        // highlights everybody it is about instead.
        class: 'node' + ((graph.focused || []).indexOf(node.xref) >= 0 ? ' focus' : ''),
        transform: 'translate(' + node.x + ',' + node.y + ')',
        tabindex: '0',
        role: 'button',
        'aria-label': node.kind + ': ' + node.label + (node.detail ? ', ' + node.detail : ''),
      });

      group.appendChild(el('rect', { width: NODE_WIDTH, height: NODE_HEIGHT }));

      // Dates rather than the record type. A tree full of people sharing a name
      // is unreadable without them. Where the file records none, the name is
      // centred on the box rather than propped above an empty line.
      if (node.detail) {
        group.appendChild(el('text', { class: 'label', x: 8, y: 17 }, truncate(node.label, 24)));
        group.appendChild(el('text', { class: 'tag', x: 8, y: 31 }, truncate(node.detail, 26)));
      } else {
        group.appendChild(el('text', { class: 'label', x: 8, y: 24 }, truncate(node.label, 24)));
      }

      // Clicking selects: it recentres the graph and fills the details panel,
      // and leaves the editor where it is. Reading down a line of descent means
      // looking at a dozen people in a row, and jumping the editor to each in
      // turn loses the reader's place in the file for nothing.
      const select = () => vscode.postMessage({ type: 'select', xref: node.xref });
      group.addEventListener('click', select);
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      });

      // Navigation is its own gesture, on its own button.
      const goTo = el('g', {
        class: 'goto',
        transform: 'translate(' + (NODE_WIDTH - 20) + ',6)',
        tabindex: '0',
        role: 'button',
        'aria-label': 'Go to @' + node.xref + '@ in the editor',
      });
      goTo.appendChild(el('rect', { width: 14, height: 14, rx: 2 }));
      goTo.appendChild(
        el('path', {
          class: 'arrow',
          d: 'M 4.5 9.5 L 9.5 4.5 M 5.5 4.5 L 9.5 4.5 L 9.5 8.5',
          fill: 'none',
        }),
      );

      const reveal = (event) => {
        event.stopPropagation();
        vscode.postMessage({ type: 'reveal', line: node.line });
      };
      goTo.addEventListener('click', reveal);
      goTo.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          reveal(event);
        }
      });
      group.appendChild(goTo);

      const elided = (graph.elided || []).find((entry) => entry[0] === node.xref);
      if (elided) {
        group.appendChild(
          el('text', { class: 'elided', x: NODE_WIDTH - 8, y: 31, 'text-anchor': 'end' }, '+' + elided[1]),
        );
      }

      svg.appendChild(group);
    }

    centreOnFocus(graph);

    // Labels last of all.
    //
    // Drawn before the boxes they were painted over by them, which is how a
    // marriage year came to be half hidden behind the spouse below it. A label
    // is the smallest thing on the drawing and the first thing to become
    // useless when partly covered, so it goes on top of everything.
    const occupied = [];
    for (const label of labelled) {
      let y = label.y;
      // Only a label close in *both* directions is in the way; comparing y alone
      // pushed labels apart that were nowhere near each other horizontally.
      const collides = (candidate) =>
        occupied.some(
          (taken) =>
            Math.abs(taken.y - candidate) < LABEL_HEIGHT && Math.abs(taken.x - label.x) < 90,
        );
      while (collides(y)) y += LABEL_HEIGHT;
      occupied.push({ x: label.x, y: y });

      const group = el('g', { class: 'edge-label' });

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
      group.appendChild(el('text', { x: label.x, y: y + 3, 'text-anchor': 'middle' }, label.text));
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
      empty.textContent =
        message.reason === 'not-a-person'
          ? 'This record is not a person or a family. Its contents are in the Details panel below.'
          : 'Open a GEDCOM file and place the cursor in a record.';
      empty.style.display = 'block';
      scroll.style.display = 'none';
    }
  });
}());
</script>
</body>
</html>`;
}

/** Wires both panels to the editor, in whichever host is running. */
export function registerGraphView(context: ExtensionContext): void {
  const selection = new SelectionStore();
  const provider = new GedcomGraphViewProvider(selection);
  const details = new GedcomDetailsViewProvider(selection);

  /** The cursor moving is a selection too, and it overrides a panel click. */
  const followCursor = (editor: TextEditor | undefined): void => {
    if (!editor || editor.document.languageId !== 'gedcom') {
      selection.set({ uri: undefined, xref: null });
    } else {
      const analysis = analyzeText(editor.document.getText());
      selection.set({
        uri: editor.document.uri,
        xref: recordAt(analysis, editor.selection.active.line),
      });
    }
    provider.update(editor);
    details.refresh();
  };

  context.subscriptions.push(
    selection,
    selection.onDidChange(() => {
      provider.update(window.activeTextEditor);
      details.refresh();
    }),
    window.registerWebviewViewProvider(DETAILS_VIEW_ID, details, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
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
    window.onDidChangeActiveTextEditor(followCursor),
    window.onDidChangeTextEditorSelection((event) => followCursor(event.textEditor)),
    workspace.onDidChangeTextDocument((event) => {
      const editor = window.activeTextEditor;
      if (editor && event.document === editor.document) {
        provider.update(editor);
        details.refresh();
      }
    }),
  );

  followCursor(window.activeTextEditor);
}
