import { logger } from '@librechat/data-schemas';
import { Constants } from 'librechat-data-provider';
import type { ThreadMessage } from '~/utils/message';
import type { TarsDataFile } from './sign';
import { isTarsConfigured } from '~/tars/client';
import { getThreadData } from '~/utils/message';
import { isTarsSpreadsheet } from './sign';

/** The fields of a LibreChat file this module reads. */
export interface TarsStoredFile {
  file_id: string;
  filename?: string;
  llmDeliveryPath?: string;
  text?: string;
}

/** The spreadsheets and text attachments in reach of this turn. */
export interface TarsTurnFiles {
  dataFiles: TarsDataFile[];
  /**
   * The thread's text attachments' extracted text, joined for a plugin's
   * `file_input`; read only when a plugin actually runs.
   */
  loadFileInput: () => Promise<string>;
}

export interface TarsTurnFilesSource {
  /** `file_id`s attached to the message being answered. */
  requestFileIds: readonly string[];
  conversationId?: string | null;
  /** Parent of the message being answered; earlier attachments are read up its chain. */
  parentMessageId?: string | null;
  /** The requesting user's own files among `fileIds`, in any order. */
  findOwnedFiles: (fileIds: string[], withText: boolean) => Promise<TarsStoredFile[]>;
  getThreadMessages?: (conversationId: string) => Promise<ThreadMessage[] | null>;
}

const EMPTY: TarsTurnFiles = { dataFiles: [], loadFileInput: async () => '' };

const filesByRequest = new WeakMap<object, TarsTurnFiles>();
const primeByRequest = new WeakMap<object, Promise<TarsTurnFiles>>();

/** What `primeTarsTurnFiles` resolved for this request, if it has finished. */
export function getTarsTurnFiles(req: object): TarsTurnFiles | undefined {
  return filesByRequest.get(req);
}

async function readThreadFileIds(source: TarsTurnFilesSource): Promise<string[]> {
  const { conversationId, parentMessageId, getThreadMessages } = source;
  if (!conversationId || !getThreadMessages) {
    return [];
  }
  if (!parentMessageId || parentMessageId === Constants.NO_PARENT) {
    return [];
  }
  const messages = await getThreadMessages(conversationId);
  return messages?.length ? getThreadData(messages, parentMessageId).fileIds : [];
}

/**
 * Attachments stay in reach for the rest of the thread, as the memory area's
 * files did: the message being answered plus every earlier one up its parent
 * chain (never a sibling branch). Spreadsheets go to pwc_tars's data tools;
 * files whose text the model reads feed a plugin's `file_input`.
 */
export async function resolveTarsTurnFiles(source: TarsTurnFilesSource): Promise<TarsTurnFiles> {
  const threadFileIds = await readThreadFileIds(source);
  const fileIds = [...new Set([...source.requestFileIds, ...threadFileIds])];
  if (fileIds.length === 0) {
    return EMPTY;
  }
  const byId = new Map(
    (await source.findOwnedFiles(fileIds, false)).map((file) => [file.file_id, file]),
  );
  const dataFiles: TarsDataFile[] = [];
  const textFileIds: string[] = [];
  for (const fileId of fileIds) {
    const file = byId.get(fileId);
    if (!file) {
      continue;
    }
    if (isTarsSpreadsheet(file.filename)) {
      dataFiles.push({ id: file.file_id, filename: file.filename ?? file.file_id });
    } else if (file.llmDeliveryPath === 'text') {
      textFileIds.push(file.file_id);
    }
  }
  const loadFileInput = async (): Promise<string> => {
    if (textFileIds.length === 0) {
      return '';
    }
    const texts = new Map(
      (await source.findOwnedFiles(textFileIds, true)).map((file) => [file.file_id, file.text]),
    );
    return textFileIds
      .map((fileId) => (texts.get(fileId) ?? '').trim())
      .filter(Boolean)
      .join('\n\n');
  };
  return { dataFiles, loadFileInput };
}

/**
 * Resolves the turn's files once per request (handoff agents share them) and
 * keeps the result for the tool factories. Fail-soft: a failed lookup leaves
 * the data tools unequipped rather than failing the turn.
 */
export function primeTarsTurnFiles(
  req: object,
  source: TarsTurnFilesSource,
): Promise<TarsTurnFiles> {
  const pending = primeByRequest.get(req);
  if (pending) {
    return pending;
  }
  const prime = (isTarsConfigured() ? resolveTarsTurnFiles(source) : Promise.resolve(EMPTY))
    .catch((error: unknown) => {
      logger.warn('[tars-files] Could not resolve the turn files; data tools stay off', error);
      return EMPTY;
    })
    .then((files) => {
      filesByRequest.set(req, files);
      return files;
    });
  primeByRequest.set(req, prime);
  return prime;
}

/** The runtime-context block naming the spreadsheets the data tools can query. */
export function buildTarsDataFilesContext(files: readonly TarsDataFile[]): string | null {
  if (files.length === 0) {
    return null;
  }
  const lines = files.map((file) => `- ${file.filename}`);
  return (
    '# Attached spreadsheets Runtime Context\n' +
    'Structured spreadsheet files attached to this conversation. All of them are loaded as ' +
    'tables for `tars_data_schema` (list the tables and columns) and `tars_data_query` (one ' +
    'read-only DuckDB query); `tars_create_chart` and `tars_generate_file` can query them too:\n' +
    lines.join('\n')
  );
}
