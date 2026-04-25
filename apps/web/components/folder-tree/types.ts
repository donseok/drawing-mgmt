// Folder tree node types shared by FolderTree, sidebars and admin screens.

export interface FolderNode {
  id: string;
  code: string;
  name: string;
  /** how many objects live directly inside this folder */
  objectCount?: number;
  /** "public" | "restricted" | "locked" — drives the lock icon */
  permission?: 'public' | 'restricted' | 'locked';
  /** parent path display (e.g. "본사 / 기계 / CGL-2") */
  pathLabel?: string;
  children?: FolderNode[];
}

export interface FolderSelection {
  id: string;
  /** include sub-folders in queries */
  includeDescendants: boolean;
}
