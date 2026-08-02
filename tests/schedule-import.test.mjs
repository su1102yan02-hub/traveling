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

test("recognizes semicolon-separated Chinese road-trip notes and extracts map places", () => {
  const text = `第一天入住兰州；
第二天黄河第一楼、雕塑、中山桥、白塔山公园；
第三天甘肃省博物馆参观2小时，2.5小时到乌鞘岭玩2小时，1.5小时到天梯石窟玩1.5小时，1小时到武威博物馆附近住；
第四天武威博物馆参观.雷台汉墓.鸠摩罗什寺、文庙、西夏博物馆（视情况）住武威；
第五天武威3小时20分到张掖马蹄寺玩2小时左右，1小时50分到七彩丹霞玩2.5小时左右，1小时到张掖博物馆附近住；
第六天早上1小时到平山湖大峡谷玩2-3小时，1小时到张掖博物馆参观1.5小时，西夏大佛寺1小时住张掖或酒泉；
第七天早上张掖3小时到酒泉市博物馆参观1小时，20分钟到丝绸之路博物馆参观1小时左右，30分钟到嘉峪关城玩1小时，20分钟到悬壁长城玩1.5小时，20分钟到长城第一墩玩1小时，3小时往瓜州住；
第八天红西路军革命纪念馆1小时、锁阳城遗址、大地之子、汉武雄风、无界玩2-3小时，50分钟到榆林窟玩2-3小时，2小时10分到敦煌博物馆附近住；
第九天1小时20分钟到阳关玉门关遗址玩1.5小时，1小时到雅丹魔鬼城玩2小时左右，回敦煌市2小时50分；
第十天敦煌博物馆参观1.5小时，月牙泉，又见敦煌，住敦煌；
第十一天莫高窟参观3-4小时,往元山子附近住？
第十二天敦煌5小时到元山子收费站出口往G213，1小时20分祁连9号公路起始点，走G213二尕公路4小时往祁连山大草原附近3-5公里民宿住；
第十三天从民宿往中川机场5小时20分钟。`;
  const items = parseScheduleText(text);
  assert.deepEqual([...new Set(items.map((item) => item.day))], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.ok(items.length >= 35);
  for (const place of ["兰州", "黄河母亲雕塑", "乌鞘岭", "天梯石窟", "七彩丹霞", "嘉峪关城", "莫高窟", "中川机场"]) {
    assert.ok(items.some((item) => item.place === place), `missing extracted place: ${place}`);
  }
  assert.ok(items.every((item) => !/(?:参观|玩)\d/.test(item.place)), "map places should not contain activity durations");
});
