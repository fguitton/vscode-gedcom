import { describe, expect, it } from 'vitest';
import { analyzeDocument, codeActions, diagnostics } from '../src/features.ts';

const URI = 'file:///tree.ged';

describe('codeActions', () => {
  it('offers quick fixes to insert a missing trailer', () => {
    const source = '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 NAME John /Smith/';
    const analysis = analyzeDocument(source);
    const diags = diagnostics(analysis);
    const missingTrailerDiag = diags.find((d) => d.code === 'missing-trailer');
    expect(missingTrailerDiag).toBeDefined();

    const actions = codeActions(analysis, URI, missingTrailerDiag!.range, {
      diagnostics: [missingTrailerDiag!],
    });

    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0]!.title).toBe('Insert 0 TRLR at end of file');
    expect(actions[0]!.edit?.changes?.[URI]?.[0]?.newText).toBe('\n0 TRLR\n');
  });

  it('offers quick fixes to insert a missing header', () => {
    const source = '0 @I1@ INDI\n1 NAME John /Smith/\n0 TRLR';
    const analysis = analyzeDocument(source);
    const diags = diagnostics(analysis);
    const missingHeaderDiag = diags.find((d) => d.code === 'missing-header');
    expect(missingHeaderDiag).toBeDefined();

    const actions = codeActions(analysis, URI, missingHeaderDiag!.range, {
      diagnostics: [missingHeaderDiag!],
    });

    expect(actions.length).toBe(2);
    expect(actions.map((a) => a.title)).toEqual([
      'Insert GEDCOM 7.0 header',
      'Insert GEDCOM 5.5.1 header',
    ]);
  });

  it('offers quick fixes for dangling pointers', () => {
    const source = '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 FAMS @F99@\n0 TRLR';
    const analysis = analyzeDocument(source);
    const diags = diagnostics(analysis);
    const danglingDiag = diags.find((d) => d.code === 'dangling-pointer');
    expect(danglingDiag).toBeDefined();

    const actions = codeActions(analysis, URI, danglingDiag!.range, {
      diagnostics: [danglingDiag!],
    });

    expect(actions.length).toBe(2);
    expect(actions.map((a) => a.title)).toEqual([
      'Replace with @VOID@',
      'Create new FAM record for @F99@',
    ]);
  });

  it('offers quick fixes for leading whitespace', () => {
    const source = '0 HEAD\n1 GEDC\n2 VERS 7.0\n  0 @I1@ INDI\n0 TRLR';
    const analysis = analyzeDocument(source);
    const diags = diagnostics(analysis);
    const wsDiag = diags.find((d) => d.code === 'leading-whitespace');
    expect(wsDiag).toBeDefined();

    const actions = codeActions(analysis, URI, wsDiag!.range, {
      diagnostics: [wsDiag!],
    });

    expect(actions.length).toBe(1);
    expect(actions[0]!.title).toBe('Remove leading whitespace');
  });

  it('offers quick fixes for deprecated RELA tag in GEDCOM 7', () => {
    const source = '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 ASSO @I2@\n2 RELA GODP\n0 TRLR';
    const analysis = analyzeDocument(source);
    const diags = diagnostics(analysis);
    const relaDiag = diags.find((d) => d.code === 'removed-in-version' && d.range.start.line === 5);
    expect(relaDiag).toBeDefined();

    const actions = codeActions(analysis, URI, relaDiag!.range, {
      diagnostics: [relaDiag!],
    });

    expect(actions.length).toBe(1);
    expect(actions[0]!.title).toBe('Convert RELA to ROLE (GEDCOM 7)');
  });

  it('offers quick fixes for exporter-repair orphan lines', () => {
    const source = [
      '0 HEAD',
      '1 SOUR MYHERITAGE',
      '2 VERS 1.0',
      '0 @I1@ INDI',
      '1 NOTE First line of note',
      'second line without level',
      '0 TRLR',
    ].join('\n');

    const analysis = analyzeDocument(source);
    const diags = diagnostics(analysis);
    const repairDiag = diags.find((d) => d.code === 'exporter-repair');
    expect(repairDiag).toBeDefined();

    const actions = codeActions(analysis, URI, repairDiag!.range, {
      diagnostics: [repairDiag!],
    });

    expect(actions.length).toBe(1);
    expect(actions[0]!.title).toBe('Prefix line with 2 CONT');
    expect(actions[0]!.edit?.changes?.[URI]?.[0]?.newText).toBe('2 CONT ');
  });
});
