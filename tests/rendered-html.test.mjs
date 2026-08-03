import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("product metadata and main experience are configured", async () => {
  const [layout, page] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);

  assert.match(layout, /在途 · 旅行开销与日程/);
  assert.match(layout, /旅行途中随手记账、实时预算和日程回看/);
  assert.match(page, /旅行风景轮播/);
  assert.match(page, /旅途随拍/);
  assert.match(page, /stamp-wall/);
  assert.match(page, /preparePhotoForUpload/);
  assert.match(page, /createTripPoster/);
  assert.match(page, /保存 PNG 图片/);
  assert.match(page, /update_expense/);
  assert.match(page, /delete_expense/);
  assert.match(page, /update_plan/);
  assert.match(page, /delete_plan/);
  assert.match(page, /PlanEditModal/);
  assert.match(page, /record-day-indicator/);
  assert.match(page, /initializedDateRange/);
  assert.match(page, /if \(!dragState\.current\.moved\) dayScroll\.current\.setPointerCapture/);
  assert.match(page, /同步当前记录/);
  assert.match(page, /编辑信息/);
  assert.match(page, /删除旅程/);
  assert.match(page, /RouteMap/);
  assert.match(page, /occurredAt/);
  assert.match(page, /traveling-member/);
  assert.match(page, /upsert_member/);
  assert.doesNotMatch(page, /曼谷|宁曼|CNX/);
});

test("shared persistence routes use Neon and Vercel Blob", async () => {
  const [tripRoute, photoRoute, mapRoute, sharedTrip, environment] = await Promise.all([
    readFile(new URL("app/api/trip/route.ts", root), "utf8"),
    readFile(new URL("app/api/photos/route.ts", root), "utf8"),
    readFile(new URL("app/api/map/route/route.ts", root), "utf8"),
    readFile(new URL("db/shared-trip.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);

  assert.match(environment, /DATABASE_URL/);
  assert.match(environment, /BLOB_READ_WRITE_TOKEN/);
  assert.match(environment, /NEXT_PUBLIC_AMAP_JS_KEY/);
  assert.match(environment, /AMAP_WEB_SERVICE_KEY/);
  assert.match(tripRoute, /add_expense/);
  assert.match(tripRoute, /replace_all_plan/);
  assert.match(tripRoute, /update_plan/);
  assert.match(tripRoute, /delete_plan/);
  assert.match(tripRoute, /archive_trip/);
  assert.match(tripRoute, /update_archive/);
  assert.match(tripRoute, /refresh_archive/);
  assert.match(tripRoute, /delete_archive/);
  assert.match(tripRoute, /upsert_member/);
  assert.match(tripRoute, /occurred_at/);
  assert.match(photoRoute, /@vercel\/blob/);
  assert.match(photoRoute, /put\(/);
  assert.match(photoRoute, /del\(/);
  assert.match(mapRoute, /restapi\.amap\.com\/v3\/geocode\/geo/);
  assert.doesNotMatch(mapRoute, /direction\/|driving|walking/);
  const routeMap = await readFile(new URL("app/components/RouteMap.tsx", root), "utf8");
  assert.match(routeMap, /当天地点地图/);
  assert.match(routeMap, /webapi\.amap\.com/);
  assert.match(routeMap, /正在定位当天地点/);
  assert.doesNotMatch(routeMap, /route-mode|setMode|mode ===/);
  assert.match(sharedTrip, /@neondatabase\/serverless/);
  assert.match(sharedTrip, /trip_archives/);
  assert.match(sharedTrip, /day_photos/);
  assert.match(sharedTrip, /trip_members_trip_device_idx/);
  assert.match(sharedTrip, /to_timestamp\(id \/ 1000\.0\)/);
  assert.doesNotMatch(`${tripRoute}${photoRoute}${sharedTrip}`, /cloudflare:workers|env\.PHOTOS|D1 database/);
});
