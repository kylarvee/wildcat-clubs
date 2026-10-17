/**
 * Shapes shared by the files domain, the /api/files JSON routes, the explorer
 * and the file picker. Client-safe: no server imports.
 */

export type FileScopeKind = "club" | "user" | "university";

/** Where a file lives: a club's files, one person's own uploads, or university files. */
export type ScopeRef = { kind: "club"; clubId: string } | { kind: "user"; userId: string } | { kind: "university" };

/** Who can open an item once INHERIT is resolved. */
export type Vis = "PUBLIC" | "MEMBERS" | "LEADERS";
export type VisSetting = Vis | "INHERIT";

/** What a picker may offer. Folders always show so people can browse into them. */
export type AcceptKind = "any" | "image" | "document" | "video";

export type ListView = "folder" | "trash" | "search" | "shared";

export type FileRow = {
  id: string;
  name: string;
  isFolder: boolean;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  createdBy: { id: string; name: string } | null;
  parentId: string | null;
  /** The item's own setting. */
  visibility: VisSetting;
  /** INHERIT resolved through its folders. */
  effective: Vis;
  featured: boolean;
  /** People with an explicit grant on this item. */
  sharedWith: number;
  canEdit: boolean;
  /** /api/files/<id> for files; null for folders. */
  url: string | null;
  /** Items directly inside (folders only). */
  childCount: number | null;
  /** "Meeting Minutes / Fall 2026": shown in search, trash and shared results. */
  location: string | null;
  /** Shared view: where the item comes from ("Applied AI Lab", "Maya Chen's files"). */
  source: string | null;
  /** Shared view: link to open the containing explorer. */
  sourceHref: string | null;
  /** Mirrored to the club's Google Drive. */
  inDrive: boolean;
  /** Shared view: the kind of space the item lives in (its visibility words depend on it). */
  spaceKind?: FileScopeKind;
};

export type FolderNode = { id: string; name: string; parentId: string | null; effective: Vis; visibility: VisSetting; canEdit: boolean };

export type Crumb = { id: string | null; name: string };

export type ScopeInfo = {
  kind: FileScopeKind;
  clubId: string | null;
  /** "Applied AI Lab files", "My files", "University files". */
  label: string;
};

export type ListResult = {
  scope: ScopeInfo;
  view: ListView;
  /** The open folder, or null at the top level. */
  folder: { id: string; name: string; visibility: VisSetting; effective: Vis; canEdit: boolean } | null;
  /** Top level first, ending with the open folder. */
  path: Crumb[];
  items: FileRow[];
  /** Every folder the viewer may see (for the side tree and "Move to…"). Null when not asked for. */
  tree: FolderNode[] | null;
  /** Full control in this scope: share, feature, empty the trash. */
  canManage: boolean;
  /** Can add files or folders to the open folder. */
  canUpload: boolean;
  /** How many items sit at the top of the trash (0 for people who can't edit). */
  trashCount: number;
  q: string | null;
  /** Which scopes this viewer can browse (for the picker's tabs). */
  available: { club: boolean; user: boolean; university: boolean };
  /** True when results were cut off at the limit. */
  truncated: boolean;
};

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string; code?: string };
export type ApiResponse<T> = ApiOk<T> | ApiErr;

/** What the upload route returns (and the picker hands back). */
export type UploadedFile = { id: string; name: string; mimeType: string | null; url: string };

export type GrantRow = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  avatarColor: string;
  canEdit: boolean;
};

export type SharingInfo = {
  id: string;
  name: string;
  isFolder: boolean;
  scopeKind: FileScopeKind;
  visibility: VisSetting;
  effective: Vis;
  /** What INHERIT resolves to here (the folder above, or the top-level default). */
  inherited: Vis;
  inheritedFrom: string | null;
  featured: boolean;
  canFeature: boolean;
  grants: GrantRow[];
  url: string;
};

export type PersonOption = { id: string; name: string; email: string; avatarUrl: string | null; avatarColor: string; note: string | null };
