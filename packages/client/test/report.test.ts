/**
 * The words a bug report is made of.
 *
 * Asserted here rather than looked at in a channel, because every line is
 * written to be pasted into a public issue: what it says has to be right, and
 * what it leaves out has to stay out.
 */

import { describe, expect, it } from 'vitest';

import {
  describeDiagnostics,
  describeEnvironment,
  describeFile,
  describeInvocation,
  describeNothingOnScreen,
  describePanel,
  describeSettings,
  describeSubject,
  type Environment,
} from '../src/report.ts';

const ENVIRONMENT: Environment = {
  extension: '0.8.1',
  editor: '1.134.0-insider',
  appName: 'Visual Studio Code - Insiders',
  host: 'node',
  platform: 'linux',
  remote: undefined,
  folders: 0,
  trusted: true,
  documents: 1,
};

describe('the environment', () => {
  it('names the build, the host and the platform', () => {
    const [first] = describeEnvironment(ENVIRONMENT);
    expect(first).toContain('GEDCOM 0.8.1');
    expect(first).toContain('Visual Studio Code - Insiders 1.134.0-insider');
    expect(first).toContain('node host');
    expect(first).toContain('linux');
    expect(first).toContain('remote: none');
  });

  it('says when no folder is open, which a single file is', () => {
    const [, second] = describeEnvironment(ENVIRONMENT);
    expect(second).toContain('no folder open');
    expect(second).toContain('1 GEDCOM document open');
  });

  it('counts folders and documents in the plural', () => {
    const [, second] = describeEnvironment({ ...ENVIRONMENT, folders: 2, documents: 3 });
    expect(second).toContain('2 folders');
    expect(second).toContain('3 GEDCOM documents open');
  });

  it('names the remote where there is one', () => {
    const [first] = describeEnvironment({ ...ENVIRONMENT, remote: 'wsl' });
    expect(first).toContain('remote: wsl');
  });
});

describe('settings', () => {
  it('says so when nothing has been changed', () => {
    const text = describeSettings([
      { key: 'gedcom.graph.depth', value: 2, fallback: 2 },
      { key: 'gedcom.codeLens.enabled', value: true, fallback: true },
    ]);
    expect(text).toBe('Settings: every one at its default');
  });

  it('names only the ones that differ', () => {
    const text = describeSettings([
      { key: 'gedcom.graph.depth', value: 4, fallback: 2 },
      { key: 'gedcom.codeLens.enabled', value: true, fallback: true },
    ]);
    expect(text).toBe('Settings away from default: gedcom.graph.depth=4');
  });

  it('reports a setting the editor never registered', () => {
    // `undefined` is what `inspect` gives for a key VS Code does not know, which
    // is the shape of an extension whose manifest did not take.
    const text = describeSettings([
      { key: 'gedcom.virtualIndent.enabled', value: undefined, fallback: undefined },
    ]);
    expect(text).toBe('Settings: every one at its default');
  });
});

describe('where a command came from', () => {
  it('reads a code lens from a URI string and a line', () => {
    expect(describeInvocation('file:///tree.ged', 12)).toBe('a code lens');
  });

  it('reads the title bar from a resource and a menu context', () => {
    expect(describeInvocation({ path: '/tree.ged' }, { groupId: 1, editorIndex: 0 })).toBe(
      'the editor title bar',
    );
  });

  it('reads the palette from nothing at all', () => {
    expect(describeInvocation(undefined, undefined)).toBe('the command palette');
  });
});

describe('naming a file', () => {
  it('gives the basename and never the path', () => {
    const text = describeFile('/home/beedell.roke_julian_lockhart/Downloads/royal92.ged', 'file');
    expect(text).toBe('royal92.ged');
    expect(text).not.toContain('home');
  });

  it('names the scheme where it is not a file on disk', () => {
    expect(describeFile('/tree.ged', 'untitled')).toBe('tree.ged (untitled)');
  });
});

describe('what the panels are about', () => {
  it('names the subject and whether it is the active editor', () => {
    expect(describeSubject({ file: 'royal92.ged', active: true })).toBe(
      'Subject: royal92.ged, the active editor',
    );
  });

  it('distinguishes a file merely visible beside another', () => {
    expect(describeSubject({ file: 'royal92.ged', active: false })).toContain('visible beside it');
  });

  it('counts what was on screen when there was nothing to draw', () => {
    expect(describeNothingOnScreen({ visible: 3, documents: 1 })).toBe(
      'No GEDCOM editor on screen (3 visible editors, 1 open)',
    );
  });

  it('describes the panel in each of its states', () => {
    expect(describePanel(false, undefined)).toBe('Tree not on screen');
    expect(describePanel(true, undefined)).toContain('nothing drawn yet');
    expect(describePanel(true, { focus: null, nodes: 0 })).toContain('drawing nothing');
    expect(describePanel(true, { focus: 'I9', nodes: 31 })).toBe(
      'Tree on screen, drawing @I9@ with 31 nodes',
    );
  });
});

describe('the diagnostics block', () => {
  const block = describeDiagnostics({
    when: '2026-08-15 11:59:03',
    environment: ENVIRONMENT,
    settings: [{ key: 'gedcom.graph.depth', value: 4, fallback: 2 }],
    logLevel: 'Info',
    panel: 'Tree not on screen',
    recent: ['2026-08-15 11:58:01 [info] Show Tree invoked from the editor title bar'],
  });

  it('leads with the question every report has to answer', () => {
    expect(block.split('\n')[0]).toContain('GEDCOM diagnostics');
    expect(block).toContain('GEDCOM 0.8.1');
  });

  it('carries the log level, since it decides what the log holds', () => {
    expect(block).toContain('Log level: Info');
  });

  it('carries the settings, the panel state and the recent log', () => {
    expect(block).toContain('gedcom.graph.depth=4');
    expect(block).toContain('Panels: Tree not on screen');
    expect(block).toContain('Show Tree invoked from the editor title bar');
  });

  it('leaves out the log entirely when there is none', () => {
    const quiet = describeDiagnostics({
      when: '2026-08-15 11:59:03',
      environment: ENVIRONMENT,
      settings: [],
      logLevel: 'Info',
      panel: 'Tree not on screen',
      recent: [],
    });
    expect(quiet).not.toContain('Recent log');
  });
});
