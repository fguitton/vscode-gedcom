/**
 * TreeDataProvider that makes .gdz (GEDZIP) archives expandable in the VS Code Explorer sidebar.
 */

import {
  commands,
  EventEmitter,
  ThemeColor,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  window,
  workspace,
  type Disposable,
  type Event,
  type FileSystemWatcher,
  type TreeDataProvider,
} from 'vscode';
import { readGdz } from '@vscode-gedcom/core';
import { toGdzUri } from './gdz-fs.ts';
import { t } from './l10n.ts';

export type GdzTreeItemType = 'archive' | 'folder' | 'file';

export interface GdzTreeNode {
  readonly type: GdzTreeItemType;
  readonly archiveUri: Uri;
  readonly entryPath: string;
  readonly name: string;
  readonly size?: number;
  readonly children?: Map<string, GdzTreeNode>;
}

export class GdzTreeItem extends TreeItem {
  readonly node: GdzTreeNode;

  constructor(node: GdzTreeNode) {
    const isArchive = node.type === 'archive';
    const isFolder = node.type === 'folder';
    const collapsibleState =
      isArchive || isFolder ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;

    super(node.name, collapsibleState);
    this.node = node;

    if (isArchive) {
      this.iconPath = new ThemeIcon('archive', new ThemeColor('charts.blue'));
      this.contextValue = 'gdzArchive';
      this.tooltip = node.archiveUri.fsPath;
      if (node.size !== undefined) {
        this.description = formatSize(node.size);
      }
    } else if (isFolder) {
      this.iconPath = ThemeIcon.Folder;
      this.contextValue = 'gdzFolder';
      this.tooltip = node.entryPath;
    } else {
      const lower = node.name.toLowerCase();
      if (lower.endsWith('.ged')) {
        this.iconPath = new ThemeIcon('references', new ThemeColor('charts.green'));
      } else if (/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(lower)) {
        this.iconPath = new ThemeIcon('file-media', new ThemeColor('charts.yellow'));
      } else if (lower.endsWith('.pdf')) {
        this.iconPath = new ThemeIcon('file-pdf', new ThemeColor('charts.red'));
      } else {
        this.iconPath = ThemeIcon.File;
      }
      this.contextValue = 'gdzFile';
      this.tooltip = node.entryPath;
      if (node.size !== undefined) {
        this.description = formatSize(node.size);
      }

      const virtualUri = toGdzUri(node.archiveUri, node.entryPath);
      this.resourceUri = virtualUri;
      this.command = {
        command: 'vscode.open',
        title: t('Open'),
        arguments: [virtualUri],
      };
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class GdzTreeDataProvider implements TreeDataProvider<GdzTreeNode>, Disposable {
  private readonly _onDidChangeTreeData = new EventEmitter<GdzTreeNode | undefined | void>();
  readonly onDidChangeTreeData: Event<GdzTreeNode | undefined | void> =
    this._onDidChangeTreeData.event;

  private watcher: FileSystemWatcher | undefined;
  private readonly subscriptions: Disposable[] = [];
  private archives: Uri[] = [];

  constructor() {
    this.watcher = workspace.createFileSystemWatcher('**/*.gdz');
    this.subscriptions.push(
      this.watcher.onDidCreate(() => this.refresh()),
      this.watcher.onDidChange(() => this.refresh()),
      this.watcher.onDidDelete(() => this.refresh()),
    );
    void this.scanArchives();
  }

  refresh(): void {
    void this.scanArchives();
  }

  private async scanArchives(): Promise<void> {
    try {
      this.archives = await workspace.findFiles('**/*.gdz', '**/node_modules/**');
      void commands.executeCommand('setContext', 'gedcom.hasGdzFiles', this.archives.length > 0);
      this._onDidChangeTreeData.fire();
    } catch {
      this.archives = [];
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: GdzTreeNode): TreeItem {
    return new GdzTreeItem(element);
  }

  async getChildren(element?: GdzTreeNode): Promise<GdzTreeNode[]> {
    if (!element) {
      // Root: list all .gdz archives found in the workspace
      if (this.archives.length === 0) {
        return [];
      }
      return Promise.all(
        this.archives.map(async (archiveUri) => {
          let size: number | undefined;
          try {
            const stat = await workspace.fs.stat(archiveUri);
            size = stat.size;
          } catch {
            // ignore
          }
          const name = archiveUri.path.split('/').filter(Boolean).pop() ?? 'archive.gdz';
          return {
            type: 'archive' as const,
            archiveUri,
            entryPath: '',
            name,
            size,
          };
        }),
      );
    }

    if (element.type === 'archive') {
      try {
        const rawBytes = await workspace.fs.readFile(element.archiveUri);
        const archive = readGdz(rawBytes);

        const rootChildren = new Map<string, GdzTreeNode>();

        for (const [relPath, fileBytes] of archive.files.entries()) {
          const parts = relPath.split('/').filter(Boolean);
          let currentMap = rootChildren;

          for (let i = 0; i < parts.length; i++) {
            const part = parts[i]!;
            const isLeaf = i === parts.length - 1;
            const subPath = parts.slice(0, i + 1).join('/');

            if (isLeaf) {
              currentMap.set(part, {
                type: 'file',
                archiveUri: element.archiveUri,
                entryPath: subPath,
                name: part,
                size: fileBytes.byteLength,
              });
            } else {
              let dirNode = currentMap.get(part);
              if (!dirNode || dirNode.type !== 'folder') {
                dirNode = {
                  type: 'folder',
                  archiveUri: element.archiveUri,
                  entryPath: subPath,
                  name: part,
                  children: new Map(),
                };
                currentMap.set(part, dirNode);
              }
              currentMap = dirNode.children!;
            }
          }
        }

        return Array.from(rootChildren.values()).sort(sortTreeNodes);
      } catch {
        return [];
      }
    }

    if (element.type === 'folder' && element.children) {
      return Array.from(element.children.values()).sort(sortTreeNodes);
    }

    return [];
  }

  dispose(): void {
    this.watcher?.dispose();
    for (const sub of this.subscriptions) {
      sub.dispose();
    }
  }
}

function sortTreeNodes(a: GdzTreeNode, b: GdzTreeNode): number {
  if (a.type !== b.type) {
    if (a.type === 'folder') return -1;
    if (b.type === 'folder') return 1;
    if (a.name.toLowerCase() === 'gedcom.ged') return -1;
    if (b.name.toLowerCase() === 'gedcom.ged') return 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

export function registerGdzTreeView(context: { subscriptions: Disposable[] }): GdzTreeDataProvider {
  const provider = new GdzTreeDataProvider();
  context.subscriptions.push(
    provider,
    window.registerTreeDataProvider('gedcom.gdzExplorer', provider),
    commands.registerCommand('gedcom.refreshGdzExplorer', () => provider.refresh()),
    commands.registerCommand('gedcom.openGdzItem', async (node?: GdzTreeNode) => {
      if (!node) return;
      const virtualUri = toGdzUri(node.archiveUri, node.entryPath || 'gedcom.ged');
      await commands.executeCommand('vscode.open', virtualUri);
    }),
  );
  return provider;
}
