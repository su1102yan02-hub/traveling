const chineseDigits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function dayNumber(value) {
  const token = String(value || "").trim();
  if (/^\d{1,3}$/.test(token)) return Number(token);
  if (token === "十") return 10;
  if (token.includes("十")) {
    const [tens, units] = token.split("十");
    return (tens ? chineseDigits[tens] || 0 : 1) * 10 + (units ? chineseDigits[units] || 0 : 0);
  }
  return chineseDigits[token] || 0;
}

function cleanLine(line) {
  return line.trim().replace(/^#{1,6}\s*/, "").replace(/^(?:[-*•·]|\d+[.)、])\s+/, "").trim();
}

function cleanHeadingRest(value) {
  return String(value || "").trim().replace(/^[\s：:｜|—–-]+/, "").replace(/^[(（][^）)]*[）)]\s*/, "").trim();
}

function normalizeTime(hour, minute, period = "") {
  let numericHour = Number(hour);
  if (/下午|晚上|中午/.test(period) && numericHour < 12) numericHour += 12;
  if (/凌晨/.test(period) && numericHour === 12) numericHour = 0;
  return `${String(Math.min(numericHour, 23)).padStart(2, "0")}:${minute}`;
}

function extractPlace(value) {
  let place = String(value || "").trim().replace(/[？?。]+$/, "");
  place = place.replace(/^(?:早上|上午|下午|晚上|中午|清晨|凌晨)\s*/, "");
  if (place.includes("到")) place = place.slice(place.lastIndexOf("到") + 1);
  else place = place.replace(/^(?:入住|回|往|住|走)\s*/, "");
  place = place.replace(/^(?:\d+(?:\.\d+)?\s*(?:小时|分钟)(?:\d+\s*分钟)?\s*)+/, "");
  if (place.includes("往")) {
    const parts = place.split("往");
    const target = parts.at(-1)?.trim() || "";
    place = /^G\d+$/i.test(target) ? parts.slice(0, -1).join("往") : target;
  }
  place = place
    .replace(/(?:参观|游览|游玩|玩|停留)\s*(?:\d+(?:\.\d+)?(?:\s*[-—至]\s*\d+(?:\.\d+)?)?\s*(?:小时|分钟)){1,2}(?:左右)?$/i, "")
    .replace(/附近(?:\d+(?:\.\d+)?\s*[-—至]?\s*\d*(?:\.\d+)?\s*公里)?(?:民宿)?住.*$/, "")
    .replace(/(?:住|住宿)(?:附近)?$/, "")
    .replace(/\s*(?:\d+(?:\.\d+)?(?:\s*[-—至]\s*\d+(?:\.\d+)?)?\s*(?:小时|分钟)){1,2}(?:左右)?$/, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/(?:参观|游览|游玩|玩|停留)$/, "")
    .trim();
  if (place.includes("或")) place = place.split("或")[0].trim();
  if (place === "雕塑") return "黄河母亲雕塑";
  return place || String(value || "").trim();
}

function naturalSegments(line) {
  if (/[｜|@→\t]/.test(line) || /(?:上午|下午|晚上|中午|早上|清晨|凌晨)?\s*\d{1,2}[:：]\d{2}/.test(line)) return [line];
  return line
    .replace(/(?<!\d)\.(?!\d)/g, "，")
    .split(/[，,、。]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const lodging = /^(?:入住|住宿|住)/.test(part) ? null : part.match(/^(.+?)(?:[（(][^）)]*[）)])?住([^？?]+)$/);
      return lodging ? [lodging[1], `住${lodging[2]}`] : [part];
    });
}

function parseItem(line, day, count) {
  let content = cleanLine(line).replace(/^[(（]\s*/, "").replace(/\s*[）)]$/, "");
  const timeMatch = content.match(/^(上午|下午|晚上|中午|早上|清晨|凌晨)?\s*[[(]?\s*(\d{1,2})[:：](\d{2})\s*[\])]?\s*(?:[-—–~至到]\s*\d{1,2}[:：]\d{2})?\s*/);
  const time = timeMatch ? normalizeTime(timeMatch[2], timeMatch[3], timeMatch[1]) : `${String(Math.min(10 + count, 23)).padStart(2, "0")}:00`;
  if (timeMatch) content = content.slice(timeMatch[0].length).trim();
  content = content.replace(/^[：:—–-]+\s*/, "").trim();
  if (!content) return null;
  const parts = content.split(/\s*(?:[｜|@]|→|\t)\s*/).map((part) => part.trim()).filter(Boolean);
  const title = parts[0] || "新日程";
  const place = parts.slice(1).join(" · ") || extractPlace(title);
  return { time, title, place, day };
}

function parseLineItems(line, day, startingCount) {
  return naturalSegments(line).flatMap((segment, index) => {
    const item = parseItem(segment, day, startingCount + index);
    return item ? [item] : [];
  });
}

function parseDatePrefix(line) {
  const match = line.match(/^((?:\d{4}\s*(?:年|[./-])\s*)?\d{1,2}\s*(?:月|[./-])\s*\d{1,2}\s*(?:日)?)(.*)$/);
  if (!match) return null;
  const numbers = match[1].match(/\d+/g) || [];
  const key = numbers.length >= 3 ? `${numbers[0]}-${numbers[1]}-${numbers[2]}` : `${numbers[0]}-${numbers[1]}`;
  return { key, rest: cleanHeadingRest(match[2]) };
}

function unfoldIcs(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function parseIcs(text, initialDay) {
  if (!/BEGIN:VEVENT/i.test(text)) return null;
  const events = [...unfoldIcs(text).matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/gi)].map((match) => {
    const fields = {};
    for (const line of match[1].split("\n")) {
      const field = line.match(/^([A-Z-]+)(?:;[^:]*)?:(.*)$/i);
      if (field) fields[field[1].toUpperCase()] = field[2].replace(/\\n/g, " ").replace(/\\,/g, ",");
    }
    const dateTime = String(fields.DTSTART || "");
    const date = dateTime.match(/\d{8}/)?.[0] || "undated";
    const clock = dateTime.match(/T(\d{2})(\d{2})/) || [];
    return { date, time: clock[1] ? `${clock[1]}:${clock[2]}` : "10:00", title: fields.SUMMARY || "新日程", place: fields.LOCATION || fields.SUMMARY || "待确认地点" };
  }).filter((item) => item.title || item.place).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const dates = [...new Set(events.map((item) => item.date))];
  return events.map((item) => ({ time: item.time, title: item.title, place: item.place, day: initialDay + Math.max(0, dates.indexOf(item.date)) }));
}

function csvRow(line) {
  const result = []; let value = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { result.push(value.trim()); value = ""; }
    else value += character;
  }
  result.push(value.trim());
  return result;
}

function parseCsv(text, initialDay) {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((line) => line.trim());
  if (lines.length < 2 || !lines[0].includes(",")) return null;
  const headers = csvRow(lines[0]).map((header) => header.toLowerCase());
  const find = (...names) => headers.findIndex((header) => names.some((name) => header === name || header.includes(name)));
  const indexes = { day: find("day", "天"), date: find("date", "日期"), time: find("time", "时间"), title: find("title", "行程", "日程", "活动"), place: find("place", "location", "地点", "地址") };
  if (indexes.title < 0 && indexes.place < 0) return null;
  const dateDays = new Map();
  return lines.slice(1).flatMap((line, rowIndex) => {
    const row = csvRow(line);
    const explicitDay = indexes.day >= 0 ? dayNumber(row[indexes.day]) : 0;
    const date = indexes.date >= 0 ? row[indexes.date] : "";
    if (date && !dateDays.has(date)) dateDays.set(date, initialDay + dateDays.size);
    const day = explicitDay || dateDays.get(date) || initialDay;
    const title = row[indexes.title] || row[indexes.place] || "新日程";
    const place = row[indexes.place] || title;
    if (!title && !place) return [];
    const timeRaw = indexes.time >= 0 ? row[indexes.time] : "";
    const matchedTime = timeRaw.match(/(\d{1,2})[:：](\d{2})/);
    return [{ time: matchedTime ? normalizeTime(matchedTime[1], matchedTime[2]) : `${String(Math.min(10 + rowIndex, 23)).padStart(2, "0")}:00`, title, place, day }];
  });
}

export function parseScheduleText(text, initialDay = 1) {
  const source = String(text || "").trim();
  if (!source) return [];
  const ics = parseIcs(source, initialDay);
  if (ics) return ics;
  const csv = parseCsv(source, initialDay);
  if (csv) return csv;

  const lines = source
    .replace(/\r\n/g, "\n")
    .replace(/[；;]\s*(?=(?:第\s*)?[零〇一二三四五六七八九十两百\d]{1,4}\s*天|(?:day|d)\s*\d)/gi, "\n")
    .split("\n").map(cleanLine).filter(Boolean);
  let currentDay = initialDay;
  const counts = new Map();
  const dateDays = new Map();
  const items = [];
  for (const line of lines) {
    const heading = line.match(/^(?:第\s*)?([零〇一二三四五六七八九十两百\d]{1,4})\s*天(.*)$/i) || line.match(/^(?:day|d)\s*0*(\d{1,3})(.*)$/i);
    if (heading) {
      currentDay = Math.max(1, dayNumber(heading[1]));
      const rest = cleanHeadingRest(heading[2]);
      if (!rest || parseDatePrefix(rest)) continue;
      const count = counts.get(currentDay) || 0;
      const parsed = parseLineItems(rest, currentDay, count);
      items.push(...parsed); counts.set(currentDay, count + parsed.length);
      continue;
    }
    const date = parseDatePrefix(line);
    if (date) {
      if (!dateDays.has(date.key)) dateDays.set(date.key, initialDay + dateDays.size);
      currentDay = dateDays.get(date.key);
      if (!/^(?:上午|下午|晚上|中午|早上|清晨|凌晨)?\s*[[(]?\s*\d{1,2}[:：]\d{2}/.test(date.rest)) continue;
      const count = counts.get(currentDay) || 0;
      const item = parseItem(date.rest, currentDay, count);
      if (item) { items.push(item); counts.set(currentDay, count + 1); }
      continue;
    }
    const count = counts.get(currentDay) || 0;
    const parsed = parseLineItems(line, currentDay, count);
    items.push(...parsed); counts.set(currentDay, count + parsed.length);
  }
  return items;
}

export function scheduleImportSummary(items) {
  const days = [...new Set(items.map((item) => item.day))].sort((a, b) => a - b);
  return days.map((day) => ({ day, count: items.filter((item) => item.day === day).length }));
}
