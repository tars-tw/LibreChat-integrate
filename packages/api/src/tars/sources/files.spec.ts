jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import type { TarsDocument } from '~/tars/knowledge';
import {
  resolveTarsSourceLinks,
  listTarsSourceDocuments,
  tarsSourceStaticSegments,
  invalidateTarsSourceDocumentsCache,
} from './files';
import { hasValidTarsSourceSignature } from './link';

const HR = '1ea10af6c442450eaa4775ef6717683c';
const FTP = 'f266d8c65ef04e3aa8a8db51a6d8b81a';

const doc = (id: string, filename: string, kb: string, file_path: string | null): TarsDocument => ({
  id,
  filename,
  knowledge_base_ids: kb,
  file_path,
  status: 2,
});

const listings: Record<string, TarsDocument[]> = {
  [HR]: [
    doc(
      'd1',
      'XX公司人力資源管理辦法（臺灣）.docx',
      HR,
      `apps/static/uploads/${HR}/manual/XX公司人力資源管理辦法（臺灣）.docx`,
    ),
    doc(
      'd2',
      '人力資源管理制度（中國廠區）.docx',
      HR,
      `apps/static/uploads/${HR}/manual/人力資源管理制度（中國廠區）.docx`,
    ),
    doc('d3', '共用.pdf', HR, `apps/static/uploads/${HR}/manual/共用.pdf`),
    doc('d4', '沒有檔案.docx', HR, null),
  ],
  [FTP]: [
    doc('f1', 'demo_ftp.txt', FTP, `apps/static/uploads/${FTP}/ftp/2b7f/d380/demo_ftp.txt`),
    doc('f2', '共用.pdf', FTP, `apps/static/uploads/${FTP}/manual/共用.pdf`),
  ],
};

const list = jest.fn(async (id: string) => listings[id] ?? []);

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret';
  invalidateTarsSourceDocumentsCache();
  list.mockClear();
});

describe('tarsSourceStaticSegments', () => {
  it('keeps a stored file inside its own knowledge base folder', () => {
    expect(tarsSourceStaticSegments(`apps/static/uploads/${HR}/manual/a b.docx`, HR)).toEqual([
      'uploads',
      HR,
      'manual',
      'a b.docx',
    ]);
    expect(
      tarsSourceStaticSegments(`apps\\static\\uploads\\${FTP}\\ftp\\fs\\assoc\\x.txt`, FTP),
    ).toEqual(['uploads', FTP, 'ftp', 'fs', 'assoc', 'x.txt']);
  });

  it('refuses anything outside that folder', () => {
    expect(tarsSourceStaticSegments(`apps/static/uploads/${FTP}/manual/x.pdf`, HR)).toBeNull();
    expect(tarsSourceStaticSegments(`apps/static/uploads/${HR}/../${FTP}/x.pdf`, HR)).toBeNull();
    expect(tarsSourceStaticSegments(`apps/static/uploads/${HR}/`, HR)).toBeNull();
    expect(tarsSourceStaticSegments('apps/static/sqlite/default.db', HR)).toBeNull();
    expect(tarsSourceStaticSegments(null, HR)).toBeNull();
  });
});

describe('resolveTarsSourceLinks', () => {
  it('links each cited stored file by its exact name', async () => {
    const links = await resolveTarsSourceLinks(
      {
        agentId: 'agent_1',
        knowledgeBaseIds: [HR],
        filenames: [
          'XX公司人力資源管理辦法（臺灣）.docx',
          '人力資源管理制度（中國廠區）',
          'https://law.moj.gov.tw/News/NewsList.aspx',
          '沒有檔案.docx',
        ],
      },
      list,
    );

    expect([...links.keys()]).toEqual(['XX公司人力資源管理辦法（臺灣）.docx']);
    const url = new URL(links.get('XX公司人力資源管理辦法（臺灣）.docx') ?? '', 'http://x');
    expect(url.pathname).toBe(`/api/tars/kb-files/agent_1/${HR}/d1`);
    const ref = { agentId: 'agent_1', knowledgeBaseId: HR, documentId: 'd1' };
    expect(hasValidTarsSourceSignature(ref, url.searchParams.get('sig') ?? undefined)).toBe(true);
  });

  it('names the knowledge base that holds the file, and skips a name several hold', async () => {
    const links = await resolveTarsSourceLinks(
      { agentId: 'agent_1', knowledgeBaseIds: [HR, FTP], filenames: ['demo_ftp.txt', '共用.pdf'] },
      list,
    );

    expect([...links.keys()]).toEqual(['demo_ftp.txt']);
    expect(links.get('demo_ftp.txt')).toContain(`/api/tars/kb-files/agent_1/${FTP}/f1?sig=`);
  });

  it('answers without links when pwc_tars cannot list the documents', async () => {
    const failing = jest.fn(async () => {
      throw new Error('down');
    });
    const links = await resolveTarsSourceLinks(
      { agentId: 'agent_1', knowledgeBaseIds: [HR], filenames: ['共用.pdf'] },
      failing,
    );
    expect(links.size).toBe(0);

    await listTarsSourceDocuments(HR, list);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('reuses a knowledge base listing across searches of one answer', async () => {
    const input = { agentId: 'agent_1', knowledgeBaseIds: [HR], filenames: ['共用.pdf'] };
    await resolveTarsSourceLinks(input, list);
    await resolveTarsSourceLinks(input, list);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
