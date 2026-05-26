import Database from 'better-sqlite3';
import { applySchema } from './schema.js';
import { join } from 'node:path';

const DB_PATH = process.env.FORGE_DB_PATH ?? join(process.cwd(), 'forge.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    applySchema(_db);
  }
  return _db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}
