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
  assert.doesNotMatch(page, /曼谷|宁曼|CNX/);
});

test("shared persistence routes use D1 and R2", async () => {
  const [tripRoute, photoRoute, sharedTrip, hosting] = await Promise.all([
    readFile(new URL("app/api/trip/route.ts", root), "utf8"),
    readFile(new URL("app/api/photos/route.ts", root), "utf8"),
    readFile(new URL("db/shared-trip.ts", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
  ]);

  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "PHOTOS"/);
  assert.match(tripRoute, /add_expense/);
  assert.match(tripRoute, /replace_all_plan/);
  assert.match(tripRoute, /archive_trip/);
  assert.match(photoRoute, /env\.PHOTOS\.put/);
  assert.match(photoRoute, /DELETE/);
  assert.match(sharedTrip, /trip_archives/);
  assert.match(sharedTrip, /day_photos/);
});
