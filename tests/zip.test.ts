import { describe, expect, it } from 'vitest';
import { crc32, createZip, readStoredZip } from '../src/core/zip';

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips files, including non-ASCII names', () => {
    const files = [
      { name: 'Café Hand.otf', data: new Uint8Array([1, 2, 3, 250]) },
      { name: 'How to install.txt', data: new TextEncoder().encode('hello') },
    ];
    const zip = createZip(files, new Date(2026, 0, 2, 3, 4, 6));
    const back = readStoredZip(zip);
    expect(back.map((f) => f.name)).toEqual(files.map((f) => f.name));
    expect(Array.from(back[0].data)).toEqual([1, 2, 3, 250]);
    // End-of-central-directory record: two entries.
    const view = new DataView(zip.buffer);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 12, true)).toBe(2);
  });
});
