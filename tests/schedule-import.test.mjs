import assert from "node:assert/strict";
import test from "node:test";
import { parseScheduleText, scheduleImportSummary } from "../lib/schedule-import.mjs";

test("recognizes Chinese, English, markdown and date day headings", () => {
  const text = `## 第一天｜8月2日
09:00 故宫参观｜故宫博物院
14:00 景山看全景｜景山公园

### 第二天（8月3日）
- 10:00 逛胡同｜南锣鼓巷

Day 3: 08:30 看升旗｜天安门广场`;
  const items = parseScheduleText(text);
  assert.deepEqual(items.map((item) => item.day), [1, 1, 2, 3]);
  assert.equal(items[2].place, "南锣鼓巷");
  assert.deepEqual(scheduleImportSummary(items), [{ day: 1, count: 2 }, { day: 2, count: 1 }, { day: 3, count: 1 }]);
});

test("recognizes date-only sections as sequential days", () => {
  const items = parseScheduleText(`8月2日（周日）\n09:00 故宫｜故宫博物院\n8月3日 周一\n10:00 长城｜八达岭长城`);
  assert.deepEqual(items.map((item) => item.day), [1, 2]);
});

test("recognizes CSV rows by explicit day", () => {
  const items = parseScheduleText("day,time,title,place\n1,09:00,故宫,故宫博物院\n2,10:30,长城,八达岭长城");
  assert.deepEqual(items.map((item) => item.day), [1, 2]);
  assert.equal(items[1].time, "10:30");
});

test("recognizes ICS events by event dates", () => {
  const items = parseScheduleText(`BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20260802T090000
SUMMARY:故宫
LOCATION:故宫博物院
END:VEVENT
BEGIN:VEVENT
DTSTART:20260803T103000
SUMMARY:长城
LOCATION:八达岭长城
END:VEVENT
END:VCALENDAR`);
  assert.deepEqual(items.map((item) => item.day), [1, 2]);
  assert.equal(items[1].place, "八达岭长城");
});
