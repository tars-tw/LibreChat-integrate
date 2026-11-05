import { CFB } from 'xlsx';
import { wordBinaryToText } from './doc';

const CLX_OFFSET = 0;
const FIB_SIZE = 0x200;
const PIECE_COMPRESSED = 0x40000000;
const TEXT_OFFSET = FIB_SIZE;

interface DocOptions {
  text: string;
  compressed?: boolean;
  flags?: number;
  version?: number;
  /** Characters past the main story, as footnotes and headers are stored. */
  otherStories?: string;
  propertyEntry?: boolean;
}

/** A compound file holding the streams a Word 97+ document needs: one piece over `text`. */
function buildDoc({
  text,
  compressed = false,
  flags = 0x0200,
  version = 0x00c1,
  otherStories = '',
  propertyEntry = false,
}: DocOptions): Buffer {
  const all = text + otherStories;
  const encoded = compressed ? Buffer.from(all, 'latin1') : Buffer.from(all, 'utf16le');

  const word = Buffer.alloc(FIB_SIZE + encoded.length);
  word.writeUInt16LE(0xa5ec, 0x00);
  word.writeUInt16LE(version, 0x02);
  word.writeUInt16LE(flags, 0x0a);
  word.writeInt32LE(text.length, 0x4c);
  encoded.copy(word, TEXT_OFFSET);

  const plcPcd = Buffer.alloc(16);
  plcPcd.writeUInt32LE(0, 0);
  plcPcd.writeUInt32LE(all.length, 4);
  plcPcd.writeUInt32LE(compressed ? (TEXT_OFFSET * 2) | PIECE_COMPRESSED : TEXT_OFFSET, 10);

  const pcdtHeader = Buffer.alloc(5);
  pcdtHeader.writeUInt8(0x02, 0);
  pcdtHeader.writeUInt32LE(plcPcd.length, 1);
  const prc = propertyEntry ? Buffer.from([0x01, 0x02, 0x00, 0xaa, 0xbb]) : Buffer.alloc(0);
  const table = Buffer.concat([prc, pcdtHeader, plcPcd]);

  word.writeUInt32LE(CLX_OFFSET, 0x01a2);
  word.writeUInt32LE(table.length, 0x01a6);

  const container = CFB.utils.cfb_new();
  CFB.utils.cfb_add(container, '/WordDocument', word);
  CFB.utils.cfb_add(container, flags & 0x0200 ? '/1Table' : '/0Table', table);
  return Buffer.from(CFB.write(container, { type: 'buffer' }));
}

describe('wordBinaryToText', () => {
  it('reads a UTF-16 piece', async () => {
    await expect(wordBinaryToText(buildDoc({ text: '第一段\r第二段\r' }))).resolves.toBe(
      '第一段\n第二段',
    );
  });

  it('reads a compressed piece as cp1252', async () => {
    await expect(
      wordBinaryToText(buildDoc({ text: 'caf\xe9 \x93quoted\x94\r', compressed: true })),
    ).resolves.toBe('café “quoted”');
  });

  it('finds the 0Table stream the flags name', async () => {
    await expect(wordBinaryToText(buildDoc({ text: 'Zero table\r', flags: 0 }))).resolves.toBe(
      'Zero table',
    );
  });

  it('skips property entries ahead of the piece table', async () => {
    await expect(
      wordBinaryToText(buildDoc({ text: 'After properties\r', propertyEntry: true })),
    ).resolves.toBe('After properties');
  });

  it('stops at the main story', async () => {
    await expect(
      wordBinaryToText(buildDoc({ text: 'Body\r', otherStories: 'Footnote\r' })),
    ).resolves.toBe('Body');
  });

  it('keeps a field result and drops its code, including when nested', async () => {
    const field = '\x13 HYPERLINK "x" \x14Link\x15';
    const nested = '\x13 IF \x13 PAGE \x14' + '1\x15 \x14Shown\x15';

    await expect(wordBinaryToText(buildDoc({ text: `${field} ${nested}\r` }))).resolves.toBe(
      'Link Shown',
    );
  });

  it('drops a resultless field unless it draws a Symbol-font character', async () => {
    const symbol = (code: number) => `\x13 SYMBOL ${code} \\f "Symbol" \\s 10\x15`;

    await expect(
      wordBinaryToText(
        buildDoc({
          text: `3${symbol(115)} 250${symbol(176)}C ${symbol(177)}5 ${symbol(1)}\x13 TOC \x15end\r`,
        }),
      ),
    ).resolves.toBe('3σ 250°C ±5 end');
  });

  it('ignores a SYMBOL field in another font', async () => {
    await expect(
      wordBinaryToText(buildDoc({ text: 'x\x13 SYMBOL 115 \\f "Wingdings"\x15y\r' })),
    ).resolves.toBe('xy');
  });

  it('turns table marks into rows and drops other control characters', async () => {
    await expect(
      wordBinaryToText(buildDoc({ text: 'a\x07b\x07\x07c\x07d\x07\x07\x01tail\x0cnext\r' })),
    ).resolves.toBe('a\tb\nc\td\ntail\nnext');
  });

  it('returns no text for an empty document', async () => {
    await expect(wordBinaryToText(buildDoc({ text: '\r\r' }))).resolves.toBe('');
  });

  it('refuses an encrypted document', async () => {
    await expect(wordBinaryToText(buildDoc({ text: 'x', flags: 0x0300 }))).rejects.toThrow(
      'Password-protected',
    );
  });

  it('refuses a document older than Word 97', async () => {
    await expect(wordBinaryToText(buildDoc({ text: 'x', version: 0x0065 }))).rejects.toThrow(
      'older than Word 97',
    );
  });

  it('refuses a compound file that is not a Word document', async () => {
    const container = CFB.utils.cfb_new();
    CFB.utils.cfb_add(container, '/Workbook', Buffer.alloc(16));
    const buffer = Buffer.from(CFB.write(container, { type: 'buffer' }));

    await expect(wordBinaryToText(buffer)).rejects.toThrow('Not a Word 97-2003 document');
  });

  it('refuses a file that is not a compound file', async () => {
    await expect(wordBinaryToText(Buffer.from('{\\rtf1 not binary word}'))).rejects.toThrow();
  });

  it('fails rather than reading past a corrupt piece table', async () => {
    const buffer = buildDoc({ text: 'x' });
    const container = CFB.read(buffer, { type: 'buffer' });
    const word = Buffer.from(CFB.find(container, '/WordDocument').content);
    word.writeUInt32LE(0x7fffff, 0x01a2);
    word.writeUInt32LE(0x7fffff, 0x01a6);
    CFB.utils.cfb_del(container, '/WordDocument');
    CFB.utils.cfb_add(container, '/WordDocument', word);

    await expect(
      wordBinaryToText(Buffer.from(CFB.write(container, { type: 'buffer' }))),
    ).rejects.toThrow();
  });
});
