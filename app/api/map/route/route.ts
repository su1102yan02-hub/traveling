import { NextRequest } from "next/server";

type RouteItem = { id: number; time?: string; title?: string; place: string };
type Coordinate = [number, number];

function parseLocation(value: string): Coordinate | null {
  const [longitude, latitude] = value.split(",").map(Number);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
}

async function geocode(key: string, place: string) {
  const params = new URLSearchParams({ key, address: place, output: "json" });
  const response = await fetch(`https://restapi.amap.com/v3/geocode/geo?${params}`, { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json() as { status?: string; geocodes?: Array<{ location?: string; formatted_address?: string }> };
  const location = data.status === "1" && data.geocodes?.[0]?.location ? parseLocation(data.geocodes[0].location) : null;
  return location ? { location, address: data.geocodes?.[0]?.formatted_address || place } : null;
}

async function searchPoi(key: string, keywords: string) {
  const params = new URLSearchParams({ key, keywords, offset: "1", page: "1", extensions: "base", output: "json" });
  const response = await fetch(`https://restapi.amap.com/v3/place/text?${params}`, { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json() as { status?: string; pois?: Array<{ location?: string; name?: string; pname?: string; cityname?: string; adname?: string; address?: string | string[] }> };
  const poi = data.status === "1" ? data.pois?.[0] : null;
  const location = poi?.location ? parseLocation(poi.location) : null;
  const address = Array.isArray(poi?.address) ? poi.address.join("") : poi?.address || "";
  return location ? { location, address: `${poi?.pname || ""}${poi?.cityname || ""}${poi?.adname || ""}${address || poi?.name || keywords}` } : null;
}

async function resolvePlace(key: string, destination: string, place: string) {
  const looksLikePoi = /博物馆|公园|寺|庙|墓|窟|关|桥|峡谷|丹霞|草原|机场|车站|收费站|遗址|纪念馆|景区|广场|营地|酒店|民宿/.test(place);
  const direct = looksLikePoi ? await searchPoi(key, place) : await geocode(key, place);
  if (direct) return direct;
  const alternate = looksLikePoi ? await geocode(key, place) : await searchPoi(key, place);
  if (alternate) return alternate;
  if (destination && destination !== "待定目的地" && !place.includes(destination)) return searchPoi(key, `${destination} ${place}`);
  return null;
}

export async function POST(request: NextRequest) {
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) return Response.json({ error: "地图服务尚未配置", code: "AMAP_NOT_CONFIGURED" }, { status: 503 });

  try {
    const payload = await request.json() as { destination?: string; items?: RouteItem[] };
    const destination = String(payload.destination || "").trim();
    const items = (Array.isArray(payload.items) ? payload.items : [])
      .filter((item) => item && String(item.place || "").trim() && item.place !== "待确认地点")
      .slice(0, 16);
    if (!items.length) return Response.json({ stops: [], path: [], unresolved: [] });

    const resolved = await Promise.all(items.map(async (item) => ({ item, result: await resolvePlace(key, destination, String(item.place).trim()) })));
    const stops = resolved.flatMap(({ item, result }) => result ? [{ id: Number(item.id), time: String(item.time || ""), title: String(item.title || "行程地点"), place: String(item.place), address: result.address, location: result.location }] : []);
    const unresolved = resolved.filter(({ result }) => !result).map(({ item }) => String(item.place));
    const path = stops.map((stop) => stop.location);
    return Response.json({ stops, path, unresolved });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "路线生成失败" }, { status: 500 });
  }
}
