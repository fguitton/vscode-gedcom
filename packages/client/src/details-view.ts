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

import {
  analyzeText,
  documentDetails,
  recordDetails,
  webUrl,
  type Details,
} from '@vscode-gedcom/core';
import {
  env,
  Range,
  Selection as EditorSelection,
  TextEditorRevealType,
  Uri,
  window,
  workspace,
  type CancellationToken,
  type Disposable,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import { contentSecurityPolicy } from './policy.ts';
import type { SelectionStore } from './selection.ts';

export const DETAILS_VIEW_ID = 'gedcom.details';

/** The setting that governs whether the panel fetches anything from the network. */
const PREVIEWS = 'gedcom.details.imagePreviews';

type PanelMessage =
  | { readonly type: 'reveal'; readonly line: number }
  | { readonly type: 'open'; readonly url: string };

function previewsEnabled(): boolean {
  return workspace.getConfiguration().get<boolean>(PREVIEWS, true);
}

export class GedcomDetailsViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  private uri: Uri | undefined;
  private readonly selection: SelectionStore;
  private readonly subscriptions: Disposable[] = [];

  constructor(selection: SelectionStore) {
    this.selection = selection;
  }

  resolveWebviewView(view: WebviewView, _context: unknown, _token: CancellationToken): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = shell(previewsEnabled());

    view.webview.onDidReceiveMessage((message: PanelMessage) => {
      if (message.type === 'reveal') void this.reveal(message.line);
      else if (message.type === 'open') void this.open(message.url);
    });

    view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh();
    });

    // The policy that permits a remote image is written into the document, so
    // turning previews off has to rewrite it rather than merely stop emitting
    // pictures. Anything less would leave the panel *able* to make the request
    // the setting exists to prevent.
    this.subscriptions.push(
      workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(PREVIEWS)) return;
        view.webview.html = shell(previewsEnabled());
        this.refresh();
      }),
    );

    view.onDidDispose(() => {
      for (const subscription of this.subscriptions) subscription.dispose();
      this.subscriptions.length = 0;
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

  /**
   * Opens a link the file supplied.
   *
   * Checked here rather than trusted from the panel: the payload came out of a
   * document the user may merely have been sent, and `env.openExternal` will
   * hand a `file:` or a `vscode:` URI straight to the machine.
   */
  private async open(url: string): Promise<void> {
    if (!webUrl(url)) return;
    await env.openExternal(Uri.parse(url, true));
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
function shell(previews: boolean): string {
  const id = nonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="${contentSecurityPolicy({ nonce: id, images: previews })}">
<style nonce="${id}">
  :root {
    color-scheme: light dark;
    /* Named once. The header has to paint the same ground as the page, and it
       cannot inherit it: the header sits inside a plain div, so inheriting gives
       it that div's transparency rather than the body's colour — and the panel
       then scrolls underneath a header you can see straight through. */
    --panel-background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  body {
    margin: 0;
    padding: 0 0 1rem;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--panel-background);
  }
  header {
    padding: .6rem .75rem .5rem;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
    position: sticky;
    top: 0;
    background: var(--panel-background);
    /* Above anything that scrolls up to meet it, whatever order it appears in. */
    z-index: 1;
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
    line-height: 1.45;
    /* A translucent grey rather than a theme colour alone: it lifts off the
       panel in a dark theme and settles into it in a light one, and it cannot
       come out invisible if a theme leaves the token undefined. */
    background: rgba(127, 127, 127, .14);
    border: 1px solid rgba(127, 127, 127, .22);
    border-radius: 4px;
    /* Wrap rather than scroll: the panel is narrow and the text is prose. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    /* Correspondence runs to dozens of lines; keep it from burying the panel. */
    max-height: 22rem;
    overflow-y: auto;
  }
  .block.clickable pre { cursor: pointer; }
  .block.clickable pre:hover { border-color: var(--vscode-focusBorder); }
  .block pre:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  /* A tag that is present and says nothing. Set in italic and dimmed so it reads
     as the panel's own word rather than as content from the file. */
  .empty {
    font-style: italic;
    opacity: .6;
  }
  a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  a:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
  a:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  /* A thumbnail sits under its row rather than beside it: the panel is narrow,
     and a picture squeezed into the value column is too small to be worth the
     request that fetched it. */
  .thumb {
    display: block;
    margin: .25rem .75rem .5rem;
    max-width: calc(100% - 1.5rem);
    max-height: 14rem;
    border-radius: 4px;
    border: 1px solid rgba(127, 127, 127, .22);
    background: rgba(127, 127, 127, .14);
    cursor: pointer;
  }
  /* Nothing came back — a dead link, an offline machine, a host that refuses a
     hotlink. The row above still says what the file claims is there. */
  .thumb.broken { display: none; }
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
  const previews = ${previews ? 'true' : 'false'};

  /** Bare http(s) URLs, stopping before punctuation that ends a sentence. */
  const URL_PATTERN = /https?:\\/\\/[^\\s<>"']+[^\\s<>"'.,;:!?)\\]]/g;

  function openExternally(url) {
    vscode.postMessage({ type: 'open', url: url });
  }

  function link(url) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.textContent = url;
    anchor.title = 'Open ' + url;
    // The row beneath reveals the line in the editor; a click meant for the
    // link is not also a request to jump there.
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openExternally(url);
    });
    return anchor;
  }

  /**
   * Text with any URLs in it turned into links.
   *
   * Built as nodes rather than as markup: the text came out of the file, and
   * anything assembled as an HTML string would be the file choosing what the
   * panel renders.
   */
  function linkified(text) {
    const fragment = document.createDocumentFragment();
    let last = 0;
    URL_PATTERN.lastIndex = 0;

    for (let match; (match = URL_PATTERN.exec(text)); ) {
      if (match.index > last) {
        fragment.appendChild(document.createTextNode(text.slice(last, match.index)));
      }
      fragment.appendChild(link(match[0]));
      last = match.index + match[0].length;
    }

    if (last === 0) return document.createTextNode(text);
    if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
    return fragment;
  }

  function thumbnail(field) {
    if (!previews || !field.url) return undefined;
    if (!field.mediaType || field.mediaType.slice(0, 6) !== 'image/') return undefined;

    const image = document.createElement('img');
    image.className = 'thumb';
    image.loading = 'lazy';
    image.alt = field.label;
    image.title = 'Open ' + field.url;
    image.addEventListener('click', () => openExternally(field.url));
    image.addEventListener('error', () => { image.classList.add('broken'); });
    image.src = field.url;
    return image;
  }

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
          body.replaceChildren(linkified(field.value));
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
        if (field.empty) {
          const nothing = document.createElement('span');
          nothing.className = 'empty';
          nothing.textContent = 'no value';
          value.replaceChildren(nothing);
        } else {
          value.replaceChildren(linkified(field.value));
        }

        row.append(label, value);
        activate(row);
        list.appendChild(row);

        const image = thumbnail(field);
        if (image) list.appendChild(image);
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
