import { NextRequest } from "next/server";

type RouteItem = { id: number; time?: string; title?: string; place: string };
type Coordinate = [number, number];

function parseLocation(value: string): Coordinate | null {
  const [longitude, latitude] = value.split(",").map(Number);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
}

function addPoint(points: Coordinate[], point: Coordinate) {
  const previous = points[points.length - 1];
  if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) points.push(point);
}

async function geocode(key: string, destination: string, place: string) {
  const params = new URLSearchParams({ key, address: `${destination} ${place}`.trim(), output: "json" });
  if (destination && destination !== "待定目的地") params.set("city", destination);
  const response = await fetch(`https://restapi.amap.com/v3/geocode/geo?${params}`, { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json() as { status?: string; geocodes?: Array<{ location?: string; formatted_address?: string }> };
  const location = data.status === "1" && data.geocodes?.[0]?.location ? parseLocation(data.geocodes[0].location) : null;
  return location ? { location, address: data.geocodes?.[0]?.formatted_address || place } : null;
}

async function directions(key: string, origin: Coordinate, destination: Coordinate, mode: "walking" | "driving") {
  const params = new URLSearchParams({ key, origin: origin.join(","), destination: destination.join(","), output: "json" });
  const response = await fetch(`https://restapi.amap.com/v3/direction/${mode}?${params}`, { cache: "no-store" });
  if (!response.ok) return [] as Coordinate[];
  const data = await response.json() as { status?: string; route?: { paths?: Array<{ steps?: Array<{ polyline?: string }> }> } };
  if (data.status !== "1") return [] as Coordinate[];
  const points: Coordinate[] = [];
  for (const step of data.route?.paths?.[0]?.steps || []) {
    for (const rawPoint of step.polyline?.split(";") || []) {
      const point = parseLocation(rawPoint);
      if (point) addPoint(points, point);
    }
  }
  return points;
}

export async function POST(request: NextRequest) {
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) return Response.json({ error: "地图服务尚未配置", code: "AMAP_NOT_CONFIGURED" }, { status: 503 });

  try {
    const payload = await request.json() as { destination?: string; mode?: string; items?: RouteItem[] };
    const destination = String(payload.destination || "").trim();
    const mode = payload.mode === "driving" ? "driving" : "walking";
    const items = (Array.isArray(payload.items) ? payload.items : [])
      .filter((item) => item && String(item.place || "").trim() && item.place !== "待确认地点")
      .slice(0, 16);
    if (!items.length) return Response.json({ stops: [], path: [], unresolved: [], mode });

    const resolved = await Promise.all(items.map(async (item) => ({ item, result: await geocode(key, destination, String(item.place).trim()) })));
    const stops = resolved.flatMap(({ item, result }) => result ? [{ id: Number(item.id), time: String(item.time || ""), title: String(item.title || "行程地点"), place: String(item.place), address: result.address, location: result.location }] : []);
    const unresolved = resolved.filter(({ result }) => !result).map(({ item }) => String(item.place));
    const path: Coordinate[] = [];
    if (stops[0]) addPoint(path, stops[0].location);
    for (let index = 0; index < stops.length - 1; index += 1) {
      const segment = await directions(key, stops[index].location, stops[index + 1].location, mode);
      if (segment.length) segment.forEach((point) => addPoint(path, point));
      else addPoint(path, stops[index + 1].location);
    }
    return Response.json({ stops, path, unresolved, mode });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "路线生成失败" }, { status: 500 });
  }
}
