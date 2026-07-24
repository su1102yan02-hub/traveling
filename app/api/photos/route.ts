import { del, put } from "@vercel/blob";
import { ensureTripSchema, readSharedTrip, TRIP_ID } from "../../../db/shared-trip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PhotoRow = { objectKey?: string | null };

export async function POST(request: Request) {
  let uploadedUrl: string | null = null;
  try {
    const form = await request.formData();
    const file = form.get("photo");
    const day = Number(form.get("day"));
    const place = String(form.get("place") || "行程地点");
    if (!(file instanceof File) || !file.type.startsWith("image/")) return Response.json({ error: "请选择照片" }, { status: 400 });
    if (file.size > 4 * 1024 * 1024) return Response.json({ error: "照片处理后仍然过大，请换一张照片" }, { status: 400 });

    const extension = file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg";
    const pathname = `${TRIP_ID}/day-${day}-${Date.now()}.${extension}`;
    const blob = await put(pathname, file, { access: "public", addRandomSuffix: false, contentType: file.type });
    uploadedUrl = blob.url;

    const sql = await ensureTripSchema();
    await sql.query("INSERT INTO day_photos (trip_id, day, place, url, source_type, object_key) VALUES ($1, $2, $3, $4, $5, $6)", [TRIP_ID, day, place, blob.url, "upload", blob.url]);
    return Response.json(await readSharedTrip());
  } catch (error) {
    if (uploadedUrl) await del(uploadedUrl).catch(() => undefined);
    return Response.json({ error: error instanceof Error ? error.message : "上传失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    const day = Number(url.searchParams.get("day"));
    if (!id && !day) return Response.json({ error: "缺少照片编号" }, { status: 400 });

    const sql = await ensureTripSchema();
    const rows = await sql.query(
      id
        ? "SELECT object_key AS \"objectKey\" FROM day_photos WHERE trip_id = $1 AND id = $2"
        : "SELECT object_key AS \"objectKey\" FROM day_photos WHERE trip_id = $1 AND day = $2 ORDER BY id DESC LIMIT 1",
      [TRIP_ID, id || day],
    ) as PhotoRow[];
    if (rows[0]?.objectKey) await del(rows[0].objectKey);
    if (id) await sql.query("DELETE FROM day_photos WHERE trip_id = $1 AND id = $2", [TRIP_ID, id]);
    else await sql.query("DELETE FROM day_photos WHERE trip_id = $1 AND day = $2", [TRIP_ID, day]);
    return Response.json(await readSharedTrip());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 500 });
  }
}
