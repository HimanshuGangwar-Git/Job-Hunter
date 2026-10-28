import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password';
import { issueToken, verifyToken } from '../../src/auth/tokens';
import { detectCvType } from '../../src/cv/extract-text';
import { canonicalSkill, findSkills } from '../../src/cv/skills';
import { RateLimiter } from '../../src/http/rate-limit';
import { FileStorage } from '../../src/storage';
import { loadConfig } from '../../src/config';
import { pickBestCv } from '../../src/matching/service';

const SECRET = 'x'.repeat(40);

describe('passwords', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects malformed stored values', async () => {
    expect(await verifyPassword('x', 'plaintext')).toBe(false);
  });
});

describe('tokens', () => {
  it('round-trips claims and rejects tampered or foreign-signed tokens', async () => {
    const token = await issueToken({ sub: 'user-1', email: 'a@example.com' }, SECRET, 1);
    expect(await verifyToken(token, SECRET)).toEqual({ sub: 'user-1', email: 'a@example.com' });
    expect(await verifyToken(token, 'y'.repeat(40))).toBeNull();
    expect(await verifyToken(`${token}tamper`, SECRET)).toBeNull();
  });
});

describe('rate limiter', () => {
  it('blocks after the limit within the window and resets after it', () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    limiter.consume('a');
    limiter.consume('a');
    expect(() => limiter.consume('a')).toThrow(/Too many attempts/);
    now = 1500;
    expect(() => limiter.consume('a')).not.toThrow();
  });
});

describe('file storage', () => {
  it('refuses paths that escape the storage root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'jh-storage-'));
    const storage = new FileStorage(root);
    await expect(storage.write('../escape.txt', Buffer.from('x'))).rejects.toThrow(/outside the storage root/);
    await storage.write('cvs/user/file.pdf', Buffer.from('%PDF'));
    expect((await readFile(path.join(root, 'cvs/user/file.pdf'))).toString()).toBe('%PDF');
  });
});

describe('CV upload type checks', () => {
  it('accepts a PDF only when the bytes are a PDF, regardless of extension', () => {
    expect(detectCvType('cv.pdf', Buffer.from('%PDF-1.7 body'))).toBe('pdf');
    expect(() => detectCvType('cv.pdf', Buffer.from('<html>not a pdf</html>'))).toThrow(/content matches its extension/);
  });

  it('accepts a DOCX only when it is a zip container', () => {
    expect(detectCvType('cv.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe('docx');
    expect(() => detectCvType('cv.docx', Buffer.from('plain text'))).toThrow();
    expect(() => detectCvType('cv.exe', Buffer.from('%PDF'))).toThrow();
  });
});

describe('skills taxonomy', () => {
  it('matches whole words only', () => {
    expect(findSkills('JavaScript and Java')).toEqual(expect.arrayContaining(['JavaScript', 'Java']));
    expect(findSkills('We value good communication')).not.toContain('Go');
    expect(findSkills('Express interest in our team')).not.toContain('Express.js');
    expect(findSkills('Strong JavaScript skills')).not.toContain('Java');
  });

  it('maps aliases to canonical names', () => {
    expect(findSkills('Postgres and K8s')).toEqual(expect.arrayContaining(['PostgreSQL', 'Kubernetes']));
    expect(canonicalSkill('reactjs')).toBe('React');
    expect(canonicalSkill('Custom Tool')).toBe('Custom Tool');
  });
});

describe('pickBestCv', () => {
  const cv = (id: string, skills: string[], isPrimary = false) =>
    ({ id, isPrimary, parsed: { skills, profile: {} } }) as unknown as Parameters<typeof pickBestCv>[1][number];

  it('chooses the CV that covers the most matched skills', () => {
    const cvs = [cv('primary', ['React'], true), cv('backend', ['Node.js', 'PostgreSQL', 'Docker'])];
    expect(pickBestCv(['Node.js', 'PostgreSQL'], cvs)).toBe('backend');
  });

  it('breaks ties in favour of the primary CV and returns null with no CVs', () => {
    const cvs = [cv('second', ['React']), cv('primary', ['React'], true)];
    expect(pickBestCv(['React'], cvs)).toBe('primary');
    expect(pickBestCv(['React'], [])).toBeNull();
  });
});

describe('configuration', () => {
  it('requires a strong JWT secret and a database URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', JWT_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ JWT_SECRET: 'x'.repeat(40) } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('parses comma lists and boolean flags', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: 'x'.repeat(40),
      GREENHOUSE_BOARDS: 'stripe, airbnb ,',
      ENABLE_MOCK_SOURCE: 'true',
    } as NodeJS.ProcessEnv);
    expect(config.GREENHOUSE_BOARDS).toEqual(['stripe', 'airbnb']);
    expect(config.ENABLE_MOCK_SOURCE).toBe(true);
    expect(config.SCHEDULER_ENABLED).toBe(true);
  });
});
