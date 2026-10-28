import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolves a folder that ships with the server (migrations, fixtures) both from source (src/...)
 * and from the bundled output (dist/...) by walking up until the folder is found.
 */
export function serverPath(...segments: string[]): string {
  let dir = here;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, ...segments);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate ${segments.join('/')} relative to ${here}`);
}
