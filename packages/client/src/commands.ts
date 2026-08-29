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
  extractGdz,
  findLocalMediaReferences,
  gedcomToGedcomX,
  gedcomXToGedcom7,
  isGedcomX,
  lifespan,
  packageGdz,
  recordAt,
  toGedcomXJson,
  upgradeToGedcom7,
} from '@vscode-gedcom/core';
import { toGdzUri } from './gdz-fs.ts';

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
    commands.registerCommand('gedcom.packageGdz', async (fileUri?: Uri) => {
      let targetDocUri = fileUri;
      let text = '';

      if (!targetDocUri) {
        const editor = window.activeTextEditor;
        if (editor && editor.document.languageId === 'gedcom') {
          targetDocUri = editor.document.uri;
          text = editor.document.getText();
        }
      }

      if (!targetDocUri) {
        const picked = await window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { 'GEDCOM Files': ['ged', 'gedcom'] },
          openLabel: t('Select GEDCOM File to Package'),
        });
        if (!picked || picked.length === 0) return;
        targetDocUri = picked[0];
      }

      if (!targetDocUri) return;

      if (!text) {
        const bytes = await workspace.fs.readFile(targetDocUri);
        text = new TextDecoder('utf-8').decode(bytes);
      }

      try {
        const localRefs = findLocalMediaReferences(text);
        const files = new Map<string, Uint8Array>();
        const docDir = Uri.joinPath(targetDocUri, '..');
        const missing: string[] = [];

        for (const ref of localRefs) {
          try {
            let mediaUri: Uri;
            if (ref.startsWith('file://')) {
              mediaUri = Uri.parse(ref);
            } else if (/^[a-zA-Z]:[\\/]/.test(ref) || ref.startsWith('/')) {
              mediaUri = Uri.file(ref);
            } else {
              mediaUri = Uri.joinPath(docDir, ref);
            }
            const data = await workspace.fs.readFile(mediaUri);
            files.set(ref, data);
          } catch {
            missing.push(ref);
          }
        }

        if (missing.length > 0) {
          const proceed = await window.showWarningMessage(
            t(
              'Could not find {0} referenced media file(s) on disk. Package anyway without them?',
              missing.length,
            ),
            t('Package Anyway'),
            t('Cancel'),
          );
          if (proceed !== t('Package Anyway')) return;
        }

        const gdzBytes = packageGdz({
          gedcomText: text,
          files,
        });

        const defaultSavePath = targetDocUri.path.replace(/\.(ged|gedcom)$/i, '') + '.gdz';
        const defaultSaveUri = targetDocUri.with({ path: defaultSavePath });

        const saveUri = await window.showSaveDialog({
          defaultUri: defaultSaveUri,
          filters: { 'GEDZIP Archive': ['gdz'] },
          saveLabel: t('Save GEDZIP Archive'),
        });

        if (!saveUri) return;

        await workspace.fs.writeFile(saveUri, gdzBytes);

        const openBtn = t('Open Archive');
        const response = await window.showInformationMessage(
          t('Successfully packaged GEDZIP archive with {0} media file(s).', files.size),
          openBtn,
        );

        if (response === openBtn) {
          await commands.executeCommand('gedcom.openGdz', saveUri);
        }
      } catch (err) {
        void window.showErrorMessage(t('Failed to package GEDZIP archive: {0}', String(err)));
      }
    }),
    commands.registerCommand('gedcom.unpackGdz', async (fileUri?: Uri) => {
      let sourceGdzUri = fileUri;
      if (!sourceGdzUri) {
        const picked = await window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { 'GEDZIP Archives': ['gdz', 'zip'] },
          openLabel: t('Select GEDZIP File to Unpack'),
        });
        if (!picked || picked.length === 0) return;
        sourceGdzUri = picked[0];
      }

      if (!sourceGdzUri) return;

      const destFolders = await window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: t('Select Extraction Folder'),
      });
      if (!destFolders || destFolders.length === 0) return;
      const targetFolder = destFolders[0];
      if (!targetFolder) return;

      try {
        const rawBytes = await workspace.fs.readFile(sourceGdzUri);
        const { gedcomPath, files } = extractGdz(rawBytes);

        for (const [relPath, fileBytes] of files.entries()) {
          const destFileUri = Uri.joinPath(targetFolder, relPath);
          await workspace.fs.writeFile(destFileUri, fileBytes);
        }

        const mainDocUri = Uri.joinPath(targetFolder, gedcomPath);
        const doc = await workspace.openTextDocument(mainDocUri);
        await window.showTextDocument(doc);

        void window.showInformationMessage(
          t('Successfully unpacked {0} files from GEDZIP archive.', files.size),
        );
      } catch (err) {
        void window.showErrorMessage(t('Failed to unpack GEDZIP archive: {0}', String(err)));
      }
    }),
    commands.registerCommand('gedcom.openGdz', async (fileUri?: Uri) => {
      let gdzUri = fileUri;
      if (!gdzUri) {
        const picked = await window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { 'GEDZIP Archives': ['gdz'] },
          openLabel: t('Open GEDZIP Archive'),
        });
        if (!picked || picked.length === 0) return;
        gdzUri = picked[0];
      }

      if (!gdzUri) return;

      try {
        const virtualUri = toGdzUri(gdzUri, 'gedcom.ged');
        const doc = await workspace.openTextDocument(virtualUri);
        await window.showTextDocument(doc);
      } catch (err) {
        void window.showErrorMessage(t('Failed to open GEDZIP archive: {0}', String(err)));
      }
    }),
    commands.registerCommand('gedcom.mountGdz', async (fileUri?: Uri) => {
      let gdzUri = fileUri;
      if (!gdzUri) {
        const picked = await window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { 'GEDZIP Archives': ['gdz'] },
          openLabel: t('Select GEDZIP Archive to Mount'),
        });
        if (!picked || picked.length === 0) return;
        gdzUri = picked[0];
      }

      if (!gdzUri) return;

      const virtualRoot = toGdzUri(gdzUri, '');
      const archiveName = gdzUri.path.split('/').filter(Boolean).pop() ?? 'archive.gdz';
      const currentCount = workspace.workspaceFolders ? workspace.workspaceFolders.length : 0;

      const alreadyMounted = workspace.workspaceFolders?.some(
        (wf) => wf.uri.toString() === virtualRoot.toString(),
      );
      if (alreadyMounted) {
        void window.showInformationMessage(
          t('Archive {0} is already mounted in workspace.', archiveName),
        );
        return;
      }

      const success = workspace.updateWorkspaceFolders(currentCount, 0, {
        uri: virtualRoot,
        name: `GEDZIP: ${archiveName}`,
      });

      if (success) {
        void window.showInformationMessage(t('Mounted {0} in Explorer.', archiveName));
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
