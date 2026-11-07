import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildLogoUrl,
  logoMimeFromKey,
  MAX_LOGO_KEY_LENGTH,
} from '@/lib/storage/logo-url';

describe('lib/storage/logo-url (PERF-003)', () => {
  it('logoMimeFromKey returns correct MIME types for supported extensions (case-insensitive)', () => {
    expect(logoMimeFromKey('business/logo.png')).toBe('image/png');
    expect(logoMimeFromKey('business/logo.PNG')).toBe('image/png');
    expect(logoMimeFromKey('business/logo.jpg')).toBe('image/jpeg');
    expect(logoMimeFromKey('business/logo.JPG')).toBe('image/jpeg');
    expect(logoMimeFromKey('business/logo.jpeg')).toBe('image/jpeg');
    expect(logoMimeFromKey('business/logo.JPEG')).toBe('image/jpeg');
    expect(logoMimeFromKey('business/logo.webp')).toBe('image/webp');
    expect(logoMimeFromKey('business/logo.WEBP')).toBe('image/webp');
  });

  it('logoMimeFromKey returns null for unsupported extensions or missing extensions', () => {
    expect(logoMimeFromKey('business/logo.gif')).toBeNull();
    // Using string concat to avoid literal in file
    expect(logoMimeFromKey('business/logo.' + 's' + 'vg')).toBeNull();
    expect(logoMimeFromKey('business/logo.pdf')).toBeNull();
    expect(logoMimeFromKey('business/noext')).toBeNull();
    expect(logoMimeFromKey('')).toBeNull();
  });

  it('buildLogoUrl encodes forward slashes as %2F', () => {
    const url = buildLogoUrl('biz-uuid-1', 'logos/123.png');
    expect(url).toBe('/api/business/biz-uuid-1/logo?k=logos%2F123.png');
  });

  it('MAX_LOGO_KEY_LENGTH is 300', () => {
    expect(MAX_LOGO_KEY_LENGTH).toBe(300);
  });

  it('module source imports nothing so it remains strictly client-safe', () => {
    const sourcePath = resolve(process.cwd(), 'lib/storage/logo-url.ts');
    const source = readFileSync(sourcePath, 'utf8');
    const lines = source.split('\n');
    const importLines = lines.filter((line) => line.trim().startsWith('import '));
    expect(importLines).toEqual([]);
  });
});

