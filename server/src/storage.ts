import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Files are only ever written under generated names (UUIDs), never under user-supplied names.
export class FileStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(relativePath: string): string {
    const full = path.resolve(this.root, relativePath);
    if (!full.startsWith(this.root + path.sep)) {
      throw new Error('Refusing to access a path outside the storage root');
    }
    return full;
  }

  async write(relativePath: string, data: Buffer): Promise<string> {
    const full = this.resolve(relativePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    return relativePath;
  }

  async read(relativePath: string): Promise<Buffer> {
    return readFile(this.resolve(relativePath));
  }

  async remove(relativePath: string): Promise<void> {
    await rm(this.resolve(relativePath), { force: true });
  }
}
