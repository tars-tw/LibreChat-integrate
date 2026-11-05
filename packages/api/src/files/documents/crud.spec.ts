import os from 'os';
import path from 'path';
import * as fs from 'fs';
import JSZip from 'jszip';
import { parseDocument } from './crud';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const POTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.template';
const ODP_MIME = 'application/vnd.oasis.opendocument.presentation';

const slideXml = (paragraphs: string[]): string =>
  `<p:sld xmlns:a="a" xmlns:p="p"><p:txBody>${paragraphs
    .map((text) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`)
    .join('')}</p:txBody></p:sld>`;

describe('Document Parser', () => {
  test('parseDocument() parses text from docx', async () => {
    const file = {
      originalname: 'sample.docx',
      path: path.join(__dirname, 'sample.docx'),
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    } as Express.Multer.File;

    const document = await parseDocument({ file });

    expect(document).toEqual({
      bytes: 29,
      filename: 'sample.docx',
      filepath: 'document_parser',
      images: [],
      text: 'This is a sample DOCX file.\n\n',
    });
  });

  test('parseDocument() parses text from xlsx', async () => {
    const file = {
      originalname: 'sample.xlsx',
      path: path.join(__dirname, 'sample.xlsx'),
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    } as Express.Multer.File;

    const document = await parseDocument({ file });

    expect(document).toEqual({
      bytes: 66,
      filename: 'sample.xlsx',
      filepath: 'document_parser',
      images: [],
      text: 'Sheet One:\nData,on,first,sheet\nSecond Sheet:\nData,On\nSecond,Sheet\n',
    });
  });

  test('parseDocument() parses text from xls', async () => {
    const file = {
      originalname: 'sample.xls',
      path: path.join(__dirname, 'sample.xls'),
      mimetype: 'application/vnd.ms-excel',
    } as Express.Multer.File;

    const document = await parseDocument({ file });

    expect(document).toEqual({
      bytes: 31,
      filename: 'sample.xls',
      filepath: 'document_parser',
      images: [],
      text: 'Sheet One:\nData,on,first,sheet\n',
    });
  });

  test('parseDocument() parses text from ods', async () => {
    const file = {
      originalname: 'sample.ods',
      path: path.join(__dirname, 'sample.ods'),
      mimetype: 'application/vnd.oasis.opendocument.spreadsheet',
    } as Express.Multer.File;

    const document = await parseDocument({ file });

    expect(document).toEqual({
      bytes: 66,
      filename: 'sample.ods',
      filepath: 'document_parser',
      images: [],
      text: 'Sheet One:\nData,on,first,sheet\nSecond Sheet:\nData,On\nSecond,Sheet\n',
    });
  });

  test('parseDocument() parses text from odt', async () => {
    const file = {
      originalname: 'sample.odt',
      path: path.join(__dirname, 'sample.odt'),
      mimetype: 'application/vnd.oasis.opendocument.text',
    } as Express.Multer.File;

    const document = await parseDocument({ file });

    expect(document).toEqual({
      bytes: 50,
      filename: 'sample.odt',
      filepath: 'document_parser',
      images: [],
      text: 'This is a sample ODT file.\n\nIt has two paragraphs.',
    });
  });

  test('parseDocument() throws for odt with no extractable text', async () => {
    const file = {
      originalname: 'empty.odt',
      path: path.join(__dirname, 'empty.odt'),
      mimetype: 'application/vnd.oasis.opendocument.text',
    } as Express.Multer.File;

    await expect(parseDocument({ file })).rejects.toThrow('No text found in document');
  });

  test('parseDocument() aborts decompression when content.xml exceeds the size limit', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
    zip.file('content.xml', 'x'.repeat(51 * 1024 * 1024), { compression: 'DEFLATE' });
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    const tmpPath = path.join(__dirname, 'bomb.odt');
    await fs.promises.writeFile(tmpPath, buf);
    try {
      const file = {
        originalname: 'bomb.odt',
        path: tmpPath,
        mimetype: 'application/vnd.oasis.opendocument.text',
      } as Express.Multer.File;
      await expect(parseDocument({ file })).rejects.toThrow(/exceeds the 50MB decompressed limit/);
    } finally {
      await fs.promises.unlink(tmpPath);
    }
  });

  test('parseDocument() decodes XML entities and normalizes tab and spacing elements to spaces from odt', async () => {
    const file = {
      originalname: 'sample-entities.odt',
      path: path.join(__dirname, 'sample-entities.odt'),
      mimetype: 'application/vnd.oasis.opendocument.text',
    } as Express.Multer.File;

    const document = await parseDocument({ file });

    expect(document).toEqual({
      bytes: 19,
      filename: 'sample-entities.odt',
      filepath: 'document_parser',
      images: [],
      text: 'AT&T and A>B\n\nx y z',
    });
  });

  test.each([
    'application/msexcel',
    'application/x-msexcel',
    'application/x-ms-excel',
    'application/x-excel',
    'application/x-dos_ms_excel',
    'application/xls',
    'application/x-xls',
  ])('parseDocument() parses xls with variant MIME type: %s', async (mimetype) => {
    const file = {
      originalname: 'sample.xls',
      path: path.join(__dirname, 'sample.xls'),
      mimetype,
    } as Express.Multer.File;

    const document = await parseDocument({ file });

    expect(document).toEqual({
      bytes: 31,
      filename: 'sample.xls',
      filepath: 'document_parser',
      images: [],
      text: 'Sheet One:\nData,on,first,sheet\n',
    });
  });

  test('parseDocument() throws error for unhandled document type', async () => {
    const file = {
      originalname: 'nonexistent.file',
      path: path.join(__dirname, 'nonexistent.file'),
      mimetype: 'application/invalid',
    } as Express.Multer.File;

    await expect(parseDocument({ file })).rejects.toThrow(
      'Unsupported file type in document parser: application/invalid',
    );
  });

  test('parseDocument() throws error for empty document', async () => {
    const file = {
      originalname: 'empty.docx',
      path: path.join(__dirname, 'empty.docx'),
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    } as Express.Multer.File;

    await expect(parseDocument({ file })).rejects.toThrow('No text found in document');
  });

  test('parseDocument() rejects files exceeding the pre-parse size limit', async () => {
    const file = {
      originalname: 'oversized.docx',
      path: path.join(__dirname, 'sample.docx'),
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 16 * 1024 * 1024,
    } as Express.Multer.File;

    await expect(parseDocument({ file })).rejects.toThrow(
      /exceeds the 15MB document parser limit \(16MB\)/,
    );
  });

  test('parseDocument() allows files exactly at the size limit boundary', async () => {
    const file = {
      originalname: 'sample.docx',
      path: path.join(__dirname, 'sample.docx'),
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 15 * 1024 * 1024,
    } as Express.Multer.File;

    await expect(parseDocument({ file })).resolves.toBeDefined();
  });

  describe('presentations', () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'parse-pptx-'));
    });

    afterAll(async () => {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    const writeDeck = async (name: string, slides: Record<string, string>): Promise<string> => {
      const zip = new JSZip();
      for (const [entry, xml] of Object.entries(slides)) {
        zip.file(entry, xml);
      }
      zip.file('ppt/media/image1.png', Buffer.alloc(16));
      const deckPath = path.join(tempDir, name);
      await fs.promises.writeFile(
        deckPath,
        await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
      );
      return deckPath;
    };

    const deckFile = (
      deckPath: string,
      overrides: Partial<Express.Multer.File> = {},
    ): Express.Multer.File =>
      ({
        originalname: path.basename(deckPath),
        path: deckPath,
        mimetype: PPTX_MIME,
        ...overrides,
      }) as Express.Multer.File;

    test('parseDocument() reads slide text in slide-number order, skipping slides without text', async () => {
      const deckPath = await writeDeck('order.pptx', {
        'ppt/slides/slide10.xml': slideXml(['Last']),
        'ppt/slides/slide2.xml': slideXml(['系統一 &amp; 系統二', 'x &lt; y']),
        'ppt/slides/slide1.xml': slideXml(['First', 'Bullet']),
        'ppt/slides/slide3.xml': slideXml([]),
      });

      const document = await parseDocument({ file: deckFile(deckPath) });

      expect(document.filepath).toBe('document_parser');
      expect(document.text).toBe(
        'Slide 1:\nFirst\nBullet\n\nSlide 2:\n系統一 & 系統二\nx < y\n\nSlide 10:\nLast',
      );
    });

    test('parseDocument() reads a PowerPoint template', async () => {
      const deckPath = await writeDeck('brand.potx', {
        'ppt/slides/slide1.xml': slideXml(['Template']),
      });

      const document = await parseDocument({
        file: deckFile(deckPath, { mimetype: POTX_MIME }),
      });

      expect(document.text).toBe('Slide 1:\nTemplate');
    });

    test('parseDocument() throws for a deck with no slide text', async () => {
      const deckPath = await writeDeck('images-only.pptx', {
        'ppt/slides/slide1.xml': slideXml([]),
      });

      await expect(parseDocument({ file: deckFile(deckPath) })).rejects.toThrow(
        'No text found in document',
      );
    });

    test('parseDocument() does not apply the document size limit, since media is never read', async () => {
      const deckPath = await writeDeck('media-heavy.pptx', {
        'ppt/slides/slide1.xml': slideXml(['Still readable']),
      });

      const document = await parseDocument({
        file: deckFile(deckPath, { size: 60 * 1024 * 1024 }),
      });

      expect(document.text).toBe('Slide 1:\nStill readable');
    });

    test('parseDocument() refuses slide XML past the deck-wide decompressed cap', async () => {
      const padding = 'x'.repeat(40 * 1024 * 1024);
      const deckPath = await writeDeck('bomb.pptx', {
        'ppt/slides/slide1.xml': padding,
        'ppt/slides/slide2.xml': padding,
        'ppt/slides/slide3.xml': padding,
      });

      await expect(parseDocument({ file: deckFile(deckPath) })).rejects.toThrow(
        /exceed the 100MB decompressed limit/,
      );
    });

    test('parseDocument() reads an OpenDocument presentation slide by slide', async () => {
      const file = {
        originalname: 'sample.odp',
        path: path.join(__dirname, 'sample.odp'),
        mimetype: ODP_MIME,
      } as Express.Multer.File;

      const document = await parseDocument({ file });

      expect(document.filepath).toBe('document_parser');
      expect(document.text).toMatch(/^Slide 1:\nLibreChat conversion fixture/);
    });

    test('parseDocument() leaves speaker notes and alt text out of an ODP, and skips empty slides', async () => {
      const zip = new JSZip();
      zip.file(
        'content.xml',
        `<office:document-content><office:body><office:presentation>
<draw:page draw:name="a"><draw:frame><svg:title>Alt text</svg:title><text:p>First</text:p></draw:frame>
<presentation:notes><draw:page-thumbnail/><text:p>Speaker note</text:p></presentation:notes></draw:page>
<draw:page draw:name="b"/>
<draw:page draw:name="c"></draw:page>
<draw:page draw:name="d"><text:p>A &amp; B</text:p></draw:page>
</office:presentation></office:body></office:document-content>`,
      );
      const deckPath = path.join(tempDir, 'notes.odp');
      await fs.promises.writeFile(deckPath, await zip.generateAsync({ type: 'nodebuffer' }));

      const document = await parseDocument({
        file: deckFile(deckPath, { mimetype: ODP_MIME, size: 60 * 1024 * 1024 }),
      });

      expect(document.text).toBe('Slide 1:\nFirst\n\nSlide 3:\nA & B');
    });

    test('parseDocument() rejects a file that is not a zip archive', async () => {
      await expect(
        parseDocument({ file: deckFile(path.join(__dirname, 'sample.xls')) }),
      ).rejects.toThrow();
    });
  });

  test('parseDocument() parses text from a Word 97-2003 document', async () => {
    const file = {
      originalname: 'sample.doc',
      path: path.join(__dirname, 'sample.doc'),
      mimetype: 'application/msword',
    } as Express.Multer.File;

    const document = await parseDocument({ file });

    expect(document).toEqual({
      bytes: 66,
      filename: 'sample.doc',
      filepath: 'document_parser',
      images: [],
      text: '第一段:舊版 Word 文件範例。\nSecond paragraph with ASCII.',
    });
  });

  test('parseDocument() keeps the size limit for a Word 97-2003 document', async () => {
    const file = {
      originalname: 'oversized.doc',
      path: path.join(__dirname, 'sample.doc'),
      mimetype: 'application/msword',
      size: 16 * 1024 * 1024,
    } as Express.Multer.File;

    await expect(parseDocument({ file })).rejects.toThrow(/exceeds the 15MB document parser limit/);
  });

  test('parseDocument() parses empty xlsx with only sheet name', async () => {
    const file = {
      originalname: 'empty.xlsx',
      path: path.join(__dirname, 'empty.xlsx'),
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    } as Express.Multer.File;

    const document = await parseDocument({ file });

    expect(document).toEqual({
      bytes: 8,
      filename: 'empty.xlsx',
      filepath: 'document_parser',
      images: [],
      text: 'Empty:\n\n',
    });
  });

  test('xlsx exports read and utils as named imports', async () => {
    const { read, utils } = await import('xlsx');
    expect(typeof read).toBe('function');
    expect(typeof utils?.sheet_to_csv).toBe('function');
  });
});
