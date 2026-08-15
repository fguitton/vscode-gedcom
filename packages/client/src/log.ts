/**
 * The extension's log, and the diagnostics a reader can send back.
 *
 * A bug report about an editor extension usually arrives without the one thing
 * that would answer it: which build was running, in which host, with which
 * settings, and what the extension did when the button was pressed. The channel
 * answers all four, and `GEDCOM: Copy Diagnostics` answers them without the
 * reader having to reproduce anything.
 *
 * The channel is a `LogOutputChannel`, so the editor supplies the timestamps and
 * the levels and honours *Developer: Set Log Level…*. It is also handed to the
 * language client, which writes through the same levels — so the server's own
 * lines and ours are one document, in one place, in one format.
 */

import {
  commands,
  env,
  version,
  window,
  workspace,
  type Disposable,
  type Event,
  type ExtensionContext,
  type LogLevel,
  type LogOutputChannel,
  type ViewColumn,
} from 'vscode';

import {
  describeDiagnostics,
  describeEnvironment,
  describeSettings,
  type Diagnostics,
  type Environment,
  type SettingReading,
} from './report.ts';

/** How many lines of history a report carries. */
const KEPT = 200;

/** How much of one line, before it is a wall of text rather than a fact. */
const WIDEST = 500;

export interface Log {
  /**
   * The channel, for handing to the language client. Its writes are recorded
   * along with ours, which is what lets a report hold the server's side too.
   */
  readonly channel: LogOutputChannel;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  /** The recent history, newest last. */
  recent(): readonly string[];
}

/**
 * A `LogOutputChannel` that keeps a copy of what passes through it.
 *
 * There is no way to read an output channel back, so a report can only hold the
 * lines it was itself told about. Everything the language client writes goes
 * through here for the same reason.
 *
 * Only `info` and above is kept. `trace` carries whole documents — the protocol
 * dump includes the text of every file opened — and a diagnostic that a reader
 * is invited to paste in public must not carry a family's records.
 */
class Recorder implements LogOutputChannel {
  private readonly channel: LogOutputChannel;
  private readonly lines: string[] = [];

  constructor(channel: LogOutputChannel) {
    this.channel = channel;
  }

  get name(): string {
    return this.channel.name;
  }

  get logLevel(): LogLevel {
    return this.channel.logLevel;
  }

  get onDidChangeLogLevel(): Event<LogLevel> {
    return this.channel.onDidChangeLogLevel;
  }

  recent(): readonly string[] {
    return this.lines;
  }

  private keep(level: string, message: string): void {
    const stamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const text = message.length > WIDEST ? `${message.slice(0, WIDEST)}…` : message;
    this.lines.push(`${stamp} [${level}] ${text}`);
    if (this.lines.length > KEPT) this.lines.splice(0, this.lines.length - KEPT);
  }

  trace(message: string, ...rest: unknown[]): void {
    this.channel.trace(message, ...rest);
  }

  debug(message: string, ...rest: unknown[]): void {
    this.channel.debug(message, ...rest);
  }

  info(message: string, ...rest: unknown[]): void {
    this.keep('info', message);
    this.channel.info(message, ...rest);
  }

  warn(message: string, ...rest: unknown[]): void {
    this.keep('warning', message);
    this.channel.warn(message, ...rest);
  }

  error(message: string | Error, ...rest: unknown[]): void {
    this.keep('error', message instanceof Error ? message.message : message);
    this.channel.error(message, ...rest);
  }

  append(value: string): void {
    this.keep('info', value);
    this.channel.append(value);
  }

  appendLine(value: string): void {
    this.keep('info', value);
    this.channel.appendLine(value);
  }

  replace(value: string): void {
    this.channel.replace(value);
  }

  clear(): void {
    this.lines.length = 0;
    this.channel.clear();
  }

  show(column?: ViewColumn | boolean, preserveFocus?: boolean): void {
    this.channel.show(column as ViewColumn, preserveFocus);
  }

  hide(): void {
    this.channel.hide();
  }

  dispose(): void {
    this.channel.dispose();
  }
}

export const LOG_CHANNEL_NAME = 'GEDCOM';

export function createLog(): Log & Disposable {
  const recorder = new Recorder(window.createOutputChannel(LOG_CHANNEL_NAME, { log: true }));

  return {
    channel: recorder,
    info: (message) => recorder.info(message),
    warn: (message) => recorder.warn(message),
    error: (message) => recorder.error(message),
    debug: (message) => recorder.debug(message),
    recent: () => recorder.recent(),
    dispose: () => recorder.dispose(),
  };
}

/** Every setting the extension contributes, with what it is set to now. */
export function readSettings(declared: readonly string[]): SettingReading[] {
  const configuration = workspace.getConfiguration();
  return declared.map((key) => {
    const known = configuration.inspect(key);
    return { key, value: configuration.get(key), fallback: known?.defaultValue };
  });
}

const LEVELS: Record<number, string> = {
  0: 'Off',
  1: 'Trace',
  2: 'Debug',
  3: 'Info',
  4: 'Warning',
  5: 'Error',
};

/**
 * `trace` is dropped by the channel unless the reader has also raised its level,
 * so the tracing setting alone produces nothing to look at. Said once, where
 * they are looking for the trace they turned on.
 */
export function noteTraceLevel(log: Log): void {
  const tracing = workspace.getConfiguration().get<string>('gedcom.trace.server', 'off');
  if (tracing === 'off') return;
  if (log.channel.logLevel <= 1) return;

  log.info(
    `gedcom.trace.server is "${tracing}", but this channel is at ` +
      `${LEVELS[log.channel.logLevel] ?? 'an unknown level'}. Run ` +
      '“Developer: Set Log Level…”, pick GEDCOM, and choose Trace to see the messages.',
  );
}

export interface DiagnosticFacts {
  environment: Diagnostics['environment'];
  settings: readonly SettingReading[];
  panel: string;
}

/** The report, assembled from what is true at the moment it is asked for. */
export function diagnosticsText(log: Log, facts: DiagnosticFacts): string {
  return describeDiagnostics({
    when: new Date().toISOString().replace('T', ' ').replace('Z', ''),
    environment: facts.environment,
    settings: facts.settings,
    logLevel: LEVELS[log.channel.logLevel] ?? 'unknown',
    panel: facts.panel,
    recent: log.recent(),
  });
}

export async function copyDiagnostics(log: Log, facts: DiagnosticFacts): Promise<string> {
  const text = diagnosticsText(log, facts);
  await env.clipboard.writeText(text);
  log.info('Diagnostics copied to the clipboard');
  return text;
}

/** Which settings the manifest contributes, read from the manifest itself. */
function declaredSettings(context: ExtensionContext): string[] {
  const manifest = context.extension.packageJSON as {
    contributes?: { configuration?: { properties?: Record<string, unknown> } };
  };
  return Object.keys(manifest.contributes?.configuration?.properties ?? {});
}

export interface HostFacts {
  readonly host: 'node' | 'browser';
  /** Named by the entry point, which is the half of this that differs. */
  readonly platform: string;
}

function environmentOf(context: ExtensionContext, facts: HostFacts): Environment {
  const manifest = context.extension.packageJSON as { version?: string };

  return {
    extension: manifest.version ?? 'unknown',
    editor: version,
    appName: env.appName,
    host: facts.host,
    platform: facts.platform,
    remote: env.remoteName,
    folders: workspace.workspaceFolders?.length ?? 0,
    trusted: workspace.isTrusted,
    documents: workspace.textDocuments.filter((document) => document.languageId === 'gedcom')
      .length,
  };
}

/**
 * The first lines in the channel: which build, in which host, configured how.
 *
 * Written at activation so that a reader who opens the log after something went
 * wrong still has the header a report needs.
 */
export function logActivation(context: ExtensionContext, log: Log, facts: HostFacts): void {
  for (const line of describeEnvironment(environmentOf(context, facts))) log.info(line);
  log.info(describeSettings(readSettings(declaredSettings(context))));
  noteTraceLevel(log);
}

/**
 * The two commands a reader is pointed at: one to look at the log, one to send
 * it. Neither is gated on a GEDCOM file being open — the reports worth having
 * are the ones where nothing appears to work.
 */
export function registerDiagnostics(
  context: ExtensionContext,
  log: Log,
  facts: HostFacts,
  panel: () => string,
): void {
  context.subscriptions.push(
    commands.registerCommand('gedcom.showLog', () => {
      log.channel.show(true);
    }),
    commands.registerCommand('gedcom.copyDiagnostics', async () => {
      await copyDiagnostics(log, {
        environment: environmentOf(context, facts),
        settings: readSettings(declaredSettings(context)),
        panel: panel(),
      });
      // Not awaited: the command is done once the clipboard holds the report,
      // and a notification is answered whenever the reader gets to it.
      const look = 'Show the log';
      void window
        .showInformationMessage(
          'GEDCOM diagnostics copied to the clipboard. Paste them into your report.',
          look,
        )
        .then((chosen) => {
          if (chosen === look) log.channel.show(true);
        });
    }),
  );
}
