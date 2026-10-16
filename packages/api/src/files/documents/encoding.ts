const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Decodes a delimited-text export the way Excel writes it. UTF-8 (with or without BOM) and
 * BOM-marked UTF-16 decode exactly; anything else falls back to Big5, which is what Excel
 * emits for "CSV" on a zh-TW Windows install, so those files render instead of turning into
 * replacement characters.
 */
export function decodeSpreadsheetText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer);
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer);
  }
  try {
    return utf8.decode(buffer);
  } catch {
    return new TextDecoder('big5').decode(buffer);
  }
}
