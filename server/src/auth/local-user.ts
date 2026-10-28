import type { Db } from '../db/pool';

// Single-user app: all data belongs to this one local user. Created on startup, so there is no sign-in.
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';
export const LOCAL_USER = { email: 'me@localhost', name: 'Me' };

export async function ensureLocalUser(db: Db): Promise<void> {
  await db.query(
    `INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, 'no-login')
     ON CONFLICT (id) DO NOTHING`,
    [LOCAL_USER_ID, LOCAL_USER.email, LOCAL_USER.name],
  );
}
