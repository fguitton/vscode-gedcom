/**
 * The details panel.
 *
 * The graph answers who connects to whom, and to answer it clearly it discards
 * almost everything else — occupations, places, sources, the submitter of the
 * file. That material is most of what a GEDCOM record actually holds, and the
 * reader looking at the chart is exactly the one who wants it, so it goes here
 * rather than into a box on the chart.
 *
 * With nothing selected it describes the file itself, which is the other thing
 * that has no place in a family tree: a submitter is not somebody's relative.
 */

import { analyzeText, documentDetails, recordDetails, type Details } from '@vscode-gedcom/core';
import {
  Range,
  Selection as EditorSelection,
  TextEditorRevealType,
  Uri,
  window,
  workspace,
  type CancellationToken,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import type { SelectionStore } from './selection.ts';

export const DETAILS_VIEW_ID = 'gedcom.details';

interface RevealMessage {
  readonly type: 'reveal';
  readonly line: number;
}

export class GedcomDetailsViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  private uri: Uri | undefined;
  private readonly selection: SelectionStore;

  constructor(selection: SelectionStore) {
    this.selection = selection;
  }

  resolveWebviewView(view: WebviewView, _context: unknown, _token: CancellationToken): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = shell();

    view.webview.onDidReceiveMessage((message: RevealMessage) => {
      if (message.type === 'reveal') void this.reveal(message.line);
    });

    view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh();
    });

    this.refresh();
  }

  refresh(): void {
    if (!this.view?.visible) return;

    const { uri, xref } = this.selection.current;
    const editor = window.visibleTextEditors.find(
      (candidate) => candidate.document.uri.toString() === uri?.toString(),
    );

    if (!editor || editor.document.languageId !== 'gedcom') {
      this.uri = undefined;
      void this.view.webview.postMessage({ type: 'empty' });
      return;
    }

    this.uri = editor.document.uri;

    const analysis = analyzeText(editor.document.getText());
    // Nothing selected describes the file, which is a question worth answering
    // and the only place the header's own content belongs.
    const details: Details =
      (xref === null ? undefined : recordDetails(analysis, xref)) ?? documentDetails(analysis);

    void this.view.webview.postMessage({ type: 'details', details });
  }

  private async reveal(line: number): Promise<void> {
    if (!this.uri) return;

    const document = await workspace.openTextDocument(this.uri);
    const editor = await window.showTextDocument(document, { preserveFocus: false });
    const position = new Range(line, 0, line, 0);
    editor.selection = new EditorSelection(position.start, position.start);
    editor.revealRange(position, TextEditorRevealType.InCenterIfOutsideViewport);
  }
}

function nonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(
    { length: 32 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
}

/** The panel document. Inline behind a nonce; see graph-view.ts for why. */
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
    padding: 0 0 1rem;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  header {
    padding: .6rem .75rem .5rem;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
    position: sticky;
    top: 0;
    background: inherit;
  }
  h1 { font-size: calc(var(--vscode-font-size) * 1.1); margin: 0; font-weight: 600; }
  .subtitle { color: var(--vscode-descriptionForeground); font-size: calc(var(--vscode-font-size) * .9); }
  h2 {
    font-size: calc(var(--vscode-font-size) * .8);
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--vscode-descriptionForeground);
    margin: 1rem .75rem .3rem;
    font-weight: 600;
  }
  dl { margin: 0; }
  .row {
    display: grid;
    grid-template-columns: minmax(6rem, 32%) 1fr;
    gap: .5rem;
    padding: .2rem .75rem;
    align-items: baseline;
  }
  .row.clickable { cursor: pointer; }
  .row.clickable:hover { background: var(--vscode-list-hoverBackground); }
  .row:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  dt { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  dd { margin: 0; overflow-wrap: anywhere; }
  /* Text written across CONT lines, where the breaks are the content: an
     address, or the twenty-eight line posting Royal92 carries. Shown verbatim,
     in the editor's own font, set apart from the labelled rows around it. */
  .block { display: block; padding: .3rem .75rem; }
  .block .name {
    color: var(--vscode-descriptionForeground);
    font-size: calc(var(--vscode-font-size) * .9);
    margin-bottom: .2rem;
  }
  .block pre {
    margin: 0;
    padding: .5rem .6rem;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, calc(var(--vscode-font-size) * .95));
    line-height: 1.4;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background));
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 3px;
    /* Wrap rather than scroll: the panel is narrow and the text is prose. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .block.clickable pre { cursor: pointer; }
  .block.clickable pre:hover { border-color: var(--vscode-focusBorder); }
  .block pre:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  #empty { padding: 1rem .75rem; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div id="empty">Open a GEDCOM file.</div>
<div id="content" hidden>
  <header><h1 id="title"></h1><div class="subtitle" id="subtitle"></div></header>
  <div id="sections"></div>
</div>
<script nonce="${id}">
(function () {
  const vscode = acquireVsCodeApi();
  const empty = document.getElementById('empty');
  const content = document.getElementById('content');
  const sections = document.getElementById('sections');

  function render(details) {
    empty.hidden = true;
    content.hidden = false;

    document.getElementById('title').textContent = details.title;
    document.getElementById('subtitle').textContent = details.subtitle || '';

    sections.replaceChildren();

    if (!details.sections.length) {
      const nothing = document.createElement('div');
      nothing.id = 'empty';
      nothing.textContent = 'Nothing recorded beyond the relationships in the graph.';
      sections.appendChild(nothing);
      return;
    }

    for (const section of details.sections) {
      const heading = document.createElement('h2');
      heading.textContent = section.title;
      sections.appendChild(heading);

      const list = document.createElement('dl');
      for (const field of section.fields) {
        const clickable = field.line !== undefined;
        const go = () => vscode.postMessage({ type: 'reveal', line: field.line });

        const activate = (element) => {
          if (!clickable) return;
          element.tabIndex = 0;
          element.setAttribute('role', 'button');
          element.title = 'Show this line in the editor';
          element.addEventListener('click', go);
          element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); }
          });
        };

        // Multi-line text gets the width of the panel and keeps its own breaks;
        // squeezed into the value column it is unreadable.
        if (field.block) {
          const wrapper = document.createElement('div');
          wrapper.className = 'block' + (clickable ? ' clickable' : '');

          const name = document.createElement('div');
          name.className = 'name';
          name.textContent = field.label;

          const body = document.createElement('pre');
          body.textContent = field.value;
          activate(body);

          wrapper.append(name, body);
          list.appendChild(wrapper);
          continue;
        }

        const row = document.createElement('div');
        row.className = 'row' + (clickable ? ' clickable' : '');

        const label = document.createElement('dt');
        label.textContent = field.label;
        const value = document.createElement('dd');
        value.textContent = field.value;

        row.append(label, value);
        activate(row);
        list.appendChild(row);
      }
      sections.appendChild(list);
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'details') render(message.details);
    else {
      content.hidden = true;
      empty.hidden = false;
    }
  });
}());
</script>
</body>
</html>`;
}
