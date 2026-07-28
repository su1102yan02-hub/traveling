import { DEFAULT_SHARE_CODE, ensureTripSchema, readSharedTrip, TRIP_ID } from "../../../db/shared-trip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = Record<string, unknown>;

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (code && code.toUpperCase() !== DEFAULT_SHARE_CODE) return Response.json({ error: "旅程码不存在" }, { status: 404 });
  try {
    return Response.json(await readSharedTrip());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sql = await ensureTripSchema();
    const payload = await request.json() as Payload;

    if (payload.action === "add_expense") {
      const item = payload.item as Payload;
      await sql.query(
        "INSERT INTO expenses (id, trip_id, category, title, amount, time, day, created_by, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO UPDATE SET category = EXCLUDED.category, title = EXCLUDED.title, amount = EXCLUDED.amount, time = EXCLUDED.time, day = EXCLUDED.day, created_by = EXCLUDED.created_by, occurred_at = EXCLUDED.occurred_at",
        [item.id, TRIP_ID, item.category, item.title, item.amount, item.time, item.day, String(item.createdBy || "同行旅伴").slice(0, 20), new Date().toISOString()],
      );
    } else if (payload.action === "update_expense") {
      const item = payload.item as Payload;
      await sql.query("UPDATE expenses SET category = $1, title = $2, amount = $3, day = $4 WHERE id = $5 AND trip_id = $6", [item.category, item.title, item.amount, item.day, item.id, TRIP_ID]);
    } else if (payload.action === "delete_expense") {
      await sql.query("DELETE FROM expenses WHERE id = $1 AND trip_id = $2", [payload.id, TRIP_ID]);
    } else if (payload.action === "toggle_plan") {
      await sql.query("UPDATE plans SET done = $1 WHERE id = $2 AND trip_id = $3", [Boolean(payload.done), payload.id, TRIP_ID]);
    } else if (payload.action === "replace_plan") {
      const day = Number(payload.day);
      const items = payload.items as Payload[];
      await sql.transaction([
        sql.query("DELETE FROM plans WHERE trip_id = $1 AND day = $2", [TRIP_ID, day]),
        ...items.map((item) => sql.query("INSERT INTO plans (id, trip_id, time, title, place, day, done) VALUES ($1, $2, $3, $4, $5, $6, $7)", [item.id, TRIP_ID, item.time, item.title, item.place, day, Boolean(item.done)])),
      ]);
    } else if (payload.action === "replace_all_plan") {
      const items = payload.items as Payload[];
      await sql.transaction([
        sql.query("DELETE FROM plans WHERE trip_id = $1", [TRIP_ID]),
        ...items.map((item) => sql.query("INSERT INTO plans (id, trip_id, time, title, place, day, done) VALUES ($1, $2, $3, $4, $5, $6, $7)", [item.id, TRIP_ID, item.time, item.title, item.place, item.day, Boolean(item.done)])),
      ]);
    } else if (payload.action === "update_trip") {
      await sql.transaction([
        sql.query("UPDATE trips SET title = $1, destination = $2 WHERE id = $3", [payload.title || "我的新旅程", payload.destination || "待定目的地", TRIP_ID]),
        sql.query("INSERT INTO trip_settings (trip_id, start_date, end_date, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (trip_id) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, updated_at = EXCLUDED.updated_at", [TRIP_ID, payload.startDate, payload.endDate, new Date().toISOString()]),
      ]);
    } else if (payload.action === "archive_trip") {
      const snapshot = await readSharedTrip();
      const trip = snapshot.trip as Payload;
      const archiveId = Date.now();
      await sql.query(
        "INSERT INTO trip_archives (id, title, destination, start_date, end_date, snapshot_json, archived_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)",
        [archiveId, trip.title || "未命名旅程", trip.destination || "待定目的地", trip.startDate || "", trip.endDate || "", JSON.stringify({ trip, expenses: snapshot.expenses, plan: snapshot.plan, photos: snapshot.photos }), new Date().toISOString()],
      );
    } else if (payload.action === "update_archive") {
      const id = Number(payload.id);
      if (!id) return Response.json({ error: "缺少历史旅程编号" }, { status: 400 });
      await sql.query(
        "UPDATE trip_archives SET title = $1, destination = $2, start_date = $3, end_date = $4 WHERE id = $5",
        [String(payload.title || "未命名旅程").slice(0, 80), String(payload.destination || "待定目的地").slice(0, 80), String(payload.startDate || ""), String(payload.endDate || ""), id],
      );
    } else if (payload.action === "refresh_archive") {
      const id = Number(payload.id);
      if (!id) return Response.json({ error: "缺少历史旅程编号" }, { status: 400 });
      const snapshot = await readSharedTrip();
      await sql.query(
        "UPDATE trip_archives SET snapshot_json = $1::jsonb, archived_at = $2 WHERE id = $3",
        [JSON.stringify({ trip: snapshot.trip, expenses: snapshot.expenses, plan: snapshot.plan, photos: snapshot.photos }), new Date().toISOString(), id],
      );
    } else if (payload.action === "delete_archive") {
      const id = Number(payload.id);
      if (!id) return Response.json({ error: "缺少历史旅程编号" }, { status: 400 });
      await sql.query("DELETE FROM trip_archives WHERE id = $1", [id]);
    } else if (payload.action === "set_day_photo") {
      await sql.transaction([
        sql.query("DELETE FROM day_photos WHERE trip_id = $1 AND day = $2", [TRIP_ID, payload.day]),
        sql.query("INSERT INTO day_photos (trip_id, day, place, url, source_type, object_key) VALUES ($1, $2, $3, $4, $5, $6)", [TRIP_ID, payload.day, payload.place || "行程地点", payload.url, payload.sourceType || "library", null]),
      ]);
    } else if (payload.action === "upsert_member") {
      const member = payload.member as Payload;
      const deviceId = String(member.deviceId || "").slice(0, 80);
      if (!deviceId) return Response.json({ error: "缺少成员身份" }, { status: 400 });
      const name = String(member.name || "同行旅伴").trim().slice(0, 20) || "同行旅伴";
      const color = /^#[0-9a-f]{6}$/i.test(String(member.color || "")) ? String(member.color) : "#2f6b55";
      await sql.query(
        "INSERT INTO trip_members (trip_id, device_id, name, color, last_seen) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (trip_id, device_id) WHERE device_id IS NOT NULL DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, last_seen = EXCLUDED.last_seen",
        [TRIP_ID, deviceId, name, color, new Date().toISOString()],
      );
    } else {
      return Response.json({ error: "未知操作" }, { status: 400 });
    }

    return Response.json(await readSharedTrip());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 500 });
  }
}
