import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

export function openCursor(file) {
  const cursor = { file, offset: 0, rest: '' };
  Object.defineProperty(cursor, 'decoder', { value: new StringDecoder('utf8'), writable: true, enumerable: false });
  return cursor;
}

// Reads bytes appended since cursor.offset. A trailing fragment without newline stays in cursor.rest.
export function readNew(cursor) {
  const records = [];
  let bad = 0;
  let fd;
  try {
    fd = fs.openSync(cursor.file, 'r');
  } catch {
    return { records, bad };
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size < cursor.offset) { // truncated or replaced: start over
      cursor.offset = 0;
      cursor.rest = '';
      cursor.decoder = new StringDecoder('utf8');
    }
    const CHUNK = 1 << 20;
    const buf = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(size - cursor.offset, 1)));
    while (cursor.offset < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - cursor.offset), cursor.offset);
      if (n <= 0) break;
      cursor.offset += n;
      const text = cursor.rest + (cursor.decoder || (cursor.decoder = new StringDecoder('utf8'))).write(buf.subarray(0, n));
      const cut = text.lastIndexOf('\n');
      if (cut < 0) { cursor.rest = text; continue; }
      cursor.rest = text.slice(cut + 1);
      for (const raw of text.slice(0, cut).split('\n')) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (!line.trim()) continue;
        try { records.push(JSON.parse(line)); } catch { bad++; }
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return { records, bad };
}
