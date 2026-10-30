import { describe, it, expect } from 'vitest';
import {
  sanitizeFilename,
  makeAttachmentFilenames,
  type UploadExtension,
} from '@/lib/security/upload';

describe('Upload Filename Sanitisation & Deduplication (SEC-002)', () => {
  it('correctly maps known test vectors to sanitised, safe filenames', () => {
    const vectors: [string, UploadExtension, string][] = [
      ['../../etc/passwd', 'png', 'passwd.png'],
      ['report.html', 'png', 'report.png'],
      ['my file (1).JPG', 'jpg', 'my_file_1.jpg'],
      ['', 'png', 'attachment.png'],
      ['.htaccess', 'png', 'attachment.png'],
      ['日本語.png', 'png', 'attachment.png'],
      ['a..b.exe', 'png', 'a.b.png'],
    ];

    for (const [original, ext, expected] of vectors) {
      expect(sanitizeFilename(original, ext)).toBe(expected);
    }
  });

  it('truncates 300-character filenames so that total length <= 80 and ends with the extension', () => {
    const longName = `${'A'.repeat(300)}.pdf`;
    const result = sanitizeFilename(longName, 'png');
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('.png')).toBe(true);
    expect(result).toMatch(/^[A-Za-z0-9._-]{1,80}$/);
  });

  it('deduplicates filenames across a batch with numerical suffixes', () => {
    const batch = [
      { original: 'x.png', ext: 'png' as const },
      { original: 'x.png', ext: 'png' as const },
      { original: 'x.png', ext: 'png' as const },
    ];
    const names = makeAttachmentFilenames(batch);
    expect(names).toEqual(['x.png', 'x-2.png', 'x-3.png']);
  });

  it('passes deterministic pseudo-random fuzzing (200 hostile strings)', () => {
    // Linear congruential generator for reproducible pseudo-random fuzzing
    let seed = 1337;
    function rand(): number {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    }

    const hostileChars = [
      'a', 'Z', '0', '9', '.', '-', '_', ' ', '/', '\\', ':', '*', '?', '"', '<', '>', '|',
      '\0', '\x01', '\x1F', '\x7F', '\r', '\n', '\t',
      '日', '本', '語', '🔥', 'é', 'ü', 'ñ', '中', '文',
      '..', '...', '///', '\\\\\\',
    ];

    const batch: { original: string; ext: UploadExtension }[] = [];
    const extensions: UploadExtension[] = ['png', 'jpg', 'webp', 'pdf'];

    for (let index = 0; index < 200; index += 1) {
      const len = Math.floor(rand() * 120);
      let str = '';
      for (let charIndex = 0; charIndex < len; charIndex += 1) {
        const charChoice = hostileChars[Math.floor(rand() * hostileChars.length)];
        str += charChoice;
      }
      const ext = extensions[index % extensions.length];
      batch.push({ original: str, ext });
    }

    const results = makeAttachmentFilenames(batch);
    expect(results).toHaveLength(200);

    const seen = new Set<string>();

    for (let index = 0; index < results.length; index += 1) {
      const name = results[index];
      const ext = batch[index].ext;

      // Every output matches ^[A-Za-z0-9._-]{1,80}$
      expect(name).toMatch(/^[A-Za-z0-9._-]{1,80}$/);
      // Never starts with '.'
      expect(name.startsWith('.')).toBe(false);
      // Ends with the forced extension
      expect(name.endsWith(`.${ext}`)).toBe(true);
      // Unique names in batch
      expect(seen.has(name)).toBe(false);
      seen.add(name);
    }
  });
});

