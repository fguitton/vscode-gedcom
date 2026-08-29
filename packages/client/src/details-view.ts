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
  documentDetails,
  isGedcomX,
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

import { analysisOf } from './analysis.ts';
import { getClientBundle } from './l10n.ts';
import { contentSecurityPolicy } from './policy.ts';
import { SelectionStore, subjectEditor } from './selection.ts';

export const DETAILS_VIEW_ID = 'gedcom.details';

/** The setting that governs whether the panel fetches anything from the network. */
const PREVIEWS = 'gedcom.details.imagePreviews';

/** The setting that chooses how a note carrying markup is shown to begin with. */
const NOTE_FORMAT = 'gedcom.details.noteFormat';

type NoteFormat = 'text' | 'html';

type PanelMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'reveal'; readonly line: number }
  | { readonly type: 'open'; readonly url: string }
  | { readonly type: 'format'; readonly value: NoteFormat };

function previewsEnabled(): boolean {
  return workspace.getConfiguration().get<boolean>(PREVIEWS, true);
}

function configuredFormat(): NoteFormat {
  return workspace.getConfiguration().get<NoteFormat>(NOTE_FORMAT, 'text') === 'html'
    ? 'html'
    : 'text';
}

export class GedcomDetailsViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  private uri: Uri | undefined;
  private readonly selection: SelectionStore;
  private readonly subscriptions: Disposable[] = [];
  /**
   * How the reader last chose to see a note carrying markup.
   *
   * Held here rather than in the panel because the panel is thrown away whenever
   * it is hidden, and rather than in settings because it is a way of looking at
   * the record in front of you, not a preference about GEDCOM files in general.
   * The setting decides where the session starts; this decides where it went.
   */
  private format: NoteFormat = configuredFormat();

  constructor(selection: SelectionStore) {
    this.selection = selection;
  }

  resolveWebviewView(view: WebviewView, _context: unknown, _token: CancellationToken): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = shell(previewsEnabled(), getClientBundle());

    view.webview.onDidReceiveMessage((message: PanelMessage) => {
      if (message.type === 'ready') this.refresh();
      else if (message.type === 'reveal') void this.reveal(message.line);
      else if (message.type === 'open') void this.open(message.url);
      else if (message.type === 'format') {
        this.format = message.value === 'html' ? 'html' : 'text';
        this.refresh();
      }
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
        view.webview.html = shell(previewsEnabled(), getClientBundle());
        this.refresh();
      }),
    );

    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
        this.lastShown = undefined;
      }
      for (const subscription of this.subscriptions) subscription.dispose();
      this.subscriptions.length = 0;
    });

    this.refresh();
  }

  /**
   * The title the panel last put on screen, or nothing when it is empty.
   *
   * Exposed for the same reason the tree exposes what it drew: a webview is an
   * opaque rectangle from outside, and a panel that has quietly emptied itself
   * looks exactly like one that never filled.
   */
  get showing(): string | undefined {
    return this.lastShown;
  }

  private lastShown: string | undefined;

  refresh(): void {
    if (!this.view?.visible) return;

    const { uri, xref } = this.selection.current;
    // The document, not an editor showing it. Reading text needs no editor, and
    // requiring a visible one empties the panel whenever the editor area is not
    // on screen — which is exactly what maximising this panel does.
    let document = uri
      ? workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString())
      : undefined;

    if (!document) {
      document = subjectEditor()?.document;
    }

    if (!document || (document.languageId !== 'gedcom' && !isGedcomX(document.getText()))) {
      this.uri = undefined;
      this.lastShown = undefined;
      void this.view.webview.postMessage({ type: 'empty' });
      return;
    }

    this.uri = document.uri;

    const activeEditor = window.activeTextEditor;
    const isDocumentActive = activeEditor?.document.uri.toString() === document.uri.toString();
    const fileName = document.uri.path.split('/').pop() || 'This file';

    const analysis = analysisOf(document);
    // Nothing selected describes the file, which is a question worth answering
    // and the only place the header's own content belongs.
    const locale = env?.language;
    let details: Details =
      (xref === null ? undefined : recordDetails(analysis, xref, { locale })) ??
      documentDetails(analysis, { locale });

    if ((details.title === 'This file' || details.title === 'Ce fichier') && !isDocumentActive) {
      details = {
        ...details,
        title: fileName,
      };
    }

    this.lastShown = details.title;
    void this.view.webview.postMessage({
      type: 'details',
      details,
      format: this.format,
      showFileLink: !isDocumentActive,
      fileName,
    });
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
function shell(previews: boolean, bundle: Record<string, string> = {}): string {
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
  .header-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: .5rem;
  }
  .header-link-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 2px 4px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    line-height: 1;
    flex-shrink: 0;
  }
  .header-link-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
    color: var(--vscode-foreground);
  }
  .header-link-btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
  }
  .header-link-btn svg {
    display: block;
    width: 14px;
    height: 14px;
    fill: currentColor;
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
  /* The switch between the characters in the file and the markup they spell. */
  .switch {
    display: flex;
    justify-content: flex-end;
    gap: .25rem;
    margin-bottom: .2rem;
  }
  .switch button {
    font-family: inherit;
    font-size: calc(var(--vscode-font-size) * .85);
    color: var(--vscode-descriptionForeground);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 0 .4rem;
    cursor: pointer;
  }
  .switch button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.16)); }
  .switch button[aria-pressed="true"] {
    color: var(--vscode-foreground);
    border-color: var(--vscode-focusBorder);
  }
  .switch button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  /* Rendered markup, in the panel's own font rather than the editor's: it is
     prose now, not the characters the file happens to hold. */
  .rendered {
    padding: .5rem .6rem;
    background: rgba(127, 127, 127, .14);
    border: 1px solid rgba(127, 127, 127, .22);
    border-radius: 4px;
    max-height: 22rem;
    overflow-y: auto;
    overflow-wrap: anywhere;
  }
  .rendered p { margin: 0 0 .5rem; }
  .rendered p:last-child { margin-bottom: 0; }
  .rendered ul, .rendered ol { margin: 0 0 .5rem; padding-left: 1.2rem; }
  .rendered blockquote {
    margin: 0 0 .5rem;
    padding-left: .6rem;
    border-left: 2px solid rgba(127, 127, 127, .4);
  }
  .rendered code, .rendered pre { font-family: var(--vscode-editor-font-family, monospace); }
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
  #empty {
    padding: 1rem .75rem;
    color: var(--vscode-descriptionForeground);
    font-size: calc(var(--vscode-font-size) * .95);
    line-height: 1.4;
  }

  /* Life Timeline */
  .timeline {
    position: relative;
    padding-left: 1.25rem;
    margin: .5rem .75rem 1rem;
  }
  .timeline::before {
    content: '';
    position: absolute;
    top: .4rem;
    bottom: .4rem;
    left: .35rem;
    width: 2px;
    background: var(--vscode-editorIndentGuide-activeBackground, rgba(127,127,127,.3));
  }
  .timeline-item {
    position: relative;
    margin-bottom: .75rem;
  }
  .timeline-item:last-child { margin-bottom: 0; }
  .timeline-item.clickable { cursor: pointer; }
  .timeline-item.clickable:hover .timeline-label { color: var(--vscode-textLink-activeForeground, var(--vscode-focusBorder)); }
  .timeline-dot {
    position: absolute;
    left: -1.25rem;
    top: .35rem;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--vscode-focusBorder, #007acc);
    border: 2px solid var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  .timeline-header {
    display: flex;
    align-items: baseline;
    gap: .4rem;
    margin-bottom: .15rem;
  }
  .timeline-age {
    font-weight: 600;
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
    background: var(--vscode-badge-background, rgba(127,127,127,.2));
    padding: .05rem .3rem;
    border-radius: 3px;
    font-size: calc(var(--vscode-font-size) * .75);
  }
  .timeline-date {
    color: var(--vscode-descriptionForeground);
    font-size: calc(var(--vscode-font-size) * .85);
  }
  .timeline-label {
    font-weight: 500;
    font-size: calc(var(--vscode-font-size) * .9);
    color: var(--vscode-foreground);
  }
  .timeline-detail {
    color: var(--vscode-descriptionForeground);
    font-size: calc(var(--vscode-font-size) * .85);
    margin-top: .1rem;
  }
  .timeline-place {
    color: var(--vscode-descriptionForeground);
    font-size: calc(var(--vscode-font-size) * .8);
    font-style: italic;
    margin-top: .1rem;
  }
</style>
</head>
<body>
<div id="empty">Open a GEDCOM file.</div>
<div id="content" hidden>
  <header>
    <div class="header-main">
      <h1 id="title"></h1>
      <button type="button" id="btn-switch-file" class="header-link-btn" title="Switch to this file in the editor" aria-label="Switch to this file in the editor" hidden>
        <svg viewBox="0 0 16 16"><path d="M1.5 1h10l3 3v10.5a.5.5 0 0 1-.5.5h-12.5a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5zm9.5.5v3h3l-3-3zM2 2v12h12V5h-3.5a.5.5 0 0 1-.5-.5V2H2z"/><path d="M8.5 7.5a.5.5 0 0 0-1 0v3.793l-1.146-1.147a.5.5 0 0 0-.708.708l2 2a.5.5 0 0 0 .708 0l2-2a.5.5 0 0 0-.708-.708L8.5 11.293V7.5z"/></svg>
      </button>
    </div>
    <div class="subtitle" id="subtitle"></div>
  </header>
  <div id="sections"></div>
</div>
<script nonce="${id}">
(function () {
  const vscode = acquireVsCodeApi();
  const empty = document.getElementById('empty');
  const content = document.getElementById('content');
  const sections = document.getElementById('sections');
  const previews = ${previews ? 'true' : 'false'};
  const L10N = ${JSON.stringify(bundle)};

  function t(k, ...args) {
    let str = L10N[k] || k;
    return args.length === 0
      ? str
      : str.replace(/\\{(\\d+)\\}/g, (_, i) => args[Number(i)] !== undefined ? args[Number(i)] : '{' + i + '}');
  }

  // Notify extension host that webview script has loaded and is ready to draw
  vscode.postMessage({ type: 'ready' });
  /** Text or markup, for the whole panel. Replaced by every details message. */
  let format = 'text';

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

  /**
   * Tags kept when rendering a note, and the attributes each may carry.
   *
   * An allowlist, so a tag nobody thought about is dropped rather than passed
   * through. The content security policy already refuses to run script and to
   * load anything remote, but a policy is the second line: this is the first.
   * Images are absent deliberately — a note is text, and an <img> would reach
   * the network on behalf of a file the reader may only have been sent.
   */
  const ALLOWED = {
    A: ['href'], ABBR: [], B: [], BLOCKQUOTE: [], BR: [], CODE: [], DD: [], DIV: [], DL: [],
    DT: [], EM: [], H1: [], H2: [], H3: [], H4: [], H5: [], H6: [], HR: [], I: [], LI: [],
    OL: [], P: [], PRE: [], SMALL: [], SPAN: [], STRONG: [], SUB: [], SUP: [], TABLE: [],
    TBODY: [], TD: [], TH: [], THEAD: [], TR: [], U: [], UL: [],
  };

  /**
   * Elements dropped along with everything inside them.
   *
   * Everything else unrecognised keeps its contents and loses only its tag, which
   * is right for a stray <font> and wrong for these: the text inside a <script>
   * or a <style> is code, and showing it as prose would be nonsense even though
   * it cannot run. Compared case-insensitively because a foreign-namespace
   * element reports a lower-case tagName.
   */
  const DROP_ENTIRELY = new Set([
    'SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT',
    'EMBED', 'APPLET', 'NOSCRIPT', 'FORM', 'INPUT', 'BUTTON', 'SELECT',
    'TEXTAREA', 'SVG', 'MATH', 'LINK', 'META', 'BASE', 'TITLE',
  ]);

  /** A copy of a node tree holding only what ALLOWED admits. */
  function sanitize(node, into) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        into.appendChild(document.createTextNode(child.nodeValue));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const tag = child.tagName.toUpperCase();
      if (DROP_ENTIRELY.has(tag)) continue;

      const permitted = ALLOWED[tag];
      if (!permitted) {
        // Unrecognised: drop the tag, keep what it wrapped.
        sanitize(child, into);
        continue;
      }

      // Built by name from the allowlist rather than cloned, so no attribute,
      // event handler or property of the original can ride along. An onclick, an
      // onerror or a style is not stripped — it is simply never copied, because
      // the only attributes on the copy are the ones named here, and the only
      // one named anywhere is href.
      const copy = document.createElement(tag);
      for (const name of permitted) {
        const value = child.getAttribute(name);
        if (value === null) continue;
        // Only the web, and only on a link: everything else is dropped outright.
        if (name === 'href' && !/^https?:\\/\\//i.test(value.trim())) continue;
        copy.setAttribute(name, value);
      }

      if (copy.tagName === 'A' && copy.hasAttribute('href')) {
        const url = copy.getAttribute('href');
        copy.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openExternally(url);
        });
      }

      sanitize(child, copy);
      into.appendChild(copy);
    }
  }

  /**
   * One pass of entity decoding, by table rather than by the DOM.
   *
   * Decoding through innerHTML would mean handing the string to the parser
   * before it has been sanitised, which is the one order this must never happen
   * in. A fixed table cannot do anything but substitute.
   */
  const ENTITIES = {
    '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&amp;': '&',
  };

  function decodeOnce(text) {
    return text.replace(/&(lt|gt|quot|apos|amp|#39);/g, (match) => ENTITIES[match] ?? match);
  }

  /**
   * The note as markup.
   *
   * The depth is how many times the exporter escaped it — MyHeritage escapes its
   * citation text twice, once as HTML and again as text, so a reader is shown
   * an escaped break where a line break was meant. Decoded exactly that many
   * times and no more, then through the same allowlist as any other markup: the
   * sanitiser is still the only gate, so decoding first adds no new surface.
   */
  function rendered(text, depth) {
    let source = text;
    for (let i = 0; i < (depth ?? 0); i += 1) source = decodeOnce(source);

    const parsed = new DOMParser().parseFromString(source, 'text/html');
    const holder = document.createElement('div');
    holder.className = 'rendered';
    sanitize(parsed.body, holder);
    return holder;
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

  /**
   * The two-way switch shown above a note that holds markup.
   *
   * Choosing sends the choice to the extension, which holds it for the session
   * and asks for a redraw — so every note in the panel switches together, and
   * the choice survives the panel being hidden and rebuilt.
   */
  function chooser() {
    const bar = document.createElement('div');
    bar.className = 'switch';

    for (const [value, label, title] of [
      ['text', t('Text'), t('Show the characters the file contains')],
      ['html', t('HTML'), t('Render the markup, sanitised')],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = title;
      button.setAttribute('aria-pressed', String(format === value));
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        vscode.postMessage({ type: 'format', value });
      });
      bar.appendChild(button);
    }

    return bar;
  }

  const btnSwitchFile = document.getElementById('btn-switch-file');
  btnSwitchFile?.addEventListener('click', () => {
    vscode.postMessage({ type: 'reveal', line: 0 });
  });

  function render(message) {
    const details = message.details;
    empty.hidden = true;
    content.hidden = false;

    document.getElementById('title').textContent = details.title;
    document.getElementById('subtitle').textContent = details.subtitle || '';

    if (btnSwitchFile) {
      btnSwitchFile.hidden = !message.showFileLink;
      if (message.fileName) {
        btnSwitchFile.title = t('Switch to {0} in editor', message.fileName);
      }
    }

    sections.replaceChildren();

    if (details.timeline && details.timeline.length > 0) {
      const heading = document.createElement('h2');
      heading.textContent = t('Life Timeline');
      sections.appendChild(heading);

      const timelineContainer = document.createElement('div');
      timelineContainer.className = 'timeline';

      for (const event of details.timeline) {
        const item = document.createElement('div');
        item.className = 'timeline-item' + (event.line !== undefined ? ' clickable' : '');
        if (event.line !== undefined) {
          item.tabIndex = 0;
          item.title = t('Show this event in the editor');
          const go = () => vscode.postMessage({ type: 'reveal', line: event.line });
          item.addEventListener('click', go);
          item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              go();
            }
          });
        }

        const dot = document.createElement('div');
        dot.className = 'timeline-dot';
        item.appendChild(dot);

        const header = document.createElement('div');
        header.className = 'timeline-header';

        if (event.age) {
          const ageSpan = document.createElement('span');
          ageSpan.className = 'timeline-age';
          ageSpan.textContent = event.age;
          header.appendChild(ageSpan);
        }

        if (event.date || event.year) {
          const dateSpan = document.createElement('span');
          dateSpan.className = 'timeline-date';
          dateSpan.textContent = event.date || String(event.year);
          header.appendChild(dateSpan);
        }

        item.appendChild(header);

        const label = document.createElement('div');
        label.className = 'timeline-label';
        label.textContent = event.label;
        item.appendChild(label);

        if (event.detail) {
          const detail = document.createElement('div');
          detail.className = 'timeline-detail';
          detail.textContent = event.detail;
          item.appendChild(detail);
        }

        if (event.place) {
          const place = document.createElement('div');
          place.className = 'timeline-place';
          place.textContent = event.place;
          item.appendChild(place);
        }

        timelineContainer.appendChild(item);
      }
      sections.appendChild(timelineContainer);
    }

    if (!details.sections.length && (!details.timeline || !details.timeline.length)) {
      const nothing = document.createElement('div');
      nothing.id = 'empty';
      nothing.textContent = t('Nothing recorded beyond the relationships in the tree.');
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
          element.title = t('Show this line in the editor');
          element.addEventListener('click', go);
          element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); }
          });
        };

        // Multi-line text gets the width of the panel and keeps its own breaks;
        // squeezed into the value column it is unreadable.
        if (field.block || field.html) {
          const wrapper = document.createElement('div');
          wrapper.className = 'block' + (clickable ? ' clickable' : '');

          const name = document.createElement('div');
          name.className = 'name';
          name.textContent = field.label;
          wrapper.appendChild(name);

          // Only where there is markup to render. Offering the choice on an
          // address would be offering to render something that is not there.
          if (field.html) wrapper.appendChild(chooser());

          const show = () => {
            const previous = wrapper.querySelector('pre, .rendered');
            const body =
              field.html && format === 'html'
                ? rendered(field.value, field.escapeDepth)
                : (() => {
                    const pre = document.createElement('pre');
                    pre.replaceChildren(linkified(field.value));
                    return pre;
                  })();
            activate(body);
            if (previous) previous.replaceWith(body);
            else wrapper.appendChild(body);
          };

          show();
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
          nothing.textContent = t('no value');
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
    if (message.type === 'details') {
      // The extension owns the choice, so a rebuilt panel is handed it back
      // rather than starting again from the setting.
      format = message.format === 'html' ? 'html' : 'text';
      render(message);
    } else if (message.type === 'empty') {
      content.hidden = true;
      empty.hidden = false;
    }
  });
}());
</script>
</body>
</html>`;
}
