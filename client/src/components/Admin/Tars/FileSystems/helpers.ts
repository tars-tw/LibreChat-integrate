import { FolderUp, HardDrive, Lock, Network, Server } from 'lucide-react';
import {
  TARS_FILE_PROTOCOLS,
  TARS_PROTOCOL_DEFAULT_PORTS,
  tarsProtocolNeedsCredentials,
  tarsProtocolUsesHostName,
} from 'librechat-data-provider';
import type { TTarsFileProtocol, TTarsFileSystemSource } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';

export {
  NAME_MIN,
  NAME_MAX,
  nameInvalid,
  portInvalid,
  errorMessage,
  knowledgeBaseNames,
  knowledgeBasePickerOptions,
} from '../Sources/helpers';

/** Each protocol gets its own mark so the list reads at a glance. */
export const PROTOCOL_ICONS: Record<TTarsFileProtocol, LucideIcon> = {
  SMB: Network,
  FTP: FolderUp,
  SFTP: Lock,
  NFS: HardDrive,
};

export const protocolIcon = (protocol: string | null | undefined): LucideIcon =>
  PROTOCOL_ICONS[protocol as TTarsFileProtocol] ?? Server;

export const defaultPort = (protocol: TTarsFileProtocol): string =>
  String(TARS_PROTOCOL_DEFAULT_PORTS[protocol]);

export interface FileSystemForm {
  name: string;
  description: string;
  protocol: TTarsFileProtocol;
  host: string;
  port: string;
  path: string;
  hostName: string;
  /** Both start blank on edit — pwc_tars credentials never reach the browser. */
  account: string;
  password: string;
  enabled: boolean;
  allowedKmIds: string[];
}

export const emptyFileSystemForm: FileSystemForm = {
  name: '',
  description: '',
  protocol: TARS_FILE_PROTOCOLS[0],
  host: '',
  port: defaultPort(TARS_FILE_PROTOCOLS[0]),
  path: '',
  hostName: '',
  account: '',
  password: '',
  enabled: true,
  allowedKmIds: [],
};

export const toFileSystemForm = (fileSystem: TTarsFileSystemSource): FileSystemForm => ({
  ...emptyFileSystemForm,
  name: fileSystem.name,
  description: fileSystem.description ?? '',
  protocol: (fileSystem.mount_type as TTarsFileProtocol) ?? TARS_FILE_PROTOCOLS[0],
  host: fileSystem.host ?? '',
  port: fileSystem.port != null ? String(fileSystem.port) : '',
  path: fileSystem.path ?? '',
  hostName: fileSystem.host_name ?? '',
  enabled: fileSystem.status === 1,
  allowedKmIds: fileSystem.allowed_km_ids ?? [],
});

/**
 * What a form needs before pwc_tars will accept it.
 *
 * The account and password are not part of this check on an existing group:
 * neither ever reaches the browser, so both start blank and a blank field
 * means "keep what is stored".
 */
export const connectionFieldsFilled = (form: FileSystemForm, isEdit: boolean): boolean => {
  if (form.host.trim() === '') {
    return false;
  }
  if (isEdit || !tarsProtocolNeedsCredentials(form.protocol)) {
    return true;
  }
  return form.account.trim() !== '' && form.password !== '';
};

export const needsCredentials = (protocol: TTarsFileProtocol): boolean =>
  tarsProtocolNeedsCredentials(protocol);

export const usesHostName = (protocol: TTarsFileProtocol): boolean =>
  tarsProtocolUsesHostName(protocol);

/** Matches the original page: case-insensitive, across the fields on screen. */
export const filterFileSystems = (
  fileSystems: TTarsFileSystemSource[],
  search: string,
  protocol: string,
): TTarsFileSystemSource[] => {
  const query = search.trim().toLowerCase();
  return fileSystems.filter((fileSystem) => {
    if (protocol !== '' && fileSystem.mount_type !== protocol) {
      return false;
    }
    if (query === '') {
      return true;
    }
    return [fileSystem.name, fileSystem.host, fileSystem.path].some(
      (field) => field != null && field.toLowerCase().includes(query),
    );
  });
};

export interface FileRow {
  name: string;
  directory: string;
}

/**
 * The path a connection test walks: the folder on the form, or `/` before one
 * is picked. SMB paths may be typed with Windows backslashes.
 */
export const fileServerTestPath = (protocol: TTarsFileProtocol, path: string): string => {
  const value = path.trim() || '/';
  return protocol === 'SMB' ? value.replace(/\\/g, '/') : value;
};

const segmentsOf = (path: string): string[] => path.split('/').filter(Boolean);

/** An SMB path's first segment is the share; without one every later sync fails. */
export const hasSmbShare = (path: string): boolean =>
  segmentsOf(fileServerTestPath('SMB', path)).length > 0;

/**
 * What pwc_tars refuses to save, or saves but cannot sync: an SMB path with no
 * share, or an NFS group with no export picked.
 */
export const missingFolder = (form: Pick<FileSystemForm, 'protocol' | 'path'>): boolean =>
  (form.protocol === 'SMB' && !hasSmbShare(form.path)) ||
  (form.protocol === 'NFS' && form.path.trim() === '');

/**
 * An NFS server only mounts what it exports, so until one is picked the test
 * asks for the export list instead of walking `/`.
 */
export const listsNfsExports = (form: Pick<FileSystemForm, 'protocol' | 'path'>): boolean =>
  form.protocol === 'NFS' && form.path.trim() === '';

/** SMB tested at `/` answers with the server's share names rather than files. */
export const listsSmbShares = (protocol: TTarsFileProtocol, testedPath: string): boolean =>
  protocol === 'SMB' && segmentsOf(fileServerTestPath(protocol, testedPath)).length === 0;

/** Appends a folder discovered relative to `root` back onto it, e.g. `/` + `reports` → `/reports`. */
export const buildFullFolderPath = (root: string, relativeDir: string): string => {
  const normalisedRoot = root !== '' && root !== '/' ? root.replace(/\/+$/, '') : '';
  if (relativeDir === '') {
    return normalisedRoot === '' ? '/' : normalisedRoot;
  }
  return normalisedRoot === '' ? `/${relativeDir}` : `${normalisedRoot}/${relativeDir}`;
};

/**
 * A reported file, relative to the tested path. pwc_tars reports FTP and NFS
 * relative to it already, SFTP with the tested path as a prefix, and SMB
 * relative to the share root — so a test of `share/sub` comes back as `sub/…`.
 */
const relativeToTested = (
  protocol: TTarsFileProtocol,
  testedPath: string,
  file: string,
): string => {
  const root = fileServerTestPath(protocol, testedPath);
  const prefix =
    protocol === 'SMB' ? segmentsOf(root).slice(1).join('/') : root.replace(/\/+$/, '');
  const relative = protocol === 'SMB' ? file.replace(/\\/g, '/').replace(/^\/+/, '') : file;
  return prefix !== '' && relative.startsWith(`${prefix}/`)
    ? relative.slice(prefix.length + 1)
    : relative;
};

const toRow = (relative: string): FileRow => {
  const cut = relative.lastIndexOf('/');
  return {
    name: cut === -1 ? relative : relative.slice(cut + 1),
    directory: cut === -1 ? '' : relative.slice(0, cut),
  };
};

/**
 * Splits the paths pwc_tars walked into a name and its folder, relative to the
 * tested path, so a deep tree is readable without a horizontal scrollbar. A
 * directory reported as its own entry (trailing `/`) is dropped rather than
 * shown as a nameless file, and SMB's share list is not files at all.
 */
export const toFileRows = (
  protocol: TTarsFileProtocol,
  testedPath: string,
  files: string[],
): FileRow[] =>
  listsSmbShares(protocol, testedPath)
    ? []
    : files
        .filter((file) => !file.endsWith('/'))
        .map((file) => toRow(relativeToTested(protocol, testedPath, file)));

/** Every folder along the way to each directory, one path segment at a time. */
const foldersAlong = (directories: string[]): string[] => {
  const folders = new Set<string>();
  directories.forEach((directory) => {
    let acc = '';
    segmentsOf(directory).forEach((segment) => {
      acc = acc === '' ? segment : `${acc}/${segment}`;
      folders.add(acc);
    });
  });
  return Array.from(folders).sort((a, b) => a.localeCompare(b));
};

/**
 * Every folder along the way to any of `files` — what lets a folder be picked
 * from a list instead of typed by hand.
 */
export const discoverFolders = (files: string[]): string[] =>
  foldersAlong(
    files
      .filter((file) => !file.endsWith('/'))
      .map((file) => toRow(file.replace(/\\/g, '/')).directory),
  );

/** Every folder above `path`, not itself: `/a/b/c` → `/`, `/a`, `/a/b`. */
const ancestorFolders = (path: string): string[] => {
  const segments = segmentsOf(path);
  return segments.map((_, index) => `/${segments.slice(0, index).join('/')}`);
};

/** Segment by segment, so a folder always sorts right before its own subfolders. */
const compareFolderPaths = (a: string, b: string): number => {
  const left = segmentsOf(a);
  const right = segmentsOf(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const order = left[i].localeCompare(right[i]);
    if (order !== 0) {
      return order;
    }
  }
  return left.length - right.length;
};

/**
 * The folders a test lets the form pick, as full paths: every folder above the
 * tested one, the tested one, and every folder found beneath it (SMB at `/`:
 * each share). NFS can only mount what the server exports, so it lists the
 * exports and keeps only folders inside one; without an export list it keeps
 * the tested folder and what lies under it.
 */
export const folderOptions = (
  protocol: TTarsFileProtocol,
  testedPath: string,
  files: string[],
  nfsExports?: string[],
): string[] => {
  const root = fileServerTestPath(protocol, testedPath);
  const current = buildFullFolderPath(root, '');
  const found = listsSmbShares(protocol, testedPath)
    ? Array.from(new Set(files))
    : foldersAlong(toFileRows(protocol, testedPath, files).map(({ directory }) => directory));
  const candidates = [
    ...ancestorFolders(current),
    current,
    ...found.map((folder) => buildFullFolderPath(root, folder)),
  ];

  let options = candidates;
  if (protocol === 'NFS') {
    options =
      nfsExports != null
        ? [
            ...nfsExports,
            ...candidates.filter((path) =>
              nfsExports.some(
                (item) => item === '/' || path === item || path.startsWith(`${item}/`),
              ),
            ),
          ]
        : candidates.filter(
            (path) => path === current || path.startsWith(current === '/' ? '/' : `${current}/`),
          );
  }
  return Array.from(new Set(options)).sort(compareFolderPaths);
};

const withoutTrailingSlash = (path: string): string => path.replace(/\/+$/, '') || '/';

/** The option matching the folder on the form, if the last test offered it. */
export const selectedFolderOption = (
  options: string[],
  form: Pick<FileSystemForm, 'protocol' | 'path'>,
): string | undefined => {
  if (form.protocol === 'NFS' && form.path.trim() === '') {
    return undefined;
  }
  const current = withoutTrailingSlash(fileServerTestPath(form.protocol, form.path));
  return options.find((option) => withoutTrailingSlash(option) === current);
};

/**
 * `folder` relative to the tested folder — `''` for the tested folder itself —
 * or `null` when it lies outside it (an ancestor or another export), where the
 * last test saw none of its files.
 */
export const folderWithinTested = (
  protocol: TTarsFileProtocol,
  testedPath: string,
  folder: string,
): string | null => {
  const current = withoutTrailingSlash(
    buildFullFolderPath(fileServerTestPath(protocol, testedPath), ''),
  );
  const target = withoutTrailingSlash(folder);
  if (target === current) {
    return '';
  }
  const prefix = current === '/' ? '/' : `${current}/`;
  return target.startsWith(prefix) ? target.slice(prefix.length) : null;
};
