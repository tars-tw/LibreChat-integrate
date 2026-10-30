import {
  TARS_PROTOCOL_DEFAULT_PORTS,
  tarsProtocolNeedsCredentials,
  tarsProtocolUsesHostName,
} from 'librechat-data-provider';
import type {
  TTarsFileProtocol,
  TTarsUnreadableDir,
  TTarsFileSystemConnectionTest,
} from 'librechat-data-provider';
import type { TarsFileSystemSource, TarsRawFileSystem } from './datasets';
import type { TarsErrorReply } from './client';
import { tarsFetch, tarsErrorReply, TarsRequestError } from './client';
import { toSafeFileSystem } from './datasets';

/**
 * Walking a share over SMB or SFTP is a real network round trip through
 * pwc_tars, which the default 15s client timeout cuts short.
 */
const CONNECT_TIMEOUT_MS = 60000;

export interface TarsFileSystemInput {
  name: string;
  description?: string;
  protocol: TTarsFileProtocol;
  host: string;
  port?: number;
  /** For SMB the first segment is the share name, e.g. `public/reports`. */
  path?: string;
  /** NetBIOS name, SMB only. */
  hostName?: string;
  /** Omitted or empty on update means "keep the stored account". */
  account?: string;
  /** Omitted or empty on update means "keep the stored password". */
  password?: string;
  enabled?: boolean;
  allowedKmIds?: string[];
}

interface ConnectionTestResponse {
  files?: string[];
  exports?: string[];
  unreadable_dirs?: TTarsUnreadableDir[];
}

interface FileSystemListResponse {
  dataset_file_systems?: TarsRawFileSystem[];
}

interface FileSystemMutationResponse {
  dataset_file_system?: TarsRawFileSystem;
}

/** Every document group, credentials stripped. */
export async function fetchTarsFileSystems(baseUrl?: string): Promise<TarsFileSystemSource[]> {
  const data = await tarsFetch<FileSystemListResponse>(
    '/api/dataset_file_system/get_dataset_file_systems',
    { baseUrl },
  );
  return (data?.dataset_file_systems ?? []).map(toSafeFileSystem);
}

/**
 * The stored row *with* its password. Server-side only: it exists so a
 * connection test can reuse a password the browser was never given.
 *
 * pwc_tars' list endpoint cannot be narrowed by `id` — its filter returns a
 * single model for that key while the route always iterates the result — so
 * the row is picked out here instead.
 */
async function fetchRawFileSystem(
  fileSystemId: string,
  baseUrl?: string,
): Promise<TarsRawFileSystem | null> {
  const data = await tarsFetch<FileSystemListResponse>(
    '/api/dataset_file_system/get_dataset_file_systems',
    { baseUrl },
  );
  return (data?.dataset_file_systems ?? []).find((row) => row.id === fileSystemId) ?? null;
}

const port = (input: TarsFileSystemInput): number =>
  input.port ?? TARS_PROTOCOL_DEFAULT_PORTS[input.protocol];

/** A protocol that takes no credentials must not carry the previous ones. */
const credentialsFor = (input: TarsFileSystemInput): { account: string; password: string } =>
  tarsProtocolNeedsCredentials(input.protocol)
    ? { account: input.account ?? '', password: input.password ?? '' }
    : { account: '', password: '' };

const connectionBody = (input: TarsFileSystemInput) => {
  const credentials = credentialsFor(input);
  return {
    name: input.name,
    description: input.description ?? '',
    host: input.host,
    port: port(input),
    path: input.path != null && input.path !== '' ? input.path : '/',
    mount_type: input.protocol,
    account: credentials.account,
    password: credentials.password,
    /**
     * Always sent, blank included: pwc_tars keeps the stored value only when
     * the key is absent, so a blank string is how switching away from SMB
     * clears the old server name.
     */
    hostname: tarsProtocolUsesHostName(input.protocol) ? (input.hostName ?? '') : '',
    allowed_km_ids: input.allowedKmIds ?? [],
  };
};

export async function createTarsFileSystem(
  tarsId: string,
  input: TarsFileSystemInput,
  baseUrl?: string,
): Promise<TarsFileSystemSource | null> {
  const response = await tarsFetch<FileSystemMutationResponse>(
    '/api/dataset_file_system/create_dataset_file_system',
    {
      method: 'POST',
      body: {
        ...connectionBody(input),
        status: input.enabled === false ? 0 : 1,
        created_by: tarsId,
      },
      baseUrl,
    },
  );
  return response?.dataset_file_system != null
    ? toSafeFileSystem(response.dataset_file_system)
    : null;
}

/**
 * Edits a document group.
 *
 * pwc_tars merges field by field and keeps the stored value for anything
 * falsy, so a blank account or password means "keep what is stored" — which is
 * what the form needs, since neither is ever sent to the browser. `status` is
 * sent only when `enabled` is given; pwc_tars compares it with `is not None`,
 * so 0 (disabled) is applied rather than dropped.
 */
export async function updateTarsFileSystem(
  tarsId: string,
  fileSystemId: string,
  input: TarsFileSystemInput,
  baseUrl?: string,
): Promise<TarsFileSystemSource | null> {
  const response = await tarsFetch<FileSystemMutationResponse>(
    `/api/dataset_file_system/update_dataset_file_system/${encodeURIComponent(fileSystemId)}`,
    {
      method: 'PUT',
      body: {
        ...connectionBody(input),
        ...(input.enabled != null ? { status: input.enabled ? 1 : 0 } : {}),
        updated_by: tarsId,
      },
      baseUrl,
    },
  );
  return response?.dataset_file_system != null
    ? toSafeFileSystem(response.dataset_file_system)
    : null;
}

export async function deleteTarsFileSystem(
  tarsId: string,
  fileSystemId: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch(
    `/api/dataset_file_system/delete_dataset_file_system/${encodeURIComponent(fileSystemId)}`,
    { method: 'DELETE', query: { operator_id: tarsId }, baseUrl },
  );
}

/**
 * Opens the connection and lists what the share currently holds.
 *
 * pwc_tars only walks the tree when `is_sync_all` is set; without it the call
 * verifies the login and the path but always answers with an empty list.
 *
 * `fileSystemId` lets an edit form test with the stored credentials still
 * hidden: pass the id and leave the account or password blank.
 *
 * `listExports` is how an NFS form that has not picked an export yet asks for
 * the server's exports: walking `/` instead would try to mount it, which most
 * servers do not export.
 */
export async function testTarsFileSystemConnection(
  input: TarsFileSystemInput & { fileSystemId?: string; listExports?: boolean },
  baseUrl?: string,
): Promise<TTarsFileSystemConnectionTest> {
  let credentials = credentialsFor(input);
  const needsStored =
    tarsProtocolNeedsCredentials(input.protocol) &&
    (credentials.account === '' || credentials.password === '');

  if (needsStored && input.fileSystemId != null && input.fileSystemId !== '') {
    const stored = await fetchRawFileSystem(input.fileSystemId, baseUrl);
    if (stored == null) {
      throw new TarsRequestError(
        404,
        '/api/dataset_file_system/get_dataset_file_systems',
        'Document group not found',
      );
    }
    credentials = {
      account: credentials.account !== '' ? credentials.account : (stored.account ?? ''),
      password: credentials.password !== '' ? credentials.password : (stored.password ?? ''),
    };
  }

  const data = await tarsFetch<ConnectionTestResponse>('/api/dataset_file_system/test_connection', {
    method: 'POST',
    timeoutMs: CONNECT_TIMEOUT_MS,
    baseUrl,
    body: {
      protocol: input.protocol,
      host: input.host,
      port: port(input),
      path: input.path != null && input.path !== '' ? input.path : '/',
      account: credentials.account !== '' ? credentials.account : null,
      password: credentials.password !== '' ? credentials.password : null,
      hostname: tarsProtocolUsesHostName(input.protocol) ? (input.hostName ?? null) : null,
      list_exports: input.protocol === 'NFS' && input.listExports === true,
      is_sync_all: true,
    },
  });

  const nfsExports = data?.exports;
  return {
    files: data?.files ?? [],
    unreadableDirs: data?.unreadable_dirs ?? [],
    ...(Array.isArray(nfsExports) ? { exports: nfsExports } : {}),
  };
}

/**
 * pysmb's errors append a dump of every SMB packet exchanged, and pwc_tars
 * puts the whole string inside its `（…）` — so the dump is cut back out,
 * leaving the reason and the share list that follows it.
 */
const withoutSmbPacketDump = (message: string): string =>
  message.replace(/\n=+ SMB Message \d+ =+[\s\S]*?(?=）|$)/, '');

/**
 * Answers a failed connection test. pwc_tars reports most failures as a 500
 * whose message is the file server's own reason (`連線失敗: 550 …`), so unlike
 * other routes that reason is relayed on a 5xx too; a timeout becomes a 504
 * the form can name.
 */
export function fileSystemTestErrorReply(error: unknown, fallback: string): TarsErrorReply {
  if (error instanceof TarsRequestError && error.serverMessage) {
    return {
      status: error.status < 500 ? error.status : 502,
      error: withoutSmbPacketDump(error.serverMessage),
    };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { status: 504, error: fallback };
  }
  return tarsErrorReply(error, fallback);
}
