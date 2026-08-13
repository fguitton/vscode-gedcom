/**
 * How a file indents itself, if it does.
 *
 * The specification puts the level number first on the line with nothing before
 * it. Plenty of exporters indent anyway, because a flat wall of numbered lines is
 * hard to read, and the indentation is then pure decoration: the level number is
 * still the only thing that says where a structure sits.
 *
 * Which makes it worth measuring rather than trusting. A file that indents two
 * spaces at one level and three at the next is telling the reader something false
 * about its shape, and nothing else in the format will notice.
 *
 * Tabs need no special handling to *parse* — any leading whitespace run is
 * skipped — but they do need measuring, because a tab is one character standing
 * for a width nobody wrote down.
 */

export type IndentStyle =
  /** No line carries leading whitespace. */
  | 'none'
  | 'spaces'
  | 'tabs'
  /** Both appear, whether on one line or on different ones. */
  | 'mixed';

export interface Indentation {
  readonly style: IndentStyle;
  /**
   * Columns of indent per level, counting a tab as `tabWidth`.
   *
   * Absent when no single value fits most of the file, which is itself the
   * answer for a file with no habit to speak of.
   */
  readonly width?: number;
  /**
   * What a tab appears to stand for.
   *
   * Only a mixed file can supply the evidence: where a tab-indented line and a
   * space-indented line sit at the same level, the spaces are what the tab is
   * standing in for. A file indented with tabs alone never says, so this is
   * absent and a tab counts as one level.
   */
  readonly tabWidth?: number;
  /** True when every indented line agrees with `width`. */
  readonly consistent: boolean;
  /** Lines whose indent does not match the file's own habit, 0-based. */
  readonly exceptions: readonly number[];
}

/** Every conformant terminator: CRLF, a lone CR, a lone LF. */
const LINE_BREAK = /\r\n|\r|\n/;

interface Measured {
  readonly line: number;
  readonly spaces: number;
  readonly tabs: number;
  readonly level: number;
}

/** Leading whitespace of a line, and the level that follows it. */
function measure(text: string, line: number): Measured | undefined {
  const match = /^([ \t]*)(\d+)[ \t]/.exec(text);
  if (!match) return undefined;

  const indent = match[1]!;
  return {
    line,
    spaces: (indent.match(/ /g) ?? []).length,
    tabs: (indent.match(/\t/g) ?? []).length,
    level: Number(match[2]),
  };
}

/**
 * The commonest value, which beats a mean here: one stray line should not drag
 * the estimate to a width no line actually uses.
 */
function commonest(values: readonly number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  let best: number | undefined;
  let seen = 0;
  // Sorted so an even split resolves to the smaller width rather than to
  // whichever line the file happened to put first.
  for (const [value, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (count > seen) {
      best = value;
      seen = count;
    }
  }
  return best;
}

/**
 * Reads a file's indentation habit.
 *
 * Level zero is ignored throughout: it is never indented, so it carries no
 * evidence, and dividing by it carries none either.
 */
export function detectIndentation(text: string): Indentation {
  const indented = text
    .split(LINE_BREAK)
    .map((line, index) => measure(line, index))
    .filter((entry): entry is Measured => entry !== undefined && entry.level > 0);

  if (indented.length === 0 || indented.every((entry) => entry.spaces + entry.tabs === 0)) {
    return { style: 'none', consistent: true, exceptions: [] };
  }

  const usesSpaces = indented.some((entry) => entry.spaces > 0);
  const usesTabs = indented.some((entry) => entry.tabs > 0);
  const style: IndentStyle = usesSpaces && usesTabs ? 'mixed' : usesTabs ? 'tabs' : 'spaces';

  // How much one level is worth in spaces, from the lines that use only spaces.
  const spaceWidth = commonest(
    indented
      .filter((entry) => entry.tabs === 0 && entry.spaces > 0)
      .map((entry) => entry.spaces / entry.level),
  );

  /**
   * What a tab is worth, from lines that use both.
   *
   * The spaces on such a line account for some whole number of levels; the tabs
   * account for the rest, so their width follows.
   */
  let tabWidth: number | undefined;
  if (style === 'mixed') {
    /** How many indented lines disagree about the unit, for a given tab width. */
    const misfits = (candidate: number): number => {
      const perLevel = indented.map(
        (entry) => (entry.spaces + entry.tabs * candidate) / entry.level,
      );
      const unit = commonest(perLevel);
      return unit === undefined
        ? indented.length
        : perLevel.filter((value) => Math.abs(value - unit) > 1e-9).length;
    };

    // Solved by search rather than by arithmetic. The direct calculation needs a
    // line indented with spaces alone to measure against, and a file that uses
    // tabs for its first levels and spaces only beyond them never provides one —
    // which is exactly the shape two editors fighting over a file produces. The
    // candidates are the tab widths anything has ever defaulted to.
    const candidates = [8, 4, 2, 1];
    let best = candidates[0]!;
    let fewest = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const count = misfits(candidate);
      // Strictly fewer, so an even contest falls to the last tried — the
      // smallest — rather than to whichever came first.
      if (count < fewest) {
        fewest = count;
        best = candidate;
      }
    }

    tabWidth = best;
  }

  const columnsOf = (entry: Measured): number =>
    entry.spaces + entry.tabs * (tabWidth ?? spaceWidth ?? 1);

  const width = commonest(indented.map((entry) => columnsOf(entry) / entry.level));
  const exceptions =
    width === undefined
      ? indented.map((entry) => entry.line)
      : indented
          .filter((entry) => Math.abs(columnsOf(entry) / entry.level - width) > 1e-9)
          .map((entry) => entry.line);

  return {
    style,
    ...(width === undefined ? {} : { width }),
    ...(tabWidth === undefined ? {} : { tabWidth }),
    consistent: exceptions.length === 0,
    exceptions,
  };
}
