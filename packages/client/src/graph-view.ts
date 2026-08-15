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
import { analysisOf, forget } from './analysis.ts';
import { revealLine } from './commands.ts';
import { DETAILS_VIEW_ID, GedcomDetailsViewProvider } from './details-view.ts';
import type { Log } from './log.ts';
import { contentSecurityPolicy } from './policy.ts';
import {
  describeFile,
  describeInvocation,
  describeNothingOnScreen,
  describeSubject,
} from './report.ts';
import { SelectionStore } from './selection.ts';

export const GRAPH_VIEW_ID = 'gedcom.graph';

/**
 * The GEDCOM file the panels are about.
 *
 * Not the same question as which editor is active: focus leaves the editor area
 * whenever a panel is clicked, and the reader may be taking notes in another
 * file beside the tree. What the panels follow is the GEDCOM file on screen —
 * the active editor while it is one, otherwise a visible one, and nothing at all
 * only when none is in view.
 */
function subjectEditor(): TextEditor | undefined {
  const active = window.activeTextEditor;
  if (active?.document.languageId === 'gedcom') return active;
  return window.visibleTextEditors.find((editor) => editor.document.languageId === 'gedcom');
}

/** Messages from the webview: a node was clicked, or a control was used. */
type PanelMessage =
  | { readonly type: 'reveal'; readonly line: number }
  | { readonly type: 'select'; readonly xref: string }
  | { readonly type: 'direction'; readonly value: Direction }
  | { readonly type: 'drew'; readonly focus: string | null; readonly nodes: number }
  | { readonly type: 'export'; readonly format: 'svg'; readonly data: string };

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
  private readonly log: Log;

  constructor(selection: SelectionStore, log: Log) {
    this.selection = selection;
    this.log = log;
  }

  /**
   * Whether the panel is on screen.
   *
   * Exposed for the integration tests, which otherwise can only assert that
   * `gedcom.showGraph` did not throw — and a command that opens nothing at all
   * throws nothing either. That was the gap issue #5 fell through.
   */
  get visible(): boolean {
    return this.view?.visible === true;
  }

  /**
   * The record the panel is currently centred on, and how many it drew around
   * it. Exposed for the same reason as `visible`: from outside, a webview is an
   * opaque rectangle, so without this a test cannot tell a panel that follows
   * the cursor from one that is merely open and stuck on the first record.
   */
  private lastDrawn: { focus: string | null; nodes: number } | undefined;
  get showing(): { focus: string | null; nodes: number } | undefined {
    return this.lastDrawn;
  }

  /**
   * What the webview acknowledged drawing. Exposed for tests: `showing` is what
   * was sent, which updates synchronously, while `drawn` is what arrived and
   * rendered on the far side of the message port.
   */
  private lastAcked: { focus: string | null; nodes: number } | undefined;
  get drawn(): { focus: string | null; nodes: number } | undefined {
    return this.lastAcked;
  }

  resolveWebviewView(
    view: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken,
  ): void {
    this.view = view;
    view.title = 'Tree';
    view.description = '';
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = shell();

    view.webview.onDidReceiveMessage((message: PanelMessage) => {
      if (message.type === 'reveal') void this.reveal(message.line);
      else if (message.type === 'select') {
        // Recentre on whoever was clicked, without touching the editor.
        this.selection.set({ uri: this.documentUri, xref: message.xref });
      } else if (message.type === 'direction') {
        this.direction = message.value;
        this.update(subjectEditor());
      } else if (message.type === 'drew') {
        this.lastAcked = { focus: message.focus, nodes: message.nodes };
      } else if (message.type === 'export') {
        void (async () => {
          const defaultUri = this.documentUri
            ? Uri.joinPath(this.documentUri, '..', 'family-tree.svg')
            : undefined;
          const saveUri = await window.showSaveDialog({
            defaultUri,
            filters: { 'SVG Image': ['svg'] },
          });
          if (saveUri) {
            await workspace.fs.writeFile(saveUri, new TextEncoder().encode(message.data));
            void window.showInformationMessage(`Exported tree to ${saveUri.fsPath}`);
          }
        })();
      }
    });

    view.onDidChangeVisibility(() => {
      this.log.debug(`Tree view ${view.visible ? 'shown' : 'hidden'}`);
      if (view.visible) this.update(subjectEditor());
    });

    // The panel is thrown away whenever it is hidden, and a panel that is not
    // there is showing nothing.
    view.onDidDispose(() => {
      if (this.view !== view) return;
      this.log.debug('Tree view disposed');
      this.view = undefined;
      this.lastDrawn = undefined;
      this.lastAcked = undefined;
    });

    this.update(subjectEditor());
  }

  /**
   * Says there is nothing to draw, and records it as what the panel holds.
   *
   * Recorded as well as sent: `showing` answers what is on screen, and an empty
   * panel is one of the answers.
   */
  private nothing(reason: 'no-document' | 'not-a-person' | 'failed'): void {
    this.lastDrawn = { focus: null, nodes: 0 };
    this.log.debug(`Tree drew nothing (${reason})`);
    void this.view?.webview.postMessage({ type: 'empty', reason });
  }

  /**
   * Recomputes and pushes the graph for whatever is currently selected.
   *
   * Reading a file cannot be allowed to take the panel down with it. This runs
   * from event handlers, where a throw is swallowed by the editor: the panel
   * keeps whatever it last drew, says nothing, and there is nothing in the log
   * to say why. Every failure is caught, named and shown in the panel itself.
   */
  update(editor: TextEditor | undefined): void {
    try {
      this.draw(editor);
    } catch (failure) {
      this.log.error(`Could not draw the tree: ${String(failure)}`);
      this.nothing('failed');
    }
  }

  private draw(editor: TextEditor | undefined): void {
    if (!this.view?.visible) return;

    // The document rather than the editor wherever possible: reading text needs
    // no editor, and maximising the panel takes the editor area off screen.
    const chosen = this.selection.current;
    const document =
      editor?.document ??
      (chosen.uri
        ? workspace.textDocuments.find(
            (candidate) => candidate.uri.toString() === chosen.uri?.toString(),
          )
        : undefined);

    if (!document || document.languageId !== 'gedcom') {
      this.documentUri = undefined;
      this.nothing('no-document');
      return;
    }

    this.documentUri = document.uri;

    const analysis = analysisOf(document);
    const isDrawable = (xref: string | null): boolean => {
      const tag = xref === null ? undefined : analysis.xrefs.definitions.get(xref)?.tag;
      return tag === 'INDI' || tag === 'FAM';
    };
    // A selection made in the panel wins over the cursor until the cursor moves,
    // which is what lets a reader walk the tree without losing their place. With
    // no editor on screen there is no cursor either, and the selection is all
    // there is to go on.
    const focus =
      chosen.uri?.toString() === document.uri.toString() && chosen.xref !== null
        ? chosen.xref
        : editor
          ? recordAt(analysis, editor.selection.active.line)
          : null;

    // A submitter, a source or a note has no place in a family tree. Drawn, it
    // is a lone box with no generation and no relationships; the details panel
    // is where that record has something to say.
    if (focus !== null && !isDrawable(focus)) {
      this.nothing('not-a-person');
      return;
    }

    const configuration = workspace.getConfiguration('gedcom');
    const graph = neighbourhood(analysis, focus, {
      depth: configuration.get<number>('graph.depth', 2),
      includeReferences: configuration.get<boolean>('graph.includeReferences', false),
      direction: this.direction,
    });

    this.lastDrawn = { focus: graph.focus, nodes: graph.nodes.length };
    this.log.debug(
      `Tree drew @${graph.focus ?? 'nobody'}@ with ${graph.nodes.length} nodes ` +
        `(depth ${configuration.get<number>('graph.depth', 2)}, ${this.direction})`,
    );

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
<div id="controls" role="group" aria-label="Tree controls">
  <button type="button" data-direction="both" aria-pressed="true">Both</button>
  <button type="button" data-direction="ancestors" aria-pressed="false">Ancestors</button>
  <button type="button" data-direction="descendants" aria-pressed="false">Descendants</button>
  <span style="flex: 1"></span>
  <button type="button" id="btn-fit" title="Zoom to fit all nodes">Fit</button>
  <button type="button" id="btn-reset" title="Reset zoom to 100%">100%</button>
  <button type="button" id="btn-export-svg" title="Export current tree as SVG">Export SVG</button>
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
  let currentGraph = null;

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
    currentGraph = graph;
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

  const dirButtons = Array.from(document.querySelectorAll('#controls button[data-direction]'));
  for (const button of dirButtons) {
    button.addEventListener('click', () => {
      const value = button.dataset.direction;
      for (const other of dirButtons) {
        other.setAttribute('aria-pressed', String(other === button));
      }
      vscode.postMessage({ type: 'direction', value: value });
    });
  }

  document.getElementById('btn-fit')?.addEventListener('click', () => {
    if (!currentGraph || !currentGraph.nodes.length) return;
    const minX = Math.min(...currentGraph.nodes.map((n) => n.x));
    const maxX = Math.max(...currentGraph.nodes.map((n) => n.x + NODE_WIDTH));
    const minY = Math.min(...currentGraph.nodes.map((n) => n.y));
    const maxY = Math.max(...currentGraph.nodes.map((n) => n.y + NODE_HEIGHT));
    const pad = 24;
    const boxW = Math.max(100, maxX - minX + pad * 2);
    const boxH = Math.max(100, maxY - minY + pad * 2);
    svg.setAttribute('viewBox', (minX - pad) + ' ' + (minY - pad) + ' ' + boxW + ' ' + boxH);
    svg.style.width = '100%';
    svg.style.height = '100%';
  });

  document.getElementById('btn-reset')?.addEventListener('click', () => {
    if (!currentGraph) return;
    svg.style.width = '';
    svg.style.height = '';
    svg.setAttribute('width', currentGraph.width);
    svg.setAttribute('height', currentGraph.height);
    svg.setAttribute('viewBox', '0 0 ' + currentGraph.width + ' ' + currentGraph.height);
    centreOnFocus(currentGraph);
  });

  document.getElementById('btn-export-svg')?.addEventListener('click', () => {
    if (!currentGraph || !svg) return;
    const clone = svg.cloneNode(true);
    const styleEl = document.querySelector('style');
    if (styleEl) {
      const defs = document.createElementNS(NS, 'defs');
      const inlineStyle = document.createElementNS(NS, 'style');
      inlineStyle.textContent = styleEl.textContent || '';
      defs.appendChild(inlineStyle);
      clone.insertBefore(defs, clone.firstChild);
    }
    const serializer = new XMLSerializer();
    const svgString = '<?xml version="1.0" encoding="UTF-8"?>\\n' + serializer.serializeToString(clone);
    vscode.postMessage({ type: 'export', format: 'svg', data: svgString });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'graph') {
      // The host is the authority on which direction is active, so the buttons
      // follow it rather than only their own clicks.
      for (const button of dirButtons) {
        button.setAttribute('aria-pressed', String(button.dataset.direction === message.direction));
      }
      render(message.graph);
      vscode.postMessage({
        type: 'drew',
        focus: message.graph.focus,
        nodes: message.graph.nodes.length,
      });
    } else if (message.type === 'empty') {
      empty.textContent =
        message.reason === 'not-a-person'
          ? 'This record is not a person or a family. Its contents are in the Details panel below.'
          : message.reason === 'failed'
            ? 'This file could not be read as a family tree. Run “GEDCOM: Show Log” for what went wrong.'
            : 'Open a GEDCOM file and place the cursor in a record.';
      empty.style.display = 'block';
      scroll.style.display = 'none';
      vscode.postMessage({ type: 'drew', focus: null, nodes: 0 });
    }
  });
}());
</script>
</body>
</html>`;
}

/**
 * Waits for the panel to come up, which a webview does a tick or two after it is
 * focused rather than by the time the command resolves.
 */
async function appears(provider: GedcomGraphViewProvider): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (provider.visible) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/**
 * Opens the tree panel, and makes sure it is on screen.
 *
 * `<viewId>.focus` is the documented way in and is enough while the view is
 * where it belongs. It is silent about a view the reader has hidden, or moved to
 * a container that is itself hidden — both a right-click away in the panel — and
 * a silent command reads as a broken button. So the view is waited for, and put
 * back where it belongs if it does not appear.
 */
async function reveal(
  provider: GedcomGraphViewProvider,
  editor: TextEditor | undefined,
  log: Log,
): Promise<boolean> {
  // Decided before focusing anything, and from `subjectEditor`: focus moves in
  // the course of opening the panel, and the active editor moves with it.
  if (editor?.document.languageId !== 'gedcom') {
    log.warn(
      describeNothingOnScreen({
        visible: window.visibleTextEditors.length,
        documents: workspace.textDocuments.filter((d) => d.languageId === 'gedcom').length,
      }),
    );
    void window.showInformationMessage('Open a GEDCOM file to see its tree.');
    return false;
  }

  log.info(
    describeSubject({
      file: describeFile(editor.document.uri.path, editor.document.uri.scheme),
      active: editor === window.activeTextEditor,
    }),
  );

  await commands.executeCommand(`${GRAPH_VIEW_ID}.focus`);
  if (await appears(provider)) {
    log.info('Tree panel on screen');
    return true;
  }

  // Not a toggle, so it cannot shut the panel it was called to open.
  log.warn(`${GRAPH_VIEW_ID}.focus left nothing on screen; resetting the view location`);
  await commands.executeCommand(`${GRAPH_VIEW_ID}.resetViewLocation`);
  await commands.executeCommand(`${GRAPH_VIEW_ID}.focus`);
  if (await appears(provider)) {
    log.info('Tree panel on screen after resetting its location');
    return true;
  }

  log.error('Tree panel could not be shown: the view is hidden, or its container is not shown');
  void window.showWarningMessage(
    'The GEDCOM Tree could not be shown. Enable it from the panel’s context menu, ' +
      'or run “View: Reset View Locations”.',
  );
  return false;
}

/**
 * What `activate` returns, for the integration tests to look at.
 *
 * Not an API for other extensions; nothing here is documented or supported. It
 * exists because a panel that fails to open is invisible to a test that can only
 * call a command and see whether it threw.
 */
export interface GedcomTestHooks {
  readonly graphVisible: () => boolean;
  readonly graphShowing: () => { focus: string | null; nodes: number } | undefined;
  readonly graphDrawn: () => { focus: string | null; nodes: number } | undefined;
  readonly detailsShowing: () => string | undefined;
}

/** Wires both panels to the editor, in whichever host is running. */
export function registerGraphView(context: ExtensionContext, log: Log): GedcomTestHooks {
  const selection = new SelectionStore();
  const provider = new GedcomGraphViewProvider(selection, log);
  const details = new GedcomDetailsViewProvider(selection);

  /**
   * Whether any GEDCOM file is open, as a context key the views are gated on.
   *
   * They used to be gated on `editorLangId == gedcom`, which is bound to the
   * *active editor*. Restore a window with focus in the Search or SCM view and
   * there is no active editor at that moment, so the clause is false, the views
   * are not contributed, and the GEDCOM panel never appears — for a reader with
   * a `.ged` file open right there. It came back only if they happened to click
   * into the editor.
   *
   * A key of our own answers the question actually being asked — is there a
   * GEDCOM file open — and does not depend on where focus happens to be.
   */
  let announced: boolean | undefined;
  const announce = (): void => {
    const documents = workspace.textDocuments.filter(
      (document) => document.languageId === 'gedcom',
    ).length;
    const open = documents > 0;

    if (open !== announced) {
      announced = open;
      log.info(
        `gedcom.open=${open} (${documents} GEDCOM ${documents === 1 ? 'document' : 'documents'} open)`,
      );
    }

    void commands.executeCommand('setContext', 'gedcom.open', open);
  };

  /** The cursor moving is a selection too, and it overrides a panel click. */
  const followCursor = (editor: TextEditor | undefined): void => {
    // Anything but a GEDCOM file — including no editor at all, which is what
    // arrives when focus leaves the editor area — leaves the panels on the file
    // the reader can still see.
    const subject = editor?.document.languageId === 'gedcom' ? editor : subjectEditor();

    if (!subject) {
      // Nothing on screen is not the same as nothing open: maximising a panel
      // takes the whole editor area away, and the reader is looking at the very
      // record the panels would be clearing. They hold it until its file closes.
      const held = selection.current.uri;
      const open =
        held !== undefined &&
        workspace.textDocuments.some((document) => document.uri.toString() === held.toString());
      if (!open) selection.set({ uri: undefined, xref: null });
    } else if (subject === editor) {
      // The cursor moved in the file the panels are about; where it landed is
      // the new selection. Focus moving elsewhere is not a new selection.
      const analysis = analysisOf(subject.document);
      selection.set({
        uri: subject.document.uri,
        xref: recordAt(analysis, subject.selection.active.line),
      });
    }

    provider.update(subject);
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
    commands.registerCommand('gedcom.showGraph', async (target?: unknown, at?: unknown) => {
      // A menu never invokes a command bare. The editor title bar builds its
      // actions with the editor's resource as `arg` and forwards its own context
      // after it, so this handler is called as `(Uri, {groupId, editorIndex})`
      // — while the code lens calls it as `(uriString, lineNumber)`.
      //
      // Read as the latter, the menu's context was passed where a line number
      // belonged: the editor got revealed at a nonsense position and the panel
      // never opened. Only the lens's own shape counts as a request to reveal.
      log.info(`Show Tree invoked from ${describeInvocation(target, at)}`);

      if (typeof target === 'string' && typeof at === 'number') {
        // Never at the cost of the panel: revealing is what the lens asks for on
        // top of opening the graph, and a failure there must not swallow the
        // thing the command is named after.
        try {
          await revealLine(target, at);
        } catch (failure) {
          // The record stays where it is; the graph still opens below.
          log.error(`Could not reveal line ${at}: ${String(failure)}`);
        }
      }

      // Captured before anything below moves focus.
      const editor = subjectEditor();

      // Nothing to open means nothing to redraw: a command that declines to act
      // leaves the panel as it found it.
      if (!(await reveal(provider, editor, log))) return;
      provider.update(editor);
    }),
    window.registerWebviewViewProvider(GRAPH_VIEW_ID, provider, {
      // The panel is cheap to rebuild from the document, so there is no state
      // worth the memory cost of keeping it alive while hidden.
      webviewOptions: { retainContextWhenHidden: false },
    }),
    window.onDidChangeActiveTextEditor(followCursor),
    // Only a cursor in a GEDCOM file is news. Following every editor's cursor
    // would re-read and lay out the whole tree on each keystroke in whatever
    // else is open, to draw what is already on screen.
    window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor.document.languageId !== 'gedcom') return;
      followCursor(event.textEditor);
    }),
    workspace.onDidChangeTextDocument((event) => {
      const editor = subjectEditor();
      if (editor && event.document === editor.document) {
        provider.update(editor);
        details.refresh();
      }
    }),
    // Depth and whether citations are drawn change the shape of the tree, so
    // the drawing is redone when either does.
    workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('gedcom.graph')) return;
      provider.update(subjectEditor());
    }),
  );

  context.subscriptions.push(
    workspace.onDidOpenTextDocument(announce),
    workspace.onDidCloseTextDocument((document) => {
      announce();
      forget(document.uri);
      // The panels hold a record while its file is open; this is where that
      // ends. Told which document closed rather than asking which are left,
      // because a document is on its way out while this fires.
      if (selection.current.uri?.toString() === document.uri.toString()) {
        selection.set({ uri: undefined, xref: null });
      }
      followCursor(subjectEditor());
    }),
  );

  announce();
  followCursor(subjectEditor());

  return {
    graphVisible: () => provider.visible,
    graphShowing: () => provider.showing,
    graphDrawn: () => provider.drawn,
    detailsShowing: () => details.showing,
  };
}
