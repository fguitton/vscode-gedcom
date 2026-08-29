/**
 * Commands a code lens can invoke.
 *
 * A lens sent by the language server carries its arguments as plain JSON, and
 * VS Code's own commands take real `Uri`, `Position` and `Location` objects. There
 * is no automatic conversion between the two, so a lens cannot call a built-in
 * command directly — the usual remedy, and the one used here, is a thin
 * client-side command that rebuilds the objects and forwards.
 */

import {
  commands,
  env,
  Location,
  Position,
  Range,
  Selection,
  Uri,
  window,
  workspace,
  type ExtensionContext,
} from 'vscode';
import { t } from './l10n.ts';

/** Shape the server sends: LSP ranges, which are structurally plain objects. */
interface RawRange {
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
}

const toPosition = (raw: RawRange['start']): Position => new Position(raw.line, raw.character);

const toRange = (raw: RawRange): Range => new Range(toPosition(raw.start), toPosition(raw.end));

import {
  analyzeText,
  calculateKinship,
  displayName,
  gedcomToGedcomX,
  gedcomXToGedcom7,
  isGedcomX,
  lifespan,
  recordAt,
  toGedcomXJson,
  upgradeToGedcom7,
} from '@vscode-gedcom/core';

export function registerCommands(context: ExtensionContext): void {
  context.subscriptions.push(
    commands.registerCommand(
      'gedcom.showReferences',
      (uri: string, at: RawRange['start'], ranges: RawRange[]) => {
        const target = Uri.parse(uri);
        void commands.executeCommand(
          'editor.action.showReferences',
          target,
          toPosition(at),
          ranges.map((range) => new Location(target, toRange(range))),
        );
      },
    ),
    commands.registerCommand('gedcom.upgradeToGedcom7', async () => {
      const editor = window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'gedcom') {
        void window.showInformationMessage(t('Open a GEDCOM file to upgrade it to GEDCOM 7.0.'));
        return;
      }

      const text = editor.document.getText();
      const result = upgradeToGedcom7(text);
      if (result.modifications === 0) {
        void window.showInformationMessage(
          t('File is already aligned with GEDCOM 7.0 (0 changes needed).'),
        );
        return;
      }

      const fullRange = new Range(new Position(0, 0), new Position(editor.document.lineCount, 0));

      const applied = await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, result.text);
      });

      if (applied) {
        void window.showInformationMessage(
          t(
            'Successfully modernized file to GEDCOM 7.0 ({0} modifications applied).',
            result.modifications,
          ),
        );
      }
    }),
    commands.registerCommand('gedcom.convertGedcomXToGedcom7', async () => {
      const editor = window.activeTextEditor;
      const text = editor?.document.getText() ?? '';
      if (!editor || (!isGedcomX(text) && editor.document.languageId !== 'gedcom')) {
        void window.showInformationMessage(t('Open a GEDCOM X file to convert it to GEDCOM 7.0.'));
        return;
      }

      try {
        const gedcom7 = gedcomXToGedcom7(text);
        const doc = await workspace.openTextDocument({
          language: 'gedcom',
          content: gedcom7,
        });
        await window.showTextDocument(doc);
        void window.showInformationMessage(t('Successfully converted GEDCOM X to GEDCOM 7.0.'));
      } catch (err) {
        void window.showErrorMessage(`Failed to convert GEDCOM X: ${String(err)}`);
      }
    }),
    commands.registerCommand('gedcom.exportAsGedcomX', async () => {
      const editor = window.activeTextEditor;
      if (!editor) {
        void window.showInformationMessage(t('Open a GEDCOM file to export it to GEDCOM X JSON.'));
        return;
      }

      try {
        const text = editor.document.getText();
        const gx = isGedcomX(text) ? JSON.parse(text) : gedcomToGedcomX(text);
        const jsonText = toGedcomXJson(gx, true);
        const doc = await workspace.openTextDocument({
          language: 'json',
          content: jsonText,
        });
        await window.showTextDocument(doc);
        void window.showInformationMessage(t('Successfully exported to GEDCOM X JSON.'));
      } catch (err) {
        void window.showErrorMessage(`Failed to export as GEDCOM X: ${String(err)}`);
      }
    }),
    commands.registerCommand('gedcom.findRelationship', async () => {
      const editor = window.activeTextEditor;
      const text = editor?.document.getText() ?? '';
      if (!editor || (editor.document.languageId !== 'gedcom' && !isGedcomX(text))) {
        void window.showInformationMessage(t('Open a GEDCOM file to calculate relationships.'));
        return;
      }

      const analysis = analyzeText(text);

      const individuals: { label: string; description: string; xref: string }[] = [];
      for (const [xref, structure] of analysis.xrefs.definitions) {
        if (structure.tag !== 'INDI') continue;
        const namePayload = structure.children.find((c) => c.tag === 'NAME')?.payload;
        const name = namePayload ? displayName(namePayload) : 'Unknown';
        const span = lifespan(analysis, xref);
        individuals.push({
          label: name,
          description: `${xref}${span ? ` (${span})` : ''}`,
          xref,
        });
      }

      if (individuals.length < 2) {
        void window.showInformationMessage(
          t('At least two individual records are required to calculate relationships.'),
        );
        return;
      }

      const currentXref = recordAt(analysis, editor.selection.active.line);
      const isIndi = currentXref && analysis.xrefs.definitions.get(currentXref)?.tag === 'INDI';
      let personA = isIndi ? individuals.find((i) => i.xref === currentXref) : undefined;

      if (!personA) {
        const pickedA = await window.showQuickPick(individuals, {
          placeHolder: t('Select the first individual (Person A)'),
          matchOnDescription: true,
        });
        if (!pickedA) return;
        personA = pickedA;
      }

      const remaining = individuals.filter((i) => i.xref !== personA!.xref);
      const pickedB = await window.showQuickPick(remaining, {
        placeHolder: t('Select the second individual to compare with {0}', personA.label),
        matchOnDescription: true,
      });
      if (!pickedB) return;

      const kinship = calculateKinship(analysis, personA.xref, pickedB.xref, {
        locale: env.language,
      });
      if (!kinship) {
        void window.showInformationMessage(
          t(
            'No genealogical relationship found between {0} and {1}.',
            personA.label,
            pickedB.label,
          ),
        );
        return;
      }

      const showBtn = t('Show Path in Tree');
      const response = await window.showInformationMessage(kinship.description, showBtn);

      if (response === showBtn) {
        const primaryFocus = kinship.commonAncestors[0] || kinship.path[0];
        await commands.executeCommand('gedcom.showGraph');
        await commands.executeCommand('gedcom.highlightPath', kinship.path, primaryFocus);
      }
    }),
  );
}

/**
 * Moves the cursor to a line, so a lens can act on the record it sits above.
 *
 * Clicking a lens does not move the selection, and the graph panel follows the
 * selection — without this, a `graph` lens on one record would show whichever
 * record the cursor happened to be in.
 */
export async function revealLine(uri: string, line: number): Promise<void> {
  const document = await workspace.openTextDocument(Uri.parse(uri));
  const editor = await window.showTextDocument(document, { preserveFocus: false });
  const position = new Position(line, 0);
  editor.selection = new Selection(position, position);
  editor.revealRange(new Range(position, position));
}
