import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  compilePrintStylesheet,
  renderGeneratedModule,
  GENERATED_RELATIVE_PATH,
} from './print-css/compile';

async function main(): Promise<void> {
  try {
    const rootDir = process.cwd();
    const css = await compilePrintStylesheet(rootDir);
    const content = renderGeneratedModule(css);
    const outputPath = path.join(rootDir, GENERATED_RELATIVE_PATH);
    await writeFile(outputPath, content, 'utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    console.log(`Successfully generated ${GENERATED_RELATIVE_PATH} (${bytes} bytes).`);
  } catch (error: unknown) {
    console.error('Failed to build print stylesheet:', error);
    process.exit(1);
  }
}

void main();

