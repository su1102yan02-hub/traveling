import { env } from "cloudflare:workers";
import { ensureTripSchema, readSharedTrip, TRIP_ID } from "../../../db/shared-trip";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return new Response("missing key", { status: 400 });
  const object = await env.PHOTOS.get(key);
  if (!object) return new Response("not found", { status: 404 });
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("photo");
    const day = Number(form.get("day"));
    const place = String(form.get("place") || "行程地点");
    if (!(file instanceof File) || !file.type.startsWith("image/")) return Response.json({ error: "请选择照片" }, { status: 400 });
    if (file.size > 12 * 1024 * 1024) return Response.json({ error: "照片不能超过 12MB" }, { status: 400 });
    const extension = file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg";
    const db = await ensureTripSchema();
    const key = `${TRIP_ID}/day-${day}-${Date.now()}.${extension}`;
    await env.PHOTOS.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    await db.prepare("INSERT INTO day_photos (trip_id, day, place, url, source_type, object_key) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(TRIP_ID, day, place, `/api/photos?key=${encodeURIComponent(key)}`, "upload", key).run();
    return Response.json(await readSharedTrip());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "上传失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    const day = Number(url.searchParams.get("day"));
    const db = await ensureTripSchema();
    if (!id && !day) return Response.json({ error: "缺少照片编号" }, { status: 400 });
    const previous = id
      ? await db.prepare("SELECT object_key as objectKey FROM day_photos WHERE trip_id = ? AND id = ?").bind(TRIP_ID, id).first<{ objectKey?: string }>()
      : await db.prepare("SELECT object_key as objectKey FROM day_photos WHERE trip_id = ? AND day = ?").bind(TRIP_ID, day).first<{ objectKey?: string }>();
    if (previous?.objectKey) await env.PHOTOS.delete(previous.objectKey);
    if (id) await db.prepare("DELETE FROM day_photos WHERE trip_id = ? AND id = ?").bind(TRIP_ID, id).run();
    else await db.prepare("DELETE FROM day_photos WHERE trip_id = ? AND day = ?").bind(TRIP_ID, day).run();
    return Response.json(await readSharedTrip());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 500 });
  }
}
