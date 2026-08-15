/**
 * The detected GEDCOM version, in the status bar.
 *
 * Every diagnostic about vocabulary is judged against a version, and until now
 * the only way to find out which was to read a diagnostic that mentioned it. That
 * is backwards: the version governs how the whole file is read, it is often
 * *guessed* rather than declared, and a reader who disagrees with the guess needs
 * to see it before anything else makes sense.
 *
 * The bar shows it whenever a GEDCOM file is focused. The tooltip explains how it
 * was arrived at, and clicking runs the explanation as a full message for anyone
 * who missed the tooltip.
 */

import { type Analysis } from '@vscode-gedcom/core';
import { analysisOf } from './analysis.ts';
import {
  commands,
  MarkdownString,
  StatusBarAlignment,
  ThemeColor,
  window,
  workspace,
  type ExtensionContext,
  type TextEditor,
} from 'vscode';

const SHOW_VERSION = 'gedcom.showVersion';

/** Names for what the file actually says, which is not always what we validate against. */
function describe(analysis: Analysis): { text: string; detail: string; uncertain: boolean } {
  const version = analysis.version;

  switch (analysis.versionSource) {
    case 'declared':
      return {
        text: `GEDCOM ${version}`,
        detail:
          `This file declares version **${version}** in \`HEAD.GEDC.VERS\`, ` +
          'which is what its structure is checked against.',
        uncertain: false,
      };
    case 'inferred':
      return {
        text: `GEDCOM ${version}?`,
        detail:
          `This file declares no version in \`HEAD.GEDC.VERS\`, so **${version}** was inferred ` +
          'from the tags it uses. Adding a version to the header will make validation exact.',
        uncertain: true,
      };
    default:
      return {
        text: 'GEDCOM version unknown',
        detail:
          'This file declares no version in `HEAD.GEDC.VERS`, and its vocabulary was not ' +
          'conclusive either. It is being checked leniently against 5.5.1, the safer ' +
          'assumption for a file of unknown age.',
        uncertain: true,
      };
  }
}

/** Counts worth seeing at a glance, appended to the tooltip. */
function contents(analysis: Analysis): string {
  const counts = new Map<string, number>();
  for (const record of analysis.document.records) {
    counts.set(record.tag, (counts.get(record.tag) ?? 0) + 1);
  }

  const interesting = [...counts]
    .filter(([tag]) => tag !== 'HEAD' && tag !== 'TRLR')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => `${count.toLocaleString()} ${tag}`);

  return interesting.length > 0 ? interesting.join(' · ') : 'No records.';
}

export function registerVersionStatus(context: ExtensionContext): void {
  const item = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  item.command = SHOW_VERSION;

  let current = '';

  const update = (editor: TextEditor | undefined): void => {
    if (!editor || editor.document.languageId !== 'gedcom') {
      item.hide();
      return;
    }

    const analysis = analysisOf(editor.document);
    const { text, detail, uncertain } = describe(analysis);

    item.text = `$(versions) ${text}`;
    // A guessed version is not an error, but it is worth noticing: it changes
    // which rules apply to every line in the file.
    item.backgroundColor = uncertain
      ? new ThemeColor('statusBarItem.warningBackground')
      : undefined;

    const tooltip = new MarkdownString(`${detail}\n\n${contents(analysis)}`);
    tooltip.supportThemeIcons = true;
    item.tooltip = tooltip;

    current = `${detail}\n\n${contents(analysis)}`;
    item.show();
  };

  context.subscriptions.push(
    item,
    commands.registerCommand(SHOW_VERSION, () => {
      // Strip the markdown emphasis; a notification renders none of it.
      void window.showInformationMessage(current.replace(/[*`]/g, ''), { modal: false });
    }),
    window.onDidChangeActiveTextEditor(update),
    workspace.onDidChangeTextDocument((event) => {
      const editor = window.activeTextEditor;
      if (editor && event.document === editor.document) update(editor);
    }),
  );

  update(window.activeTextEditor);
}
