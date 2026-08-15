/**
 * What the extension says about itself, in words a reader can paste into an
 * issue.
 *
 * Kept apart from the log itself, and free of any VS Code import, so every line
 * that will end up in somebody's bug report can be asserted on directly.
 *
 * Two rules govern everything here. A file is named by its basename and scheme
 * and never by its path — a home directory carries the reader's name, and this
 * text is written to be published. And nothing a GEDCOM file *contains* is
 * reported: this extension reads dates of birth and family relationships, none
 * of which belong in a diagnostic. Counts, tags and cross-reference identifiers
 * are the whole of what may be said about a document's contents.
 */

export interface Environment {
  /** The extension's own version, from its manifest. */
  readonly extension: string;
  readonly editor: string;
  readonly appName: string;
  readonly host: 'node' | 'browser';
  readonly platform: string;
  /** The remote authority's name, where the window is not local. */
  readonly remote?: string | undefined;
  readonly folders: number;
  readonly trusted: boolean;
  readonly documents: number;
}

/** The header of any report: which build of what is running where. */
export function describeEnvironment(environment: Environment): string[] {
  const { extension, editor, appName, host, platform, remote, folders, trusted, documents } =
    environment;

  const workspace =
    folders === 0 ? 'no folder open' : folders === 1 ? '1 folder' : `${folders} folders`;

  return [
    `GEDCOM ${extension} on ${appName} ${editor} — ${host} host, ${platform}, ` +
      `remote: ${remote ?? 'none'}`,
    `Workspace: ${workspace}, ${trusted ? 'trusted' : 'not trusted'} · ` +
      `${documents} GEDCOM ${documents === 1 ? 'document' : 'documents'} open`,
  ];
}

export interface SettingReading {
  readonly key: string;
  readonly value: unknown;
  readonly fallback: unknown;
}

/**
 * The settings in force, named only where they differ from the default.
 *
 * A reader's whole configuration is a dozen lines of mostly nothing; what
 * matters is the handful they changed.
 */
export function describeSettings(readings: readonly SettingReading[]): string {
  const changed = readings.filter(
    (reading) => JSON.stringify(reading.value) !== JSON.stringify(reading.fallback),
  );
  if (changed.length === 0) return 'Settings: every one at its default';

  const named = changed.map((reading) => `${reading.key}=${JSON.stringify(reading.value)}`);
  return `Settings away from default: ${named.join(', ')}`;
}

/**
 * Where a command came from, read from the shape of its arguments.
 *
 * A menu never invokes a command bare: the editor title bar sends the resource
 * and its own context, while a code lens sends a URI string and a line number.
 */
export function describeInvocation(target: unknown, at: unknown): string {
  if (typeof target === 'string' && typeof at === 'number') return 'a code lens';
  if (target !== undefined && target !== null) return 'the editor title bar';
  return 'the command palette';
}

/** A file as it may be named in a report: what it is called, and where it lives. */
export function describeFile(path: string, scheme: string): string {
  const name = path.split('/').filter(Boolean).pop() ?? path;
  return scheme === 'file' ? name : `${name} (${scheme})`;
}

export interface Subject {
  readonly file: string;
  readonly active: boolean;
}

/** Which GEDCOM file a panel is about. */
export function describeSubject(subject: Subject): string {
  return `Subject: ${subject.file}, ${subject.active ? 'the active editor' : 'visible beside it'}`;
}

/**
 * Why a panel is about no file at all, with the counts that tell a reader who
 * closed their last GEDCOM file from one looking straight at one.
 */
export function describeNothingOnScreen(context: {
  readonly visible: number;
  readonly documents: number;
}): string {
  return (
    `No GEDCOM editor on screen (${context.visible} visible ` +
    `${context.visible === 1 ? 'editor' : 'editors'}, ${context.documents} open)`
  );
}

/** What the tree panel is doing, for a report and for the log. */
export function describePanel(
  visible: boolean,
  drawn: { focus: string | null; nodes: number } | undefined,
): string {
  if (!visible) return 'Tree not on screen';
  if (!drawn) return 'Tree on screen, nothing drawn yet';
  if (drawn.focus === null) return 'Tree on screen, drawing nothing';
  return `Tree on screen, drawing @${drawn.focus}@ with ${drawn.nodes} nodes`;
}

export interface Diagnostics {
  readonly when: string;
  readonly environment: Environment;
  readonly settings: readonly SettingReading[];
  readonly logLevel: string;
  readonly panel: string;
  readonly recent: readonly string[];
}

/**
 * The block a reader is asked to paste into an issue.
 *
 * Everything in it is state we can state with certainty, plus the recent log.
 * It is assembled without asking the reader to reproduce anything, because the
 * first question about a bug report is which build it came from and the reader
 * should not have to go looking.
 */
export function describeDiagnostics(diagnostics: Diagnostics): string {
  const { when, environment, settings, logLevel, panel, recent } = diagnostics;

  const lines = [
    `GEDCOM diagnostics — ${when}`,
    '',
    ...describeEnvironment(environment),
    `Log level: ${logLevel}`,
    describeSettings(settings),
    `Panels: ${panel}`,
  ];

  if (recent.length > 0) {
    lines.push('', 'Recent log:', ...recent.map((line) => `  ${line}`));
  }

  return lines.join('\n');
}
