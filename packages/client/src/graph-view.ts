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

import {
  buildFanChart,
  neighbourhood,
  recordAt,
  type Direction,
  type Graph,
} from '@vscode-gedcom/core';
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
import { SelectionStore, subjectEditor } from './selection.ts';

export const GRAPH_VIEW_ID = 'gedcom.graph';

export type TreeViewMode = Direction | 'fan';

/** Messages from the webview: a node was clicked, or a control was used. */
type PanelMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'reveal'; readonly line: number }
  | { readonly type: 'select'; readonly xref: string }
  | { readonly type: 'direction'; readonly value: TreeViewMode }
  | { readonly type: 'drew'; readonly focus: string | null; readonly nodes: number }
  | {
      readonly type: 'export';
      readonly format: 'svg';
      readonly data: string;
      readonly filename?: string;
    };

export class GedcomGraphViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  /** The document the panel is currently showing, so clicks reveal in the right one. */
  private documentUri: Uri | undefined;
  /**
   * Which way through the generations to travel, or circular fan chart mode.
   */
  private direction: TreeViewMode = 'both';
  private activePath: string[] | undefined;
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
      if (message.type === 'ready') {
        this.update(subjectEditor());
      } else if (message.type === 'reveal') void this.reveal(message.line);
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
          const filename = message.filename || 'family-tree.svg';
          const defaultUri = this.documentUri
            ? Uri.joinPath(this.documentUri, '..', filename)
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
        : undefined) ??
      subjectEditor()?.document;

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

    if (this.direction === 'fan') {
      const fanChart = buildFanChart(analysis, focus ?? '', 5);
      this.lastDrawn = { focus: fanChart.rootXref, nodes: fanChart.nodes.length };
      this.log.debug(
        `Fan chart drew @${fanChart.rootXref || 'nobody'}@ with ${fanChart.nodes.length} ancestors`,
      );
      void this.view.webview.postMessage({
        type: 'fanchart',
        fanChart,
        direction: 'fan',
      });
      return;
    }

    const configuration = workspace.getConfiguration('gedcom');
    const graph = neighbourhood(analysis, focus, {
      depth: configuration.get<number>('graph.depth', 2),
      includeReferences: configuration.get<boolean>('graph.includeReferences', false),
      direction: this.direction,
      path: this.activePath,
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

    if (this.activePath) {
      void this.view.webview.postMessage({
        type: 'highlightPath',
        path: this.activePath,
      });
    }
  }

  public highlightPath(path: string[], focusXref?: string): void {
    this.activePath = path;
    if (this.direction === 'fan') {
      this.direction = 'both';
    }
    if (focusXref) {
      this.selection.set({ uri: this.documentUri, xref: focusXref });
    }
    this.update(subjectEditor());
    if (this.view) {
      void this.view.webview.postMessage({
        type: 'highlightPath',
        path,
      });
    }
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
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  #empty {
    padding: 1rem .75rem;
    color: var(--vscode-descriptionForeground);
    font-size: calc(var(--vscode-font-size) * .95);
    line-height: 1.4;
  }
  #controls {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: .35rem;
    padding: .25rem .5rem;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  #direction-select {
    font-family: inherit;
    font-size: calc(var(--vscode-font-size) * .85);
    color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
    background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border, #454545));
    border-radius: 3px;
    padding: .2rem .4rem;
    cursor: pointer;
    outline: none;
  }
  #direction-select:focus {
    border-color: var(--vscode-focusBorder);
  }
  .btn-group {
    display: flex;
    align-items: center;
    gap: .2rem;
  }
  #controls button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: .3rem;
    font-family: inherit;
    font-size: calc(var(--vscode-font-size) * .85);
    color: var(--vscode-foreground);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: .2rem .35rem;
    cursor: pointer;
    line-height: 1;
  }
  #controls button svg {
    display: block;
    width: 14px;
    height: 14px;
    fill: currentColor;
  }
  #controls button:hover { background: var(--vscode-toolbar-hoverBackground); }
  #controls button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  #controls button:active { background: var(--vscode-toolbar-activeBackground, var(--vscode-toolbar-hoverBackground)); }
  /* The controls take a fixed strip; the drawing gets the rest. */
  #scroll {
    flex: 1;
    overflow: auto;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
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
  .node.path-highlight rect {
    stroke: #e5a00d !important;
    stroke-width: 2.5px !important;
    filter: drop-shadow(0 0 6px rgba(229, 160, 13, 0.45));
  }
  .node.path-highlight text.label { font-weight: bold; }
  .edge.path-highlight {
    stroke: #e5a00d !important;
    stroke-width: 2.5px !important;
    opacity: 1 !important;
    filter: drop-shadow(0 0 4px rgba(229, 160, 13, 0.5));
  }
  .node.dimmed { opacity: 0.25; transition: opacity 0.2s ease; }
  .edge.dimmed { opacity: 0.12; transition: opacity 0.2s ease; }

  /* Fan Chart */
  .fan-node { cursor: pointer; }
  .fan-wedge {
    stroke: var(--vscode-editorWidget-border, var(--vscode-focusBorder));
    stroke-width: 1;
    transition: fill 0.15s ease, stroke 0.15s ease;
  }
  .fan-wedge.root {
    fill: var(--vscode-list-activeSelectionBackground, #007acc);
  }
  .fan-wedge.paternal {
    fill: var(--vscode-editorWidget-background);
  }
  .fan-wedge.maternal {
    fill: var(--vscode-editorWidget-background);
  }
  .fan-wedge.empty {
    fill: transparent;
    stroke-dasharray: 2 3;
    opacity: 0.35;
    cursor: default;
  }
  .fan-node:hover:not(.empty) .fan-wedge {
    stroke: var(--vscode-focusBorder);
    stroke-width: 2;
    filter: brightness(1.15);
  }
  .fan-node.dimmed { opacity: 0.22; transition: opacity 0.2s ease; }
  .fan-node.path-highlight .fan-wedge {
    stroke: #e5a00d !important;
    stroke-width: 2.5px !important;
    fill: rgba(229, 160, 13, 0.35) !important;
    filter: drop-shadow(0 0 8px rgba(229, 160, 13, 0.6));
  }
  .fan-node.path-highlight .fan-label {
    fill: #ffd54f !important;
    font-weight: bold;
  }
  .fan-label {
    fill: var(--vscode-foreground);
    font-size: 10px;
    font-weight: 500;
    pointer-events: none;
    text-anchor: middle;
    dominant-baseline: central;
  }
  .fan-label.root {
    fill: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
    font-weight: bold;
    font-size: 11px;
  }
  .fan-detail {
    fill: var(--vscode-descriptionForeground);
    font-size: 8px;
    pointer-events: none;
    text-anchor: middle;
    dominant-baseline: central;
  }
</style>
</head>
<body>
<div id="controls" role="toolbar" aria-label="Tree controls">
  <select id="direction-select" title="Direction of branch traversal / View mode">
    <option value="both">Both</option>
    <option value="ancestors">Ancestors</option>
    <option value="descendants">Descendants</option>
    <option value="fan">Circular Fan</option>
  </select>
  <span style="flex: 1"></span>
  <div class="btn-group">
    <button type="button" id="btn-fit" title="Zoom to Fit (Fit all nodes in view)" aria-label="Zoom to Fit">
      <svg viewBox="0 0 16 16"><path d="M3 3h3v1.5H4.5V6H3V3zm7 0h3v3h-1.5V4.5H10V3zm3 7v3h-3v-1.5h1.5V10H13zm-7 3H3v-3h1.5v1.5H6V13z"/></svg>
    </button>
    <button type="button" id="btn-reset" title="Reset View (100% Zoom & Recenter)" aria-label="Reset View">
      <svg viewBox="0 0 16 16"><path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 1.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>
    </button>
    <button type="button" id="btn-export-svg" title="Export Tree as SVG" aria-label="Export Tree as SVG">
      <svg viewBox="0 0 16 16"><path d="M8.5 1.5v7.293l2.146-2.147.708.708L8 10.707 4.646 7.354l.708-.708L7.5 8.793V1.5h1zM2 12.5h12v1.5H2v-1.5z"/></svg>
      <span>SVG</span>
    </button>
  </div>
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
  let currentFanChart = null;

  // Notify extension host that webview script has loaded and is ready to draw
  vscode.postMessage({ type: 'ready' });

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

  function renderFanChart(fanChart) {
    currentFanChart = fanChart;
    currentGraph = null;
    svg.replaceChildren();

    if (!fanChart.nodes.length) {
      empty.textContent = 'No individual record at the cursor.';
      empty.style.display = 'block';
      scroll.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    scroll.style.display = 'block';

    const width = 800;
    const height = 560;
    const cx = 400;
    const cy = 360;

    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

    // 240-degree fan: -210 deg to +30 deg (pointing up symmetrically)
    const startAngle = (-210 * Math.PI) / 180;
    const endAngle = (30 * Math.PI) / 180;
    const totalAngle = endAngle - startAngle;

    const maxGen = fanChart.maxGenerations || 5;
    const rootR = 65;
    const genR = 60;

    const nodeMap = new Map();
    for (const node of fanChart.nodes) {
      nodeMap.set(node.generation + ':' + node.slot, node);
    }

    function arcPath(rInner, rOuter, a1, a2) {
      const x1 = cx + rInner * Math.cos(a1);
      const y1 = cy + rInner * Math.sin(a1);
      const x2 = cx + rOuter * Math.cos(a1);
      const y2 = cy + rOuter * Math.sin(a1);
      const x3 = cx + rOuter * Math.cos(a2);
      const y3 = cy + rOuter * Math.sin(a2);
      const x4 = cx + rInner * Math.cos(a2);
      const y4 = cy + rInner * Math.sin(a2);

      const largeArc = a2 - a1 > Math.PI ? 1 : 0;

      if (rInner <= 0) {
        return 'M ' + cx + ' ' + cy + ' L ' + x2 + ' ' + y2 + ' A ' + rOuter + ' ' + rOuter + ' 0 ' + largeArc + ' 1 ' + x3 + ' ' + y3 + ' Z';
      }

      return 'M ' + x1 + ' ' + y1 +
             ' L ' + x2 + ' ' + y2 +
             ' A ' + rOuter + ' ' + rOuter + ' 0 ' + largeArc + ' 1 ' + x3 + ' ' + y3 +
             ' L ' + x4 + ' ' + y4 +
             ' A ' + rInner + ' ' + rInner + ' 0 ' + largeArc + ' 0 ' + x1 + ' ' + y1 + ' Z';
    }

    // Render Root (Gen 0)
    const rootNode = nodeMap.get('0:0');
    if (rootNode) {
      const rootG = el('g', {
        class: 'fan-node',
        'data-xref': rootNode.xref,
      });
      const rootPath = el('path', {
        class: 'fan-wedge root',
        'data-xref': rootNode.xref,
        d: arcPath(0, rootR, startAngle, endAngle),
      });
      const title = el('title', {}, '#' + rootNode.ahnentafel + ' ' + rootNode.label + (rootNode.detail ? ' (' + rootNode.detail + ')' : ''));
      rootPath.appendChild(title);
      rootG.appendChild(rootPath);
      rootG.addEventListener('click', () => vscode.postMessage({ type: 'select', xref: rootNode.xref }));

      const labelEl = el('text', {
        class: 'fan-label root',
        x: cx,
        y: cy - 25,
      }, truncate(rootNode.label, 18));
      rootG.appendChild(labelEl);

      if (rootNode.detail) {
        const detailEl = el('text', {
          class: 'fan-detail',
          x: cx,
          y: cy - 10,
        }, rootNode.detail);
        rootG.appendChild(detailEl);
      }
      svg.appendChild(rootG);
    }

    // Render Generations 1 .. maxGen - 1
    for (let g = 1; g < maxGen; g++) {
      const rInner = rootR + (g - 1) * genR;
      const rOuter = rootR + g * genR;
      const totalSlots = Math.pow(2, g);
      const angleStep = totalAngle / totalSlots;

      for (let s = 0; s < totalSlots; s++) {
        const a1 = startAngle + s * angleStep;
        const a2 = a1 + angleStep;
        const aMid = (a1 + a2) / 2;
        const rMid = (rInner + rOuter) / 2;

        const node = nodeMap.get(g + ':' + s);
        const isPaternal = s < totalSlots / 2;
        const branchClass = isPaternal ? 'paternal' : 'maternal';

        if (node) {
          const group = el('g', {
            class: 'fan-node',
            'data-xref': node.xref,
          });
          const wedge = el('path', {
            class: 'fan-wedge ' + branchClass,
            'data-xref': node.xref,
            d: arcPath(rInner, rOuter, a1, a2),
          });
          const title = el('title', {}, '#' + node.ahnentafel + ' ' + node.label + (node.detail ? ' (' + node.detail + ')' : ''));
          wedge.appendChild(title);
          group.appendChild(wedge);
          group.addEventListener('click', () => vscode.postMessage({ type: 'select', xref: node.xref }));

          const xMid = cx + rMid * Math.cos(aMid);
          const yMid = cy + rMid * Math.sin(aMid);
          let deg = (aMid * 180) / Math.PI + 90;
          if (deg > 90 && deg < 270) deg += 180;

          const maxLen = g >= 4 ? 12 : g === 3 ? 16 : 22;
          const textG = el('g', {
            transform: 'translate(' + xMid + ',' + yMid + ') rotate(' + deg + ')',
          });

          if (g <= 3 && node.detail) {
            textG.appendChild(el('text', { class: 'fan-label', y: -4 }, truncate(node.label, maxLen)));
            textG.appendChild(el('text', { class: 'fan-detail', y: 7 }, truncate(node.detail, maxLen)));
          } else {
            textG.appendChild(el('text', { class: 'fan-label', y: 0 }, truncate(node.label, maxLen)));
          }
          group.appendChild(textG);
          svg.appendChild(group);
        } else {
          const emptyWedge = el('path', {
            class: 'fan-wedge empty ' + branchClass,
            d: arcPath(rInner, rOuter, a1, a2),
          });
          svg.appendChild(emptyWedge);
        }
      }
    }
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
    currentFanChart = null;
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
            'data-from': edge.from,
            'data-to': edge.to,
            'data-union': edge.union || '',
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
            'data-from': edge.from,
            'data-to': edge.to,
            'data-union': edge.union || '',
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
            'data-from': edge.from,
            'data-to': edge.to,
            'data-union': edge.union || '',
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
          'data-from': edge.from,
          'data-to': edge.to,
          'data-union': edge.union || '',
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
        'data-xref': node.xref,
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

  document.getElementById('btn-fit')?.addEventListener('click', () => {
    if (currentFanChart) {
      svg.setAttribute('viewBox', '0 0 800 560');
      svg.style.width = '100%';
      svg.style.height = '100%';
      return;
    }
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
    if (currentFanChart) {
      svg.style.width = '';
      svg.style.height = '';
      svg.setAttribute('width', '800');
      svg.setAttribute('height', '560');
      svg.setAttribute('viewBox', '0 0 800 560');
      return;
    }
    if (!currentGraph) return;
    svg.style.width = '';
    svg.style.height = '';
    svg.setAttribute('width', currentGraph.width);
    svg.setAttribute('height', currentGraph.height);
    svg.setAttribute('viewBox', '0 0 ' + currentGraph.width + ' ' + currentGraph.height);
    centreOnFocus(currentGraph);
  });

  document.getElementById('btn-export-svg')?.addEventListener('click', () => {
    if ((!currentGraph && !currentFanChart) || !svg) return;

    // Resolve computed colors from active VS Code theme
    const style = window.getComputedStyle(document.body);
    const bgColor = style.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
    const fgColor = style.getPropertyValue('--vscode-foreground').trim() || '#cccccc';
    const descColor = style.getPropertyValue('--vscode-descriptionForeground').trim() || '#888888';
    const widgetBg = style.getPropertyValue('--vscode-editorWidget-background').trim() || '#252526';
    const widgetBorder =
      style.getPropertyValue('--vscode-editorWidget-border').trim() ||
      style.getPropertyValue('--vscode-focusBorder').trim() ||
      '#454545';
    const focusBorder = style.getPropertyValue('--vscode-focusBorder').trim() || '#007acc';
    const focusBg = style.getPropertyValue('--vscode-list-activeSelectionBackground').trim() || '#094771';
    const focusFg = style.getPropertyValue('--vscode-list-activeSelectionForeground').trim() || '#ffffff';
    const edgeColor = style.getPropertyValue('--vscode-editorIndentGuide-activeBackground').trim() || '#555555';
    const font = style.getPropertyValue('--vscode-font-family').trim() || 'system-ui, -apple-system, sans-serif';

    const isFan = !!currentFanChart;
    const exportWidth = isFan ? 800 : currentGraph.width;
    const exportHeight = isFan ? 560 : currentGraph.height;

    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', NS);
    clone.setAttribute('width', String(exportWidth));
    clone.setAttribute('height', String(exportHeight));
    clone.setAttribute('viewBox', '0 0 ' + exportWidth + ' ' + exportHeight);

    // Remove interactive elements
    for (const goto of Array.from(clone.querySelectorAll('.goto'))) {
      goto.remove();
    }

    const defs = document.createElementNS(NS, 'defs');
    const css = [
      'svg { background-color: ' + bgColor + '; font-family: ' + font + '; }',
      '.edge { stroke: ' + edgeColor + '; stroke-width: 1px; fill: none; opacity: 0.7; }',
      '.edge-label text { fill: ' + descColor + '; font-size: 9px; font-family: ' + font + '; }',
      '.edge-label-plate { fill: ' + bgColor + '; opacity: 0.9; }',
      '.node rect { fill: ' + widgetBg + '; stroke: ' + widgetBorder + '; stroke-width: 1px; rx: 3px; }',
      '.node.focus rect { stroke: ' + focusBorder + '; stroke-width: 2px; fill: ' + focusBg + '; }',
      '.node text.label { fill: ' + fgColor + '; font-size: 11px; font-family: ' + font + '; font-weight: 500; }',
      '.node.focus text.label { fill: ' + focusFg + '; font-weight: bold; }',
      '.node text.tag { fill: ' + descColor + '; font-size: 9px; font-family: monospace; }',
      '.node.focus text.tag { fill: ' + focusFg + '; opacity: 0.9; }',
      '.elided { fill: ' + descColor + '; font-size: 9px; font-family: ' + font + '; }',
      '.fan-wedge { stroke: ' + widgetBorder + '; stroke-width: 1px; }',
      '.fan-wedge.root { fill: ' + focusBg + '; }',
      '.fan-wedge.paternal { fill: ' + widgetBg + '; }',
      '.fan-wedge.maternal { fill: ' + widgetBg + '; }',
      '.fan-wedge.empty { fill: transparent; stroke-dasharray: 2 3; opacity: 0.35; }',
      '.fan-label { fill: ' + fgColor + '; font-size: 10px; font-family: ' + font + '; font-weight: 500; text-anchor: middle; dominant-baseline: central; }',
      '.fan-label.root { fill: ' + focusFg + '; font-weight: bold; font-size: 11px; }',
      '.fan-detail { fill: ' + descColor + '; font-size: 8px; font-family: ' + font + '; text-anchor: middle; dominant-baseline: central; }',
    ].join(' ');

    const styleEl = document.createElementNS(NS, 'style');
    styleEl.textContent = css;
    defs.appendChild(styleEl);
    clone.insertBefore(defs, clone.firstChild);

    // Explicit solid background
    const bgRect = document.createElementNS(NS, 'rect');
    bgRect.setAttribute('width', '100%');
    bgRect.setAttribute('height', '100%');
    bgRect.setAttribute('fill', bgColor);
    defs.after(bgRect);

    const serializer = new XMLSerializer();
    const svgString = '<?xml version="1.0" encoding="UTF-8"?> ' + serializer.serializeToString(clone);

    // Context-aware default filename based on selected person/family
    function sanitizeName(name) {
      if (!name) return '';
      let result = '';
      for (let i = 0; i < name.length; i++) {
        const ch = name[i];
        if (ch !== '/' && ch !== '\\\\' && ch !== ':' && ch !== '*' && ch !== '?' && ch !== '"' && ch !== '<' && ch !== '>' && ch !== '|') {
          result += ch;
        }
      }
      return result.trim().split(' ').filter(Boolean).join('-').toLowerCase();
    }

    let filename = 'tree-export.svg';
    if (isFan) {
      const rootNode = currentFanChart.nodes.find((n) => n.ahnentafel === 1);
      const label = rootNode ? rootNode.label : currentFanChart.rootXref || 'fan';
      const sanitized = sanitizeName(label);
      const xrefPrefix = currentFanChart.rootXref ? currentFanChart.rootXref + '-' : '';
      filename = 'fan-chart-' + xrefPrefix + (sanitized || 'export') + '.svg';
    } else if (currentGraph) {
      const focusNode = currentGraph.nodes.find((n) => n.xref === currentGraph.focus);
      const label = focusNode ? focusNode.label || focusNode.xref : currentGraph.focus || 'tree';
      const sanitized = sanitizeName(label);
      const xrefPrefix = currentGraph.focus ? currentGraph.focus + '-' : '';
      filename = 'tree-' + xrefPrefix + (sanitized || 'export') + '.svg';
    }

    vscode.postMessage({ type: 'export', format: 'svg', data: svgString, filename: filename });
  });

  const directionSelect = document.getElementById('direction-select');
  directionSelect?.addEventListener('change', () => {
    vscode.postMessage({ type: 'direction', value: directionSelect.value });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'graph') {
      if (directionSelect && message.direction) {
        directionSelect.value = message.direction;
      }
      render(message.graph);
      vscode.postMessage({
        type: 'drew',
        focus: message.graph.focus,
        nodes: message.graph.nodes.length,
      });
    } else if (message.type === 'fanchart') {
      if (directionSelect && message.direction) {
        directionSelect.value = message.direction;
      }
      renderFanChart(message.fanChart);
      vscode.postMessage({
        type: 'drew',
        focus: message.fanChart.rootXref,
        nodes: message.fanChart.nodes.length,
      });
    } else if (message.type === 'highlightPath') {
      const pathSet = new Set((message.path || []).map((x) => String(x).replace(/^@|@$/g, '')));
      for (const nodeEl of Array.from(svg.querySelectorAll('.node, .fan-node, .fan-wedge'))) {
        const xref = nodeEl.dataset.xref;
        if (pathSet.size > 0) {
          if (pathSet.has(xref)) {
            nodeEl.classList.add('path-highlight');
            nodeEl.classList.remove('dimmed');
          } else {
            nodeEl.classList.add('dimmed');
            nodeEl.classList.remove('path-highlight');
          }
        } else {
          nodeEl.classList.remove('path-highlight', 'dimmed');
        }
      }
      for (const edgeEl of Array.from(svg.querySelectorAll('.edge'))) {
        const from = edgeEl.dataset.from;
        const to = edgeEl.dataset.to;
        if (pathSet.size > 0) {
          const isOnPath = pathSet.has(from) && pathSet.has(to);
          if (isOnPath) {
            edgeEl.classList.add('path-highlight');
            edgeEl.classList.remove('dimmed');
          } else {
            edgeEl.classList.add('dimmed');
            edgeEl.classList.remove('path-highlight');
          }
        } else {
          edgeEl.classList.remove('path-highlight', 'dimmed');
        }
      }

      if (pathSet.size > 0 && currentGraph) {
        const pathNodes = currentGraph.nodes.filter((n) => pathSet.has(n.xref));
        if (pathNodes.length) {
          const minX = Math.min(...pathNodes.map((n) => n.x));
          const maxX = Math.max(...pathNodes.map((n) => n.x + NODE_WIDTH));
          const minY = Math.min(...pathNodes.map((n) => n.y));
          const maxY = Math.max(...pathNodes.map((n) => n.y + NODE_HEIGHT));
          const pad = 40;
          const boxW = Math.max(100, maxX - minX + pad * 2);
          const boxH = Math.max(100, maxY - minY + pad * 2);
          svg.setAttribute('viewBox', (minX - pad) + ' ' + (minY - pad) + ' ' + boxW + ' ' + boxH);
          svg.style.width = '100%';
          svg.style.height = '100%';
        }
      }
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
    commands.registerCommand('gedcom.highlightPath', (path: string[], focusXref?: string) => {
      provider.highlightPath(path, focusXref);
    }),
  );

  context.subscriptions.push(
    workspace.onDidOpenTextDocument((document) => {
      announce();
      if (document.languageId === 'gedcom') {
        followCursor(subjectEditor());
      }
    }),
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
