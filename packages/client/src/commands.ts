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
  Location,
  Position,
  Range,
  Selection,
  Uri,
  window,
  workspace,
  type ExtensionContext,
} from 'vscode';

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
  lifespan,
  recordAt,
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
        void window.showInformationMessage('Open a GEDCOM file to upgrade it to GEDCOM 7.0.');
        return;
      }

      const text = editor.document.getText();
      const result = upgradeToGedcom7(text);
      if (result.modifications === 0) {
        void window.showInformationMessage(
          'File is already aligned with GEDCOM 7.0 (0 changes needed).',
        );
        return;
      }

      const fullRange = new Range(new Position(0, 0), new Position(editor.document.lineCount, 0));

      const applied = await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, result.text);
      });

      if (applied) {
        void window.showInformationMessage(
          `Successfully modernized file to GEDCOM 7.0 (${result.modifications} modifications applied).`,
        );
      }
    }),
    commands.registerCommand('gedcom.findRelationship', async () => {
      const editor = window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'gedcom') {
        void window.showInformationMessage('Open a GEDCOM file to calculate relationships.');
        return;
      }

      const text = editor.document.getText();
      const analysis = analyzeText(text);

      const individuals: { label: string; description: string; xref: string }[] = [];
      for (const [xref, structure] of analysis.xrefs.definitions) {
        if (structure.tag !== 'INDI') continue;
        const name =
          structure.children
            .find((c) => c.tag === 'NAME')
            ?.payload?.replace(/\//g, '')
            .trim() || 'Unknown';
        const span = lifespan(analysis, xref);
        individuals.push({
          label: name,
          description: `${xref}${span ? ` (${span})` : ''}`,
          xref,
        });
      }

      if (individuals.length < 2) {
        void window.showInformationMessage(
          'At least two individual records are required to calculate relationships.',
        );
        return;
      }

      const currentXref = recordAt(analysis, editor.selection.active.line);
      const isIndi = currentXref && analysis.xrefs.definitions.get(currentXref)?.tag === 'INDI';
      let personA = isIndi ? individuals.find((i) => i.xref === currentXref) : undefined;

      if (!personA) {
        const pickedA = await window.showQuickPick(individuals, {
          placeHolder: 'Select the first individual (Person A)',
          matchOnDescription: true,
        });
        if (!pickedA) return;
        personA = pickedA;
      }

      const remaining = individuals.filter((i) => i.xref !== personA!.xref);
      const pickedB = await window.showQuickPick(remaining, {
        placeHolder: `Select the second individual to compare with ${personA.label}`,
        matchOnDescription: true,
      });
      if (!pickedB) return;

      const kinship = calculateKinship(analysis, personA.xref, pickedB.xref);
      if (!kinship) {
        void window.showInformationMessage(
          `No genealogical relationship found between ${personA.label} and ${pickedB.label}.`,
        );
        return;
      }

      const showBtn = 'Show Path in Tree';
      const commonStr =
        kinship.commonAncestors.length > 0
          ? ` (Common Ancestor: ${kinship.commonAncestors
              .map(
                (x) =>
                  analysis.xrefs.definitions
                    .get(x)
                    ?.children.find((c) => c.tag === 'NAME')
                    ?.payload?.replace(/\//g, '')
                    .trim() || x,
              )
              .join(' & ')})`
          : '';

      const response = await window.showInformationMessage(
        `${pickedB.label} is the ${kinship.relationship} of ${personA.label}.${commonStr}`,
        showBtn,
      );

      if (response === showBtn) {
        await commands.executeCommand('gedcom.showGraph');
        await commands.executeCommand('gedcom.highlightPath', kinship.path);
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
