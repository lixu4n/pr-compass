import { createRequire } from 'node:module'
// Vite 5 predates node:sqlite; native require keeps the built-in out of its module resolver.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { hash } from './security.js'
import type { Job, Session, Settings, Stage } from './types.js'

/** Single-service SQLite store. Run one process against a persistent local volume. */
export class Store {
  db: InstanceType<typeof DatabaseSync>
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') chmodSync(path, 0o600)
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth (id TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, repositoryId INTEGER NOT NULL, installationId INTEGER NOT NULL,
        fullName TEXT NOT NULL, pr INTEGER NOT NULL, sha TEXT NOT NULL, baseSha TEXT NOT NULL,
        generation TEXT NOT NULL, stage TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
        createdAt TEXT NOT NULL, startedAt TEXT, inferenceAt TEXT, checkId INTEGER, usage TEXT,
        UNIQUE(repositoryId, pr, sha, baseSha));
      CREATE INDEX IF NOT EXISTS job_queue ON jobs(stage, id);
      CREATE INDEX IF NOT EXISTS job_budget ON jobs(repositoryId, inferenceAt);`)
  }
  close() { this.db.close() }
  getSettings(id: number): Settings | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE id=?').get(id)
    return row ? JSON.parse(String(row.value)) as Settings : undefined
  }
  saveSettings(s: Settings) {
    this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(s.repositoryId, JSON.stringify(s))
  }
  removeSettings(id: number) { this.db.prepare('DELETE FROM settings WHERE id=?').run(id) }
  revokeInstallation(id: number) {
    for (const row of this.db.prepare('SELECT id,value FROM settings').all()) {
      const s = JSON.parse(String(row.value)) as Settings
      if (s.installationId === id) this.removeSettings(Number(row.id))
    }
  }
  putSession(id: string, s: Session) {
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(id), JSON.stringify(s), s.expires)
  }
  session(id: string): Session | undefined {
    const row = this.db.prepare('SELECT value FROM sessions WHERE id=? AND expires>?').get(hash(id), Date.now())
    return row ? JSON.parse(String(row.value)) as Session : undefined
  }
  logout(id: string) { this.db.prepare('DELETE FROM sessions WHERE id=?').run(hash(id)) }
  oauth(state: string, verifier: string) {
    this.db.prepare('DELETE FROM oauth WHERE expires<?').run(Date.now())
    this.db.prepare('INSERT INTO oauth VALUES (?,?,?)').run(hash(state), verifier, Date.now() + 600_000)
  }
  consumeOAuth(state: string): string | undefined {
    const row = this.db.prepare('DELETE FROM oauth WHERE id=? AND expires>? RETURNING verifier').get(hash(state), Date.now())
    return row ? String(row.verifier) : undefined
  }
  enqueue(delivery: string, job: Pick<Job, 'repositoryId' | 'installationId' | 'fullName' | 'pr' | 'sha' | 'baseSha' | 'generation'>): boolean {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const inserted = this.db.prepare('INSERT OR IGNORE INTO deliveries VALUES (?,?)').run(delivery, new Date().toISOString())
      if (!inserted.changes) { this.db.exec('COMMIT'); return false }
      const result = this.db.prepare(`INSERT OR IGNORE INTO jobs
        (repositoryId,installationId,fullName,pr,sha,baseSha,generation,stage,createdAt)
        VALUES (?,?,?,?,?,?,?,'queued',?)`).run(job.repositoryId, job.installationId, job.fullName, job.pr, job.sha, job.baseSha, job.generation, new Date().toISOString())
      this.db.exec('COMMIT')
      return Number(result.changes) > 0
    } catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  take(): Job | undefined {
    return this.db.prepare(`UPDATE jobs SET stage='gathering',startedAt=?
      WHERE id=(SELECT id FROM jobs WHERE stage='queued' ORDER BY id LIMIT 1) RETURNING *`)
      .get(new Date().toISOString()) as unknown as Job | undefined
  }
  update(id: number, stage: Stage, message: string) {
    this.db.prepare('UPDATE jobs SET stage=?,message=? WHERE id=?').run(stage, message, id)
  }
  check(id: number, checkId: number) { this.db.prepare('UPDATE jobs SET checkId=? WHERE id=?').run(checkId, id) }
  usage(id: number, usage: unknown) { this.db.prepare('UPDATE jobs SET usage=? WHERE id=?').run(JSON.stringify(usage), id) }
  /** Reserve immediately before inference, counting failures too. Never refund uncertain billing. */
  reserve(job: Job, limit: number): boolean {
    const day = new Date().toISOString().slice(0, 10)
    const result = this.db.prepare(`UPDATE jobs SET inferenceAt=? WHERE id=? AND inferenceAt IS NULL AND
      (SELECT count(*) FROM jobs WHERE repositoryId=? AND inferenceAt>=?) < ?`)
      .run(new Date().toISOString(), job.id, job.repositoryId, day, limit)
    return Number(result.changes) === 1
  }
  recover(): Job[] {
    const jobs = this.db.prepare("SELECT * FROM jobs WHERE stage IN ('gathering','analyzing','posting')").all() as unknown as Job[]
    this.db.exec("UPDATE jobs SET stage='interrupted',message='Service restarted. Outcome may be unknown; no automatic paid retry.' WHERE stage IN ('gathering','analyzing','posting')")
    return jobs
  }
  recent(repositoryId: number): Job[] {
    return this.db.prepare('SELECT * FROM jobs WHERE repositoryId=? ORDER BY id DESC LIMIT 20').all(repositoryId) as unknown as Job[]
  }
  cleanup() {
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now())
    this.db.prepare('DELETE FROM oauth WHERE expires<?').run(Date.now())
    // Retain job deduplication indefinitely; deliveries contain IDs only.
    this.db.prepare("DELETE FROM deliveries WHERE createdAt < datetime('now','-30 days')").run()
  }
}

/** SQLite's OS-backed exclusive lock releases on process exit, including crashes. */
export function acquireServiceLock(path: string) {
  const lock = new DatabaseSync(path)
  try {
    lock.exec('CREATE TABLE IF NOT EXISTS service_lock (id INTEGER); BEGIN EXCLUSIVE;')
    chmodSync(path, 0o600)
    return () => lock.close()
  } catch {
    lock.close()
    throw new Error('Another Compass service holds this data directory. Run exactly one replica.')
  }
}
