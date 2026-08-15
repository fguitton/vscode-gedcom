/**
 * Modernizes a legacy GEDCOM (5.5 / 5.5.1 / 5.5.5) file to GEDCOM 7.0 standard.
 *
 * Transformations:
 * 1. Updates HEAD.GEDC.VERS to 7.0.
 * 2. Removes legacy HEAD.CHAR (GEDCOM 7 mandates UTF-8 without CHAR).
 * 3. Converts CONC continuation lines to CONT.
 * 4. Converts legacy RELA tags to ROLE.
 * 5. Synthesizes HEAD.SCHMA for any custom extension tags (_TAG) present in the file.
 * 6. Ensures standard trailing 0 TRLR.
 */

import { parse } from './parser.ts';

export interface ModernizeResult {
  readonly text: string;
  readonly modifications: number;
}

export function upgradeToGedcom7(input: string): ModernizeResult {
  const lines = input.split(/\r?\n/);
  let modifications = 0;
  const newLines: string[] = [];

  const doc = parse(input);
  const head = doc.records.find((r) => r.tag === 'HEAD');

  // Collect all unique extension tags (_TAG)
  const extensionTags = new Set<string>();
  for (const s of doc.structures) {
    if (s.tag.startsWith('_')) {
      extensionTags.add(s.tag);
    }
  }

  let inHead = false;
  let hasGedc = false;
  let hasVers7 = false;
  let hasSchma = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();

    if (/^0\s+HEAD\b/i.test(trimmed)) {
      inHead = true;
      newLines.push('0 HEAD');
      continue;
    }

    if (inHead && /^0\s+/i.test(trimmed)) {
      inHead = false;
    }

    if (inHead) {
      // Check for CHAR tag in HEAD -> remove in 7.0
      if (/^1\s+CHAR\b/i.test(trimmed)) {
        modifications++;
        continue;
      }

      // Check for GEDC.VERS
      if (/^1\s+GEDC\b/i.test(trimmed)) {
        hasGedc = true;
      }
      if (/^2\s+VERS\s+/i.test(trimmed)) {
        if (!/^2\s+VERS\s+7\.0\b/i.test(trimmed)) {
          newLines.push('2 VERS 7.0');
          hasVers7 = true;
          modifications++;
          continue;
        }
        hasVers7 = true;
      }

      // Check for SCHMA
      if (/^1\s+SCHMA\b/i.test(trimmed)) {
        hasSchma = true;
      }
    }

    // Convert CONC to CONT
    const concMatch = /^(\d+)\s+CONC(\s.*)?$/i.exec(rawLine);
    if (concMatch) {
      newLines.push(`${concMatch[1]} CONT${concMatch[2] ?? ''}`);
      modifications++;
      continue;
    }

    // Convert RELA to ROLE
    const relaMatch = /^(\d+)\s+RELA(\s.*)?$/i.exec(rawLine);
    if (relaMatch) {
      newLines.push(`${relaMatch[1]} ROLE${relaMatch[2] ?? ''}`);
      modifications++;
      continue;
    }

    newLines.push(rawLine);
  }

  // If HEAD had no GEDC or VERS 7.0, insert it
  if (head && !hasVers7) {
    // Find index after 0 HEAD
    const headIdx = newLines.findIndex((l) => /^0\s+HEAD\b/i.test(l));
    if (headIdx >= 0) {
      if (!hasGedc) {
        newLines.splice(headIdx + 1, 0, '1 GEDC', '2 VERS 7.0');
      } else {
        const gedcIdx = newLines.findIndex((l, idx) => idx > headIdx && /^1\s+GEDC\b/i.test(l));
        if (gedcIdx >= 0) {
          newLines.splice(gedcIdx + 1, 0, '2 VERS 7.0');
        }
      }
      modifications++;
    }
  }

  // If there are extension tags and no SCHMA, insert SCHMA under HEAD
  if (head && extensionTags.size > 0 && !hasSchma) {
    const headIdx = newLines.findIndex((l) => /^0\s+HEAD\b/i.test(l));
    if (headIdx >= 0) {
      const schmaBlock = ['1 SCHMA'];
      for (const tag of [...extensionTags].sort()) {
        schmaBlock.push(`2 TAG ${tag} http://gedcom.io/terms/v7/${tag}`);
      }
      newLines.splice(headIdx + 1, 0, ...schmaBlock);
      modifications++;
    }
  }

  // Ensure trailing 0 TRLR
  const lastNonEmpty = [...newLines].reverse().find((l) => l.trim().length > 0);
  if (!lastNonEmpty || !/^0\s+TRLR\b/i.test(lastNonEmpty.trim())) {
    newLines.push('0 TRLR');
    modifications++;
  }

  let result = newLines.join('\n');
  if (!result.endsWith('\n')) result += '\n';

  return { text: result, modifications };
}
