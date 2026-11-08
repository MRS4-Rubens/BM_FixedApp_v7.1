import fs from 'node:fs';
import path from 'node:path';

function getSiblingDir(entryRelPath: string): string {
  const norm = entryRelPath.replace(/\\/g, '/');
  if (norm.endsWith('.tsx')) {
    return norm.slice(0, -4);
  }
  if (norm.endsWith('.ts')) {
    return norm.slice(0, -3);
  }
  return norm;
}

function collectFiles(dirAbs: string, rootDir: string): string[] {
  if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) {
    return [];
  }
  const results: string[] = [];
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, rootDir));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      const rel = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      results.push(rel);
    }
  }
  return results;
}

/**
 * Lists the entry file followed by all recursive .ts/.tsx files in the sibling directory
 * named after the entry file without the .tsx/.ts extension, sorted alphabetically.
 */
export function listComponentSourceFiles(entryRelPath: string): string[] {
  const rootDir = process.cwd();
  const normEntry = entryRelPath.replace(/\\/g, '/');
  const files: string[] = [normEntry];
  const siblingRel = getSiblingDir(normEntry);
  const siblingAbs = path.resolve(rootDir, siblingRel);
  const siblingFiles = collectFiles(siblingAbs, rootDir).sort();
  files.push(...siblingFiles);
  return files;
}

/**
 * Returns the entry file's text + "\n" + every .ts/.tsx file (recursive, sorted)
 * inside the sibling folder whose name is the entry name without extension.
 * If the folder does not exist, returns entry text only.
 */
export function readComponentSources(entryRelPath: string): string {
  const rootDir = process.cwd();
  const allFiles = listComponentSourceFiles(entryRelPath);
  const contents = allFiles.map((file) => {
    const absPath = path.resolve(rootDir, file);
    return fs.readFileSync(absPath, 'utf8');
  });
  return contents.join('\n');
}

