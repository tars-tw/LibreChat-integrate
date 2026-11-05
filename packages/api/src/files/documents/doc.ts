/** The part of the SheetJS CFB API this reader uses; `xlsx` types its `CFB` export as `any`. */
interface CompoundFileReader {
  read(data: Buffer, options: { type: 'buffer' }): object;
  find(container: object, path: string): { content?: Uint8Array | number[] } | null;
}

/** Field offsets in the Word 97+ File Information Block, per [MS-DOC] 2.5. */
const FIB = {
  ident: 0x00,
  version: 0x02,
  flags: 0x0a,
  mainTextLength: 0x4c,
  clxOffset: 0x01a2,
  clxLength: 0x01a6,
} as const;

const WORD_IDENT = 0xa5ec;
const WORD_97_VERSION = 0x00c0;
const FLAG_ENCRYPTED = 0x0100;
const FLAG_TABLE_STREAM_1 = 0x0200;
const CLX_PROPERTY_ENTRY = 0x01;
const CLX_PIECE_TABLE = 0x02;
const PIECE_DESCRIPTOR_SIZE = 8;
const PIECE_COMPRESSED = 0x40000000;
const PIECE_OFFSET_MASK = 0x3fffffff;

const FIELD_BEGIN = 0x13;
const FIELD_SEPARATOR = 0x14;
const FIELD_END = 0x15;
const CELL_MARK = 0x07;

const SYMBOL_UPPERCASE = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ';
const SYMBOL_LOWERCASE = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ';
const SYMBOL_SIGNS: Record<number, string> = {
  0xa3: '≤',
  0xa5: '∞',
  0xac: '←',
  0xad: '↑',
  0xae: '→',
  0xaf: '↓',
  0xb0: '°',
  0xb1: '±',
  0xb3: '≥',
  0xb4: '×',
  0xb5: '∝',
  0xb7: '•',
  0xb8: '÷',
  0xb9: '≠',
  0xba: '≡',
  0xbb: '≈',
  0xd6: '√',
  0xe5: '∑',
};

const cp1252 = new TextDecoder('windows-1252');

const readStream = (reader: CompoundFileReader, container: object, name: string): Buffer | null => {
  const content = reader.find(container, name)?.content;
  return content ? Buffer.from(content) : null;
};

/** Locates the piece table: the plcPcd inside the Clx, past any leading property entries. */
function findPieceTable(table: Buffer, clxOffset: number, clxLength: number) {
  const end = clxOffset + clxLength;
  let position = clxOffset;
  while (position < end) {
    const kind = table[position];
    if (kind === CLX_PIECE_TABLE) {
      return { start: position + 5, size: table.readUInt32LE(position + 1) };
    }
    if (kind !== CLX_PROPERTY_ENTRY) {
      break;
    }
    position += 3 + table.readUInt16LE(position + 1);
  }
  throw new Error('Word document has no piece table');
}

/** Reads the main document story, which pieces store as either cp1252 bytes or UTF-16LE. */
function readMainText(word: Buffer, table: Buffer): string {
  const mainLength = word.readInt32LE(FIB.mainTextLength);
  const { start, size } = findPieceTable(
    table,
    word.readUInt32LE(FIB.clxOffset),
    word.readUInt32LE(FIB.clxLength),
  );
  const pieceCount = Math.floor((size - 4) / (4 + PIECE_DESCRIPTOR_SIZE));
  const descriptors = start + (pieceCount + 1) * 4;

  let text = '';
  for (let i = 0; i < pieceCount; i++) {
    const cpStart = table.readUInt32LE(start + i * 4);
    const cpEnd = Math.min(table.readUInt32LE(start + (i + 1) * 4), mainLength);
    if (cpEnd <= cpStart) {
      break;
    }
    const length = cpEnd - cpStart;
    const location = table.readUInt32LE(descriptors + i * PIECE_DESCRIPTOR_SIZE + 2);
    const offset = location & PIECE_OFFSET_MASK;
    if (location & PIECE_COMPRESSED) {
      text += cp1252.decode(word.subarray(offset / 2, offset / 2 + length));
    } else {
      text += word.subarray(offset, offset + length * 2).toString('utf16le');
    }
  }
  return text;
}

/**
 * The character a `SYMBOL n \f "Symbol"` field draws. Word's Symbol font is Adobe Symbol: its
 * letters are Greek, and its high range holds the math signs specifications rely on.
 */
function symbolFieldText(fieldCode: string): string {
  const match = fieldCode.match(/^\s*SYMBOL\s+(\d+)\s+\\f\s+"?Symbol"?/i);
  if (!match) {
    return '';
  }
  const charCode = Number(match[1]);
  if (charCode >= 0x41 && charCode <= 0x5a) {
    return SYMBOL_UPPERCASE[charCode - 0x41];
  }
  if (charCode >= 0x61 && charCode <= 0x7a) {
    return SYMBOL_LOWERCASE[charCode - 0x61];
  }
  return SYMBOL_SIGNS[charCode] ?? '';
}

/**
 * Turns Word's in-band control characters into plain text in one pass. A field reads as
 * `BEGIN code SEPARATOR result END` and may nest, so its result is kept rather than its code.
 * A field with no separator has no stored result; of those, only a symbol shows anything.
 */
function cleanWordText(raw: string): string {
  const openFields: Array<{ inCode: boolean; fieldCode: string }> = [];
  let hiddenDepth = 0;
  let text = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const field = openFields[openFields.length - 1];
    if (code === FIELD_BEGIN) {
      openFields.push({ inCode: true, fieldCode: '' });
      hiddenDepth += 1;
    } else if (code === FIELD_SEPARATOR) {
      if (field?.inCode) {
        field.inCode = false;
        hiddenDepth -= 1;
      }
    } else if (code === FIELD_END) {
      openFields.pop();
      if (field?.inCode) {
        hiddenDepth -= 1;
        text += hiddenDepth === 0 ? symbolFieldText(field.fieldCode) : '';
      }
    } else if (hiddenDepth > 0) {
      if (field?.inCode) {
        field.fieldCode += raw[i];
      }
    } else if (code === 0x0d || code === 0x0b || code === 0x0c) {
      text += '\n';
    } else if (code === CELL_MARK) {
      text += '\t';
    } else if (code === 0x1e) {
      text += '-';
    } else if (code >= 0x20 || code === 0x09) {
      text += raw[i];
    }
  }
  return text
    .replace(/\t\t+/g, '\n')
    .replace(/\t\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extracts the main story of a binary Word 97-2003 document (.doc). Headers, footers,
 * footnotes and text boxes are separate stories and are not read, and images have no text.
 *
 * @throws {Error} if the file is not a compound file, predates Word 97, or is encrypted.
 */
export async function wordBinaryToText(buffer: Buffer): Promise<string> {
  /* Inline for the same reason as the other xlsx consumers in `crud.ts`. */
  const { CFB } = await import('xlsx');
  const reader: CompoundFileReader = CFB;
  const container = reader.read(buffer, { type: 'buffer' });

  const word = readStream(reader, container, 'WordDocument');
  if (!word || word.length <= FIB.clxLength + 4 || word.readUInt16LE(FIB.ident) !== WORD_IDENT) {
    throw new Error('Not a Word 97-2003 document');
  }
  if (word.readUInt16LE(FIB.version) < WORD_97_VERSION) {
    throw new Error('Word documents older than Word 97 are not supported');
  }
  const flags = word.readUInt16LE(FIB.flags);
  if (flags & FLAG_ENCRYPTED) {
    throw new Error('Password-protected Word documents cannot be read');
  }

  const table = readStream(reader, container, flags & FLAG_TABLE_STREAM_1 ? '1Table' : '0Table');
  if (!table) {
    throw new Error('Word document is missing its table stream');
  }
  return cleanWordText(readMainText(word, table));
}
