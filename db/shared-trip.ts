import { env } from "cloudflare:workers";

const TRIP_ID = "new-trip-2026";
export const DEFAULT_SHARE_CODE = "TRIP-START";

export function getTripDb() {
  if (!env.DB) throw new Error("D1 database binding is unavailable");
  return env.DB;
}

export async function ensureTripSchema() {
  const db = getTripDb();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, share_code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, destination TEXT NOT NULL, budget REAL NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY, trip_id TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, amount REAL NOT NULL, time TEXT NOT NULL, day INTEGER NOT NULL, created_by TEXT NOT NULL DEFAULT '我')"),
    db.prepare("CREATE TABLE IF NOT EXISTS plans (id INTEGER PRIMARY KEY, trip_id TEXT NOT NULL, time TEXT NOT NULL, title TEXT NOT NULL, place TEXT NOT NULL, day INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS trip_members (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, last_seen TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS day_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id TEXT NOT NULL, day INTEGER NOT NULL, place TEXT NOT NULL, url TEXT NOT NULL, source_type TEXT NOT NULL, object_key TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS trip_settings (trip_id TEXT PRIMARY KEY, start_date TEXT NOT NULL, end_date TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS trip_archives (id INTEGER PRIMARY KEY, title TEXT NOT NULL, destination TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, snapshot_json TEXT NOT NULL, archived_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS expenses_trip_idx ON expenses (trip_id, id DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS plans_trip_day_idx ON plans (trip_id, day, time)"),
  ]);

  const trip = await db.prepare("SELECT id FROM trips WHERE share_code = ?").bind(DEFAULT_SHARE_CODE).first();
  if (!trip) {
    await db.batch([
      db.prepare("INSERT INTO trips (id, share_code, title, destination, budget, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(TRIP_ID, DEFAULT_SHARE_CODE, "我的新旅程", "添加目的地", 0, new Date().toISOString()),
    ]);
  }
  return db;
}

export async function readSharedTrip() {
  const db = await ensureTripSchema();
  const trip = await db.prepare("SELECT * FROM trips WHERE share_code = ?").bind(DEFAULT_SHARE_CODE).first();
  if (!trip) throw new Error("Shared trip not found");
  const [expenseRows, planRows, members, photos, settings, archiveRows] = await Promise.all([
    db.prepare("SELECT id, category, title, amount, time, day, created_by as createdBy FROM expenses WHERE trip_id = ? ORDER BY id DESC").bind(trip.id).all(),
    db.prepare("SELECT id, time, title, place, day, done FROM plans WHERE trip_id = ? ORDER BY day, time").bind(trip.id).all(),
    db.prepare("SELECT name, color FROM trip_members WHERE trip_id = ? ORDER BY id").bind(trip.id).all(),
    db.prepare("SELECT id, day, place, url, source_type as sourceType FROM day_photos WHERE trip_id = ? ORDER BY id DESC").bind(trip.id).all(),
    db.prepare("SELECT start_date as startDate, end_date as endDate FROM trip_settings WHERE trip_id = ?").bind(trip.id).first(),
    db.prepare("SELECT id, title, destination, start_date as startDate, end_date as endDate, snapshot_json as snapshotJson, archived_at as archivedAt FROM trip_archives ORDER BY archived_at DESC").all(),
  ]);
  const histories = archiveRows.results.map((row) => {
    const { snapshotJson, ...summary } = row as Record<string, unknown>;
    try { return { ...summary, snapshot: JSON.parse(String(snapshotJson)) }; }
    catch { return { ...summary, snapshot: { expenses: [], plan: [], photos: [] } }; }
  });
  return { trip: { ...trip, ...(settings || {}) }, expenses: expenseRows.results, plan: planRows.results.map((item) => ({ ...item, done: Boolean(item.done) })), members: members.results, photos: photos.results, histories };
}

export { TRIP_ID };
