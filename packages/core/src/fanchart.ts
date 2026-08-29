/**
 * Circular Fan Chart Generator for Ancestor Pedigrees.
 *
 * Traverses ancestors up to N generations and arranges them into Ahnentafel
 * sectors for circular and semicircular radial fan chart rendering.
 */

import type { Analysis } from './index.ts';
import type { Structure } from './cst.ts';
import { displayName } from './name.ts';
import { lifespan } from './relations.ts';
import { asPointer } from './xref.ts';

export interface FanChartNode {
  readonly xref: string;
  readonly ahnentafel: number;
  readonly generation: number;
  readonly slot: number;
  readonly totalSlots: number;
  readonly label: string;
  readonly detail?: string;
  readonly sex: 'M' | 'F' | 'U';
  readonly line: number;
}

export interface FanChartData {
  readonly rootXref: string;
  readonly maxGenerations: number;
  readonly nodes: readonly FanChartNode[];
}

const norm = (xref: string) => xref.replace(/^@|@$/g, '');

function pointers(record: Structure, tag: string): string[] {
  const found: string[] = [];
  for (const child of record.children) {
    if (child.tag !== tag) continue;
    const pointer = asPointer(child);
    if (pointer !== null && pointer !== 'VOID') found.push(norm(pointer));
  }
  return found;
}

function nameOf(record: Structure): string {
  const name = record.children.find((c) => c.tag === 'NAME')?.payload;
  return name ? displayName(name) : `@${record.xref ?? ''}@`;
}

function sexOf(record: Structure): 'M' | 'F' | 'U' {
  const sex = record.children
    .find((c) => c.tag === 'SEX')
    ?.payload?.trim()
    .toUpperCase();
  return sex === 'M' ? 'M' : sex === 'F' ? 'F' : 'U';
}

/**
 * Builds ancestor fan chart nodes up to `maxGenerations` (default: 5 generations = 31 ancestors).
 */
export function buildFanChart(
  analysis: Analysis,
  rootXref: string,
  maxGenerations = 5,
): FanChartData {
  const id = norm(rootXref);
  const rootRecord = analysis.xrefs.definitions.get(id);
  if (!rootRecord || rootRecord.tag !== 'INDI') {
    return { rootXref: id, maxGenerations, nodes: [] };
  }

  const nodes: FanChartNode[] = [];

  // Queue holds { xref, ahnentafel, generation, slot }
  const queue: Array<{ xref: string; ahnentafel: number; generation: number; slot: number }> = [
    { xref: id, ahnentafel: 1, generation: 0, slot: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const record = analysis.xrefs.definitions.get(current.xref);
    if (!record) continue;

    const totalSlots = Math.pow(2, current.generation);
    const detail = lifespan(analysis, current.xref);

    const spanLine = analysis.entitySpans?.find((s) => s.xref === current.xref)?.startLine;
    nodes.push({
      xref: current.xref,
      ahnentafel: current.ahnentafel,
      generation: current.generation,
      slot: current.slot,
      totalSlots,
      label: nameOf(record),
      detail,
      sex: sexOf(record),
      line: spanLine ?? record.span.line,
    });

    if (current.generation + 1 < maxGenerations) {
      const famcList = pointers(record, 'FAMC');
      if (famcList.length > 0) {
        const famId = famcList[0]!;
        const fam = analysis.xrefs.definitions.get(famId);
        if (fam) {
          const husb = pointers(fam, 'HUSB')[0];
          const wife = pointers(fam, 'WIFE')[0];

          if (husb) {
            queue.push({
              xref: husb,
              ahnentafel: current.ahnentafel * 2,
              generation: current.generation + 1,
              slot: current.slot * 2,
            });
          }

          if (wife) {
            queue.push({
              xref: wife,
              ahnentafel: current.ahnentafel * 2 + 1,
              generation: current.generation + 1,
              slot: current.slot * 2 + 1,
            });
          }
        }
      }
    }
  }

  return {
    rootXref: id,
    maxGenerations,
    nodes,
  };
}
