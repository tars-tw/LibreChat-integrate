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
 * SFTP reports paths with the tested path itself as a prefix; every other
 * protocol already answers relative to it. Stripping it here (when there is
 * one) lets both the row list and the folder picker treat every protocol the
 * same, relative to whatever path was actually tested.
 */
const stripTestedRoot = (file: string, testedRootPath: string): string => {
  const normalised = file.replace(/\\/g, '/');
  const normalisedRoot =
    testedRootPath !== '' && testedRootPath !== '/' ? testedRootPath.replace(/\/+$/, '') : '';
  if (normalisedRoot === '') {
    return normalised;
  }
  if (normalised === normalisedRoot) {
    return '';
  }
  return normalised.startsWith(`${normalisedRoot}/`)
    ? normalised.slice(normalisedRoot.length + 1)
    : normalised;
};

/**
 * Splits the paths pwc_tars walked into a name and its folder, so a deep tree
 * is readable without a horizontal scrollbar. Files at the root show no folder.
 * A directory pwc_tars reported as its own entry (trailing `/`) is dropped
 * rather than shown as a nameless file.
 */
export const toFileRows = (files: string[], testedRootPath = ''): FileRow[] =>
  files
    .filter((file) => !file.endsWith('/'))
    .map((file) => stripTestedRoot(file, testedRootPath))
    .map((relative) => {
      const cut = relative.lastIndexOf('/');
      return {
        name: cut === -1 ? relative : relative.slice(cut + 1),
        directory: cut === -1 ? '' : relative.slice(0, cut),
      };
    });

/** Appends a folder discovered relative to `root` back onto it, e.g. `public` + `reports` → `public/reports`. */
export const buildFullFolderPath = (root: string, relativeDir: string): string => {
  const normalisedRoot = root !== '' && root !== '/' ? root.replace(/\/+$/, '') : '';
  if (relativeDir === '') {
    return normalisedRoot === '' ? '/' : normalisedRoot;
  }
  return normalisedRoot === '' ? relativeDir : `${normalisedRoot}/${relativeDir}`;
};

/**
 * Every folder along the way to any file pwc_tars reported, one path segment
 * at a time and relative to the tested root — this is what lets the shared
 * folder be picked from a list instead of typed by hand.
 */
export const discoverFolders = (files: string[], testedRootPath = ''): string[] => {
  const folders = new Set<string>();
  toFileRows(files, testedRootPath).forEach(({ directory }) => {
    if (directory === '') {
      return;
    }
    let acc = '';
    directory.split('/').forEach((segment) => {
      if (segment === '') {
        return;
      }
      acc = acc === '' ? segment : `${acc}/${segment}`;
      folders.add(acc);
    });
  });
  return Array.from(folders).sort((a, b) => a.localeCompare(b));
};
