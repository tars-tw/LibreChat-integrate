import { logger } from '@librechat/data-schemas';
import { Constants } from 'librechat-data-provider';
import type { TarsGeneratedLinkMessage } from './generated';
import type { TarsDataFile } from './sign';
import {
  collectTarsGeneratedLinks,
  TARS_GENERATED_LINK_FIELDS,
  buildTarsGeneratedFilesContext,
} from './generated';
import { isTarsConfigured } from '~/tars/client';
import { getThreadData } from '~/utils/message';
import { isTarsSpreadsheet } from './sign';

/**
 * The message fields `getThreadMessages` is asked to load: the parent chain, its
 * uploads, and the generated links of its `tars_trace` attachments. An
 * attachment's own `file_id` stays out on purpose, so which files the data
 * tools see does not change.
 */
export const TARS_THREAD_MESSAGE_FIELDS: string = `messageId parentMessageId files ${TARS_GENERATED_LINK_FIELDS}`;

/** The fields of a LibreChat file this module reads. */
export interface TarsStoredFile {
  file_id: string;
  filename?: string;
  type?: string;
  llmDeliveryPath?: string;
  text?: string;
}

/** The spreadsheets and text attachments in reach of this turn. */
export interface TarsTurnFiles {
  dataFiles: TarsDataFile[];
  /** The text attachments whose extracted text reaches the model. */
  textFiles: TarsDataFile[];
  /** The documents the provider reads as the file itself, such as a PDF. */
  providerFiles: TarsDataFile[];
  /** Images, whichever way they reach the model. */
  imageFiles: TarsDataFile[];
  /** Attachments kept out of the prompt (`llmDeliveryPath: none` or unset), read by tools if at all. */
  otherFiles: TarsDataFile[];
  /**
   * The thread's text attachments' extracted text, joined for a plugin's
   * `file_input`; read only when a plugin actually runs.
   */
  loadFileInput: () => Promise<string>;
  /**
   * The runtime-context block listing the charts and files TARS tools
   * generated earlier in the thread; null when there are none.
   */
  generatedFilesContext: string | null;
}

export interface TarsTurnFilesSource {
  /** `file_id`s attached to the message being answered. */
  requestFileIds: readonly string[];
  conversationId?: string | null;
  /** Parent of the message being answered; earlier attachments are read up its chain. */
  parentMessageId?: string | null;
  /** The requesting user's own files among `fileIds`, in any order. */
  findOwnedFiles: (fileIds: string[], withText: boolean) => Promise<TarsStoredFile[]>;
  /** Loads the conversation's messages with the given projection. */
  getThreadMessages?: (
    conversationId: string,
    fields: string,
  ) => Promise<TarsGeneratedLinkMessage[] | null>;
  /** `tars.generatedLinksLimit`; the schema default when unset. */
  generatedLinksLimit?: number;
}

const EMPTY: TarsTurnFiles = {
  dataFiles: [],
  textFiles: [],
  providerFiles: [],
  imageFiles: [],
  otherFiles: [],
  loadFileInput: async () => '',
  generatedFilesContext: null,
};

const filesByRequest = new WeakMap<object, TarsTurnFiles>();
const primeByRequest = new WeakMap<object, Promise<TarsTurnFiles>>();

/** What `primeTarsTurnFiles` resolved for this request, if it has finished. */
export function getTarsTurnFiles(req: object): TarsTurnFiles | undefined {
  return filesByRequest.get(req);
}

async function readThread(source: TarsTurnFilesSource): Promise<TarsGeneratedLinkMessage[]> {
  const { conversationId, parentMessageId, getThreadMessages } = source;
  if (!conversationId || !getThreadMessages) {
    return [];
  }
  if (!parentMessageId || parentMessageId === Constants.NO_PARENT) {
    return [];
  }
  return (await getThreadMessages(conversationId, TARS_THREAD_MESSAGE_FIELDS)) ?? [];
}

/**
 * Attachments stay in reach for the rest of the thread, as the memory area's
 * files did: the message being answered plus every earlier one up its parent
 * chain (never a sibling branch). Spreadsheets go to pwc_tars's data tools;
 * files whose text the model reads feed a plugin's `file_input`. Every
 * attachment lands in exactly one kind, so the audit trace lists — and an admin
 * can download — each file the turn could see. The same walk lists the charts
 * and files TARS tools generated, so the thread is read once for both.
 */
export async function resolveTarsTurnFiles(source: TarsTurnFilesSource): Promise<TarsTurnFiles> {
  const thread = await readThread(source);
  const { messageIds, fileIds: threadFileIds } = getThreadData(thread, source.parentMessageId);
  const generatedFilesContext = buildTarsGeneratedFilesContext(
    collectTarsGeneratedLinks(thread, messageIds, source.generatedLinksLimit),
  );
  const fileIds = [...new Set([...source.requestFileIds, ...threadFileIds])];
  if (fileIds.length === 0) {
    return { ...EMPTY, generatedFilesContext };
  }
  const byId = new Map(
    (await source.findOwnedFiles(fileIds, false)).map((file) => [file.file_id, file]),
  );
  const dataFiles: TarsDataFile[] = [];
  const textFiles: TarsDataFile[] = [];
  const providerFiles: TarsDataFile[] = [];
  const imageFiles: TarsDataFile[] = [];
  const otherFiles: TarsDataFile[] = [];
  for (const fileId of fileIds) {
    const file = byId.get(fileId);
    if (!file) {
      continue;
    }
    const ref = { id: file.file_id, filename: file.filename ?? file.file_id };
    if (isTarsSpreadsheet(file.filename)) {
      dataFiles.push(ref);
    } else if (typeof file.type === 'string' && file.type.startsWith('image/')) {
      imageFiles.push(ref);
    } else if (file.llmDeliveryPath === 'text') {
      textFiles.push(ref);
    } else if (file.llmDeliveryPath === 'provider') {
      providerFiles.push(ref);
    } else {
      otherFiles.push(ref);
    }
  }
  const textFileIds = textFiles.map((file) => file.id);
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
  return {
    dataFiles,
    textFiles,
    providerFiles,
    imageFiles,
    otherFiles,
    loadFileInput,
    generatedFilesContext,
  };
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
    'read-only DuckDB query); `tars_create_chart` and `tars_generate_file`, when equipped, can ' +
    'query them too:\n' +
    lines.join('\n')
  );
}
