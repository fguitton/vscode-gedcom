/**
 * Which record the panels are looking at.
 *
 * Two views need the same answer and either can change it: the cursor moving in
 * the editor selects the record it lands in, and clicking a box in the graph
 * selects that person without disturbing the editor at all. Keeping the answer
 * in one place is what stops the two from arguing.
 *
 * A click deliberately does *not* navigate. Following a line of descent means
 * looking at a dozen people in a row, and jumping the editor to each one in turn
 * loses the reader's place in the file for no benefit. Navigation is its own
 * gesture, on its own button.
 */

import { EventEmitter, window, type Disposable, type TextEditor, type Uri } from 'vscode';

/**
 * The editor holding the document the panels should describe.
 *
 * `window.activeTextEditor` is `undefined` while focus is in a webview panel —
 * which is where focus goes the moment a reader clicks something in the tree.
 * Following only the active editor caused a click to clear the details panel,
 * redraw the tree empty and throw away what was on screen.
 *
 * Nor is the active editor guaranteed to be a GEDCOM file: a reader may have a
 * file beside the tree. What the panels follow is the GEDCOM file on screen —
 * the active editor while it is one, otherwise a visible one, and nothing at all
 * only when none is in view.
 */
export function subjectEditor(): TextEditor | undefined {
  const active = window.activeTextEditor;
  if (active?.document.languageId === 'gedcom') return active;
  return window.visibleTextEditors.find((editor) => editor.document.languageId === 'gedcom');
}

export interface Selection {
  readonly uri: Uri | undefined;
  /** The record identifier, or null when the cursor is not inside a record. */
  readonly xref: string | null;
}

export class SelectionStore implements Disposable {
  private readonly emitter = new EventEmitter<Selection>();
  private selection: Selection = { uri: undefined, xref: null };

  readonly onDidChange = this.emitter.event;

  get current(): Selection {
    return this.selection;
  }

  set(next: Selection): void {
    // A redundant event would redraw both panels on every cursor move within a
    // record, which is most cursor moves.
    if (
      next.uri?.toString() === this.selection.uri?.toString() &&
      next.xref === this.selection.xref
    ) {
      return;
    }

    this.selection = next;
    this.emitter.fire(next);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
