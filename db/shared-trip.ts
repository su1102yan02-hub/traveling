import { neon } from "@neondatabase/serverless";

export const TRIP_ID = "new-trip-2026";
export const DEFAULT_SHARE_CODE = "TRIP-START";

type SqlClient = ReturnType<typeof neon>;
type DatabaseRow = Record<string, unknown>;

let client: SqlClient | null = null;
let schemaReady: Promise<void> | null = null;

export function getTripDb(): SqlClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("数据库尚未连接，请先在 Vercel 项目中添加 Neon Postgres");
  }
  client ??= neon(databaseUrl);
  return client;
}

async function initializeSchema(sql: SqlClient) {
  await sql.transaction([
    sql.query("CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, share_code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, destination TEXT NOT NULL, budget DOUBLE PRECISION NOT NULL, created_at TIMESTAMPTZ NOT NULL)"),
    sql.query("CREATE TABLE IF NOT EXISTS expenses (id BIGINT PRIMARY KEY, trip_id TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, time TEXT NOT NULL, day INTEGER NOT NULL, created_by TEXT NOT NULL DEFAULT '我')"),
    sql.query("CREATE TABLE IF NOT EXISTS plans (id BIGINT PRIMARY KEY, trip_id TEXT NOT NULL, time TEXT NOT NULL, title TEXT NOT NULL, place TEXT NOT NULL, day INTEGER NOT NULL, done BOOLEAN NOT NULL DEFAULT FALSE)"),
    sql.query("CREATE TABLE IF NOT EXISTS trip_members (id BIGSERIAL PRIMARY KEY, trip_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, last_seen TIMESTAMPTZ NOT NULL)"),
    sql.query("CREATE TABLE IF NOT EXISTS day_photos (id BIGSERIAL PRIMARY KEY, trip_id TEXT NOT NULL, day INTEGER NOT NULL, place TEXT NOT NULL, url TEXT NOT NULL, source_type TEXT NOT NULL, object_key TEXT)"),
    sql.query("CREATE TABLE IF NOT EXISTS trip_settings (trip_id TEXT PRIMARY KEY, start_date TEXT NOT NULL, end_date TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL)"),
    sql.query("CREATE TABLE IF NOT EXISTS trip_archives (id BIGINT PRIMARY KEY, title TEXT NOT NULL, destination TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, snapshot_json JSONB NOT NULL, archived_at TIMESTAMPTZ NOT NULL)"),
    sql.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ"),
    sql.query("ALTER TABLE trip_members ADD COLUMN IF NOT EXISTS device_id TEXT"),
    sql.query("CREATE INDEX IF NOT EXISTS expenses_trip_idx ON expenses (trip_id, id DESC)"),
    sql.query("CREATE INDEX IF NOT EXISTS plans_trip_day_idx ON plans (trip_id, day, time)"),
    sql.query("CREATE UNIQUE INDEX IF NOT EXISTS trip_members_trip_device_idx ON trip_members (trip_id, device_id) WHERE device_id IS NOT NULL"),
    sql.query(
      "INSERT INTO trips (id, share_code, title, destination, budget, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (share_code) DO NOTHING",
      [TRIP_ID, DEFAULT_SHARE_CODE, "我的新旅程", "添加目的地", 0, new Date().toISOString()],
    ),
  ]);
}

export async function ensureTripSchema(): Promise<SqlClient> {
  const sql = getTripDb();
  if (!schemaReady) {
    schemaReady = initializeSchema(sql).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
  return sql;
}

function withNumericId(row: DatabaseRow) {
  return { ...row, id: Number(row.id) };
}

export async function readSharedTrip() {
  const sql = await ensureTripSchema();
  const tripRows = await sql.query("SELECT id, share_code AS \"shareCode\", title, destination, budget, created_at AS \"createdAt\" FROM trips WHERE share_code = $1", [DEFAULT_SHARE_CODE]) as DatabaseRow[];
  const trip = tripRows[0];
  if (!trip) throw new Error("Shared trip not found");

  const [expenseRows, planRows, memberRows, photoRows, settingRows, archiveRows] = await Promise.all([
    sql.query("SELECT id, category, title, amount, time, day, created_by AS \"createdBy\", occurred_at AS \"occurredAt\" FROM expenses WHERE trip_id = $1 ORDER BY id DESC", [TRIP_ID]),
    sql.query("SELECT id, time, title, place, day, done FROM plans WHERE trip_id = $1 ORDER BY day, time", [TRIP_ID]),
    sql.query("SELECT device_id AS \"deviceId\", name, color, last_seen AS \"lastSeen\" FROM trip_members WHERE trip_id = $1 ORDER BY last_seen DESC LIMIT 20", [TRIP_ID]),
    sql.query("SELECT id, day, place, url, source_type AS \"sourceType\" FROM day_photos WHERE trip_id = $1 ORDER BY id DESC", [TRIP_ID]),
    sql.query("SELECT start_date AS \"startDate\", end_date AS \"endDate\" FROM trip_settings WHERE trip_id = $1", [TRIP_ID]),
    sql.query("SELECT id, title, destination, start_date AS \"startDate\", end_date AS \"endDate\", snapshot_json AS \"snapshotJson\", archived_at AS \"archivedAt\" FROM trip_archives ORDER BY archived_at DESC"),
  ]) as DatabaseRow[][];

  const histories = archiveRows.map((row) => {
    const { snapshotJson, ...summary } = row;
    const snapshot = typeof snapshotJson === "string" ? JSON.parse(snapshotJson) : snapshotJson;
    return { ...withNumericId(summary), snapshot: snapshot || { expenses: [], plan: [], photos: [] } };
  });

  return {
    trip: { ...trip, ...(settingRows[0] || {}) },
    expenses: expenseRows.map(withNumericId),
    plan: planRows.map(withNumericId),
    members: memberRows,
    photos: photoRows.map(withNumericId),
    histories,
  };
}
