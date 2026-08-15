/**
 * Indentation that is not in the file.
 *
 * A GEDCOM line must start with its level number in column zero, so the format
 * forbids the one thing that would make a deep structure readable. The hierarchy
 * is right there in the level numbers and the eye cannot use it.
 *
 * This draws the indentation the file is not allowed to contain, as a decoration
 * before the level number. Decorations are painted by the editor and belong to no
 * document: nothing is inserted, nothing is saved, a copy takes the real text,
 * and the file on disk is byte-for-byte what it always was. Turning the setting
 * off removes it with no trace, because there was never anything there.
 *
 * Requested in issue #2, where it was described as "virtual whitespaces/tabs to
 * create a visual indentation effect".
 */

import {
  Range,
  window,
  workspace,
  type ExtensionContext,
  type TextEditor,
  type TextEditorDecorationType,
} from 'vscode';

const ENABLED = 'gedcom.virtualIndent.enabled';
const WIDTH = 'gedcom.virtualIndent.width';

/** The level a line declares, or nothing if the line does not start with one. */
function levelOf(text: string): number | undefined {
  // Only lines with no leading whitespace of their own: a file that already
  // indents itself is showing the reader its own habit, and adding to it would
  // double the indentation rather than supply it.
  const match = /^(\d+)[ \t]/.exec(text);
  return match ? Number(match[1]) : undefined;
}

export function registerVirtualIndent(context: ExtensionContext): void {
  /**
   * One decoration type per level, reused across editors.
   *
   * Per-range `renderOptions` would allow a single type, but VS Code keeps every
   * distinct options object alive for the life of the editor; a 30,000 line file
   * would mint 30,000 of them. Levels are few and repeat endlessly, so they are
   * built once and kept.
   */
  let types: TextEditorDecorationType[] = [];

  const dispose = (): void => {
    for (const type of types) type.dispose();
    types = [];
  };

  const typeFor = (level: number, width: number): TextEditorDecorationType => {
    types[level] ??= window.createTextEditorDecorationType({
      before: {
        // A non-breaking space so the editor cannot collapse it, and no colour
        // of its own: this is space, and space has no appearance.
        contentText: ' '.repeat(level * width),
      },
    });
    return types[level]!;
  };

  const paint = (editor: TextEditor | undefined): void => {
    if (!editor || editor.document.languageId !== 'gedcom') return;

    const configuration = workspace.getConfiguration();
    if (!configuration.get<boolean>(ENABLED, false)) {
      for (const type of types) editor.setDecorations(type, []);
      return;
    }

    const width = Math.max(1, Math.min(8, configuration.get<number>(WIDTH, 2)));
    const byLevel = new Map<number, Range[]>();

    /**
     * The level of the last line that declared one.
     *
     * Some exporters write payloads containing literal line breaks, so the rest
     * of a value arrives with no level number of its own. Left un-indented those
     * lines fall back to column zero, and a note in the middle of a record looks
     * like a new record — the indentation would be actively misleading rather
     * than merely absent. They belong one level in from the line they continue,
     * which is where a `CONT` would have put them.
     */
    let carried: number | undefined;

    for (let line = 0; line < editor.document.lineCount; line += 1) {
      const text = editor.document.lineAt(line).text;
      const declared = levelOf(text);
      if (declared !== undefined) carried = declared;

      const level =
        declared ?? (text.trim().length > 0 && carried !== undefined ? carried + 1 : undefined);

      // Level zero is already where it belongs, and a line that is not a GEDCOM
      // line at all — a stray blank, a truncated last line — is left alone.
      if (level === undefined || level === 0) continue;

      const at = new Range(line, 0, line, 0);
      const bucket = byLevel.get(level);
      if (bucket) bucket.push(at);
      else byLevel.set(level, [at]);
    }

    // Every level is set, including the empty ones, so a level that has just
    // stopped occurring has its decoration cleared rather than left behind.
    const deepest = Math.max(types.length - 1, ...byLevel.keys());
    for (let level = 1; level <= deepest; level += 1) {
      editor.setDecorations(typeFor(level, width), byLevel.get(level) ?? []);
    }
  };

  const repaint = (): void => {
    for (const editor of window.visibleTextEditors) paint(editor);
  };

  context.subscriptions.push(
    { dispose },
    window.onDidChangeVisibleTextEditors(repaint),
    workspace.onDidChangeTextDocument((event) => {
      for (const editor of window.visibleTextEditors) {
        if (editor.document === event.document) paint(editor);
      }
    }),
    workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(ENABLED) && !event.affectsConfiguration(WIDTH)) return;
      // The width is baked into each decoration type, so a change to it means
      // the existing ones describe the old setting and have to go.
      dispose();
      repaint();
    }),
  );

  repaint();
}
