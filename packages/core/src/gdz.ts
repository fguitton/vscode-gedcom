/**
 * GEDZIP (.gdz) archive reader, packager, and extractor.
 *
 * FamilySearch GEDCOM 7.0 specification Chapter 4 defines GEDZIP as a standard
 * ZIP archive containing a root `gedcom.ged` dataset and associated multimedia
 * files referenced via relative paths.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parse } from './parser.ts';
import { webUrl } from './details.ts';
import type { Document } from './cst.ts';

export interface GdzArchive {
  /** The path of the primary GEDCOM dataset within the archive (typically 'gedcom.ged'). */
  readonly gedcomPath: string;
  /** The text content of the primary GEDCOM dataset. */
  readonly gedcomText: string;
  /** All files in the archive keyed by their normalized relative path (forward slashes). */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Retrieve the raw bytes for a file in the archive. */
  getFile(relativePath: string): Uint8Array | undefined;
  /** Check if a file exists in the archive. */
  hasFile(relativePath: string): boolean;
  /** List all file paths in the archive. */
  listFiles(): string[];
}

/** Check whether a byte sequence begins with the standard ZIP magic header. */
export function isGdz(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  // Standard PK\x03\x04 or empty archive PK\x05\x06
  return (
    (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) ||
    (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x05 && data[3] === 0x06)
  );
}

/** Normalize paths inside a zip archive (standardize forward slashes, trim leading slashes). */
export function normalizeZipPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Splits a GDZ virtual path or URI path into the archive path and the relative entry path.
 * Example: '/workspace/trees/family.gdz/media/portrait.jpg' -> { archivePath: '/workspace/trees/family.gdz', entryPath: 'media/portrait.jpg' }
 */
export function splitGdzPath(path: string): { archivePath: string; entryPath: string } {
  const norm = path.replace(/\\/g, '/');
  const lower = norm.toLowerCase();
  const idx = lower.indexOf('.gdz');
  if (idx === -1) {
    return { archivePath: norm, entryPath: '' };
  }
  const archivePath = norm.substring(0, idx + 4);
  const entryPath = normalizeZipPath(norm.substring(idx + 4));
  return { archivePath, entryPath };
}

/**
 * Builds a GDZ virtual path from an archive path and an entry path.
 */
export function joinGdzPath(archivePath: string, entryPath = 'gedcom.ged'): string {
  const normArchive = archivePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normEntry = normalizeZipPath(entryPath);
  return `${normArchive}/${normEntry}`;
}

/**
 * Reads a GEDZIP (.gdz) archive from bytes.
 * Throws if the archive cannot be read or contains no GEDCOM dataset.
 */
export function readGdz(data: Uint8Array): GdzArchive {
  const unzipped = unzipSync(data);
  const files = new Map<string, Uint8Array>();

  for (const [rawKey, fileData] of Object.entries(unzipped)) {
    // Skip pure directory entries ending in /
    if (rawKey.endsWith('/')) continue;
    const normalized = normalizeZipPath(rawKey);
    files.set(normalized, fileData);
  }

  // Find gedcom.ged (preferred case-insensitive match for gedcom.ged)
  let gedcomPath: string | undefined;
  for (const key of files.keys()) {
    if (key.toLowerCase() === 'gedcom.ged') {
      gedcomPath = key;
      break;
    }
  }

  // Fallback: any root .ged file, then any .ged in the archive
  if (!gedcomPath) {
    for (const key of files.keys()) {
      if (!key.includes('/') && key.toLowerCase().endsWith('.ged')) {
        gedcomPath = key;
        break;
      }
    }
  }
  if (!gedcomPath) {
    for (const key of files.keys()) {
      if (key.toLowerCase().endsWith('.ged')) {
        gedcomPath = key;
        break;
      }
    }
  }

  if (!gedcomPath) {
    throw new Error('No GEDCOM dataset (*.ged) found in GEDZIP archive');
  }

  const gedcomBytes = files.get(gedcomPath)!;
  const gedcomText = strFromU8(gedcomBytes);

  return {
    gedcomPath,
    gedcomText,
    files,
    getFile(relPath: string): Uint8Array | undefined {
      return files.get(normalizeZipPath(relPath));
    },
    hasFile(relPath: string): boolean {
      return files.has(normalizeZipPath(relPath));
    },
    listFiles(): string[] {
      return Array.from(files.keys());
    },
  };
}

export interface PackageGdzOptions {
  /** The GEDCOM dataset text to place in `gedcom.ged` (or custom dataset path). */
  readonly gedcomText: string;
  /** Optional custom filename for the dataset (defaults to 'gedcom.ged'). */
  readonly datasetName?: string;
  /** Additional files (media, documents) to package into the archive. */
  readonly files?: ReadonlyMap<string, Uint8Array> | Record<string, Uint8Array>;
}

/**
 * Packages a GEDCOM dataset and optional media files into a GEDZIP (.gdz) archive.
 */
export function packageGdz(options: PackageGdzOptions): Uint8Array {
  const zippable: Record<string, Uint8Array> = {};
  const datasetName = options.datasetName ? normalizeZipPath(options.datasetName) : 'gedcom.ged';

  // Add additional files first
  if (options.files) {
    if (options.files instanceof Map) {
      for (const [relPath, fileBytes] of options.files.entries()) {
        const norm = normalizeZipPath(relPath);
        if (norm && norm !== datasetName) {
          zippable[norm] = fileBytes;
        }
      }
    } else {
      for (const [relPath, fileBytes] of Object.entries(options.files)) {
        const norm = normalizeZipPath(relPath);
        if (norm && norm !== datasetName) {
          zippable[norm] = fileBytes;
        }
      }
    }
  }

  // Add the primary dataset
  zippable[datasetName] = strToU8(options.gedcomText);

  return zipSync(zippable, { level: 6 });
}

/**
 * Extracts all files and dataset from a GEDZIP (.gdz) archive.
 */
export function extractGdz(data: Uint8Array): {
  readonly gedcomPath: string;
  readonly gedcomText: string;
  readonly files: Map<string, Uint8Array>;
} {
  const archive = readGdz(data);
  return {
    gedcomPath: archive.gedcomPath,
    gedcomText: archive.gedcomText,
    files: new Map(archive.files),
  };
}

/**
 * Scans a GEDCOM document or raw text for local/relative media references (FILE tags).
 * Filters out remote URLs (http/https) and returns a unique array of local file paths.
 */
export function findLocalMediaReferences(docOrText: Document | string): string[] {
  const doc = typeof docOrText === 'string' ? parse(docOrText) : docOrText;
  const references = new Set<string>();

  for (const struct of doc.structures) {
    if (struct.tag === 'FILE' && struct.payload) {
      const trimmed = struct.payload.trim();
      if (
        trimmed.length > 0 &&
        !webUrl(trimmed) &&
        !/^(?:javascript|vbscript|about|data):/i.test(trimmed)
      ) {
        references.add(trimmed);
      }
    }
  }

  return Array.from(references);
}
