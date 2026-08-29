import {
  Disposable,
  EventEmitter,
  FileChangeType,
  FileSystemError,
  FileType,
  Uri,
  workspace,
  type Event,
  type FileChangeEvent,
  type FileStat,
  type FileSystemProvider,
} from 'vscode';
import {
  joinGdzPath,
  packageGdz,
  readGdz,
  splitGdzPath,
  type GdzArchive,
} from '@vscode-gedcom/core';

export const GDZ_SCHEME = 'gdz';

export function parseGdzUri(uri: Uri): { archiveUri: Uri; entryPath: string } {
  const { archivePath, entryPath } = splitGdzPath(uri.path);

  let archiveScheme = 'file';
  if (uri.query && uri.query.startsWith('underlying=')) {
    archiveScheme = uri.query.replace('underlying=', '');
  }

  const archiveUri = uri.with({
    scheme: archiveScheme,
    path: archivePath,
    query: '',
    fragment: '',
  });

  return { archiveUri, entryPath };
}

export function toGdzUri(archiveUri: Uri, entryPath = 'gedcom.ged'): Uri {
  return Uri.from({
    scheme: GDZ_SCHEME,
    authority: archiveUri.authority,
    path: joinGdzPath(archiveUri.path, entryPath),
    query: archiveUri.scheme !== 'file' ? `underlying=${archiveUri.scheme}` : '',
  });
}

interface CachedArchive {
  archive: GdzArchive;
  files: Map<string, Uint8Array>;
  mtime: number;
}

export class GdzFileSystemProvider implements FileSystemProvider {
  private readonly _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeFile: Event<FileChangeEvent[]> = this._onDidChangeFile.event;

  private readonly cache = new Map<string, CachedArchive>();

  private async getArchive(archiveUri: Uri): Promise<CachedArchive> {
    const key = archiveUri.toString();
    const cached = this.cache.get(key);

    try {
      const stat = await workspace.fs.stat(archiveUri);
      if (cached && cached.mtime === stat.mtime) {
        return cached;
      }
      const rawBytes = await workspace.fs.readFile(archiveUri);
      const archive = readGdz(rawBytes);
      const entry: CachedArchive = {
        archive,
        files: new Map(archive.files),
        mtime: stat.mtime,
      };
      this.cache.set(key, entry);
      return entry;
    } catch {
      if (cached) return cached;
      throw FileSystemError.FileNotFound(archiveUri);
    }
  }

  watch(): Disposable {
    return new Disposable(() => {});
  }

  async stat(uri: Uri): Promise<FileStat> {
    const { archiveUri, entryPath } = parseGdzUri(uri);
    const cached = await this.getArchive(archiveUri);

    if (entryPath === '') {
      return {
        type: FileType.Directory,
        ctime: 0,
        mtime: cached.mtime,
        size: 0,
      };
    }

    if (cached.files.has(entryPath)) {
      const bytes = cached.files.get(entryPath)!;
      return {
        type: FileType.File,
        ctime: 0,
        mtime: cached.mtime,
        size: bytes.byteLength,
      };
    }

    // Check if it represents a directory prefix
    const prefix = `${entryPath}/`;
    for (const key of cached.files.keys()) {
      if (key.startsWith(prefix)) {
        return {
          type: FileType.Directory,
          ctime: 0,
          mtime: cached.mtime,
          size: 0,
        };
      }
    }

    throw FileSystemError.FileNotFound(uri);
  }

  async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    const { archiveUri, entryPath } = parseGdzUri(uri);
    const cached = await this.getArchive(archiveUri);

    const entries = new Map<string, FileType>();
    const prefix = entryPath === '' ? '' : `${entryPath}/`;

    for (const key of cached.files.keys()) {
      if (prefix === '' || key.startsWith(prefix)) {
        const sub = key.slice(prefix.length);
        const slash = sub.indexOf('/');
        if (slash === -1) {
          if (sub.length > 0) {
            entries.set(sub, FileType.File);
          }
        } else {
          const dirName = sub.slice(0, slash);
          if (dirName.length > 0) {
            entries.set(dirName, FileType.Directory);
          }
        }
      }
    }

    return Array.from(entries.entries());
  }

  createDirectory(): void {
    // Virtual directories exist implicitly via file paths
  }

  async readFile(uri: Uri): Promise<Uint8Array> {
    const { archiveUri, entryPath } = parseGdzUri(uri);
    const cached = await this.getArchive(archiveUri);

    const file = cached.files.get(entryPath);
    if (!file) {
      throw FileSystemError.FileNotFound(uri);
    }
    return file;
  }

  async writeFile(
    uri: Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    const { archiveUri, entryPath } = parseGdzUri(uri);
    const cached = await this.getArchive(archiveUri);

    const exists = cached.files.has(entryPath);
    if (!exists && !options.create) {
      throw FileSystemError.FileNotFound(uri);
    }
    if (exists && !options.overwrite) {
      throw FileSystemError.FileExists(uri);
    }

    cached.files.set(entryPath, content);

    // If writing gedcom.ged (or the main dataset), extract the text
    const gedcomBytes = cached.files.get(cached.archive.gedcomPath) ?? content;
    const gedcomText = new TextDecoder('utf-8').decode(gedcomBytes);

    const newZipBytes = packageGdz({
      gedcomText,
      datasetName: cached.archive.gedcomPath,
      files: cached.files,
    });

    await workspace.fs.writeFile(archiveUri, newZipBytes);
    cached.mtime = Date.now();

    this._onDidChangeFile.fire([
      { type: exists ? FileChangeType.Changed : FileChangeType.Created, uri },
    ]);
  }

  async delete(uri: Uri, options: { recursive: boolean }): Promise<void> {
    const { archiveUri, entryPath } = parseGdzUri(uri);
    const cached = await this.getArchive(archiveUri);

    if (entryPath === cached.archive.gedcomPath) {
      throw FileSystemError.NoPermissions(
        'Cannot delete the primary GEDCOM dataset from a GEDZIP archive.',
      );
    }

    if (cached.files.has(entryPath)) {
      cached.files.delete(entryPath);
    } else if (options.recursive) {
      const prefix = `${entryPath}/`;
      let found = false;
      for (const key of Array.from(cached.files.keys())) {
        if (key.startsWith(prefix)) {
          cached.files.delete(key);
          found = true;
        }
      }
      if (!found) throw FileSystemError.FileNotFound(uri);
    } else {
      throw FileSystemError.FileNotFound(uri);
    }

    const gedcomBytes = cached.files.get(cached.archive.gedcomPath)!;
    const gedcomText = new TextDecoder('utf-8').decode(gedcomBytes);
    const newZipBytes = packageGdz({
      gedcomText,
      datasetName: cached.archive.gedcomPath,
      files: cached.files,
    });

    await workspace.fs.writeFile(archiveUri, newZipBytes);
    cached.mtime = Date.now();

    this._onDidChangeFile.fire([{ type: FileChangeType.Deleted, uri }]);
  }

  async rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): Promise<void> {
    const oldParsed = parseGdzUri(oldUri);
    const newParsed = parseGdzUri(newUri);

    if (oldParsed.archiveUri.toString() !== newParsed.archiveUri.toString()) {
      throw FileSystemError.NoPermissions('Cannot move entries across different GEDZIP archives.');
    }

    const cached = await this.getArchive(oldParsed.archiveUri);
    const fileBytes = cached.files.get(oldParsed.entryPath);
    if (!fileBytes) throw FileSystemError.FileNotFound(oldUri);

    if (cached.files.has(newParsed.entryPath) && !options.overwrite) {
      throw FileSystemError.FileExists(newUri);
    }

    cached.files.delete(oldParsed.entryPath);
    cached.files.set(newParsed.entryPath, fileBytes);

    const gedcomBytes = cached.files.get(cached.archive.gedcomPath)!;
    const gedcomText = new TextDecoder('utf-8').decode(gedcomBytes);
    const newZipBytes = packageGdz({
      gedcomText,
      datasetName: cached.archive.gedcomPath,
      files: cached.files,
    });

    await workspace.fs.writeFile(oldParsed.archiveUri, newZipBytes);
    cached.mtime = Date.now();

    this._onDidChangeFile.fire([
      { type: FileChangeType.Deleted, uri: oldUri },
      { type: FileChangeType.Created, uri: newUri },
    ]);
  }
}
