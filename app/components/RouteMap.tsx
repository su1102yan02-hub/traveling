"use client";

import { MapPin, MapTrifold, Pause, Play, SpinnerGap } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PlanLocation = { id: number; time: string; title: string; place: string };
type Coordinate = [number, number];
type RouteStop = PlanLocation & { address: string; location: Coordinate };
type RouteData = { stops: RouteStop[]; path: Coordinate[]; unresolved: string[]; mode: "walking" | "driving" };
type MapInstance = { clearMap: () => void; destroy: () => void; setFitView: () => void };
type MarkerInstance = { moveAlong?: (path: Coordinate[], options: { duration: number; autoRotation: boolean }) => void; pauseMove?: () => void; resumeMove?: () => void; stopMove?: () => void; setPosition: (position: Coordinate) => void };
type AMapApi = {
  Map: new (container: HTMLDivElement, options: Record<string, unknown>) => MapInstance;
  Marker: new (options: Record<string, unknown>) => MarkerInstance;
  Polyline: new (options: Record<string, unknown>) => unknown;
  Pixel: new (x: number, y: number) => unknown;
};

declare global {
  interface Window {
    AMap?: AMapApi;
    _AMapSecurityConfig?: { securityJsCode?: string };
  }
}

let amapPromise: Promise<AMapApi> | null = null;

function loadAmap(key: string, securityCode: string) {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (amapPromise) return amapPromise;
  amapPromise = new Promise<AMapApi>((resolve, reject) => {
    window._AMapSecurityConfig = { securityJsCode: securityCode };
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.MoveAnimation`;
    script.async = true;
    script.onload = () => window.AMap ? resolve(window.AMap) : reject(new Error("高德地图加载失败"));
    script.onerror = () => reject(new Error("地图网络连接失败"));
    document.head.appendChild(script);
  });
  return amapPromise;
}

function compactPath(path: Coordinate[], limit = 90) {
  if (path.length <= limit) return path;
  const result = Array.from({ length: limit }, (_, index) => path[Math.round(index * (path.length - 1) / (limit - 1))]);
  return result;
}

export default function RouteMap({ day, destination, plan }: { day: number; destination: string; plan: PlanLocation[] }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const movingMarker = useRef<MarkerInstance | null>(null);
  const [mode, setMode] = useState<"walking" | "driving">("walking");
  const [route, setRoute] = useState<RouteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const jsKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY || "";
  const securityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE || "";
  const routeItems = useMemo(() => plan.filter((item) => item.place && item.place !== "待确认地点"), [plan]);

  useEffect(() => {
    const controller = new AbortController();
    movingMarker.current?.stopMove?.();
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setPlaying(false); setPaused(false);
      if (!routeItems.length || !jsKey || !securityCode) { setRoute(null); setLoading(false); return; }
      setLoading(true); setError("");
      fetch("/api/map/route", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ destination, mode, items: routeItems }) })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "路线生成失败");
          return data as RouteData;
        })
        .then(setRoute)
        .catch((reason) => { if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "路线生成失败"); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    });
    return () => controller.abort();
  }, [day, destination, jsKey, mode, routeItems, securityCode]);

  useEffect(() => {
    if (!route || !route.stops.length || !mapElement.current || !jsKey || !securityCode) return;
    let cancelled = false;
    loadAmap(jsKey, securityCode).then((AMap) => {
      if (cancelled || !mapElement.current) return;
      if (!map.current) map.current = new AMap.Map(mapElement.current, { zoom: 12, mapStyle: "amap://styles/whitesmoke", viewMode: "2D" });
      map.current.clearMap();
      if (route.path.length > 1) new AMap.Polyline({ map: map.current, path: route.path, strokeColor: "#2f6b55", strokeWeight: 6, strokeOpacity: 0.9, lineJoin: "round", showDir: true });
      route.stops.forEach((stop, index) => new AMap.Marker({ map: map.current, position: stop.location, title: stop.place, label: { direction: "top", content: `<span class="amap-stop-label">${index + 1}. ${stop.place}</span>`, offset: new AMap.Pixel(0, -7) }, content: `<span class="amap-stop-dot">${index + 1}</span>`, offset: new AMap.Pixel(-15, -15) }));
      movingMarker.current = new AMap.Marker({ map: map.current, position: route.stops[0].location, zIndex: 120, content: '<span class="amap-traveler">➜</span>', offset: new AMap.Pixel(-17, -17) });
      map.current.setFitView();
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "地图加载失败"));
    return () => { cancelled = true; movingMarker.current?.stopMove?.(); };
  }, [jsKey, route, securityCode]);

  useEffect(() => () => { map.current?.destroy(); map.current = null; }, []);

  const play = useCallback(() => {
    if (!route || route.path.length < 2 || !movingMarker.current) return;
    if (paused) { movingMarker.current.resumeMove?.(); setPaused(false); setPlaying(true); return; }
    const path = compactPath(route.path);
    movingMarker.current.stopMove?.(); movingMarker.current.setPosition(path[0]);
    movingMarker.current.moveAlong?.(path, { duration: 110, autoRotation: true });
    setPlaying(true); setPaused(false);
  }, [paused, route]);

  function pause() { movingMarker.current?.pauseMove?.(); setPaused(true); setPlaying(false); }

  if (!routeItems.length) return <section className="route-map route-map-empty"><div><span><MapTrifold /></span><strong>导入地点后，路线会在这里展开</strong><p>每行日程请用“行程｜地点”填写，地图会按时间顺序连接当天的每一站。</p></div></section>;
  if (!jsKey || !securityCode) return <section className="route-map route-map-setup"><div><span><MapPin /></span><strong>路线地图已经准备好</strong><p>还差高德地图 Key。配置完成后，导入的地点会自动生成可播放路线。</p><small>NEXT_PUBLIC_AMAP_JS_KEY · NEXT_PUBLIC_AMAP_SECURITY_CODE · AMAP_WEB_SERVICE_KEY</small></div></section>;

  return <section className="route-map" aria-label={`第 ${day} 天动态路线地图`}>
    <header><div><span>DAY {String(day).padStart(2, "0")} · ROUTE</span><h2>当天路线地图</h2><p>{route?.stops.length || routeItems.length} 个地点 · 随日期卡同步切换</p></div><div className="route-map-controls"><div className="route-mode"><button className={mode === "walking" ? "active" : ""} onClick={() => setMode("walking")}>步行</button><button className={mode === "driving" ? "active" : ""} onClick={() => setMode("driving")}>驾车</button></div>{playing ? <button className="route-play" onClick={pause}><Pause weight="fill" />暂停</button> : <button className="route-play" disabled={(route?.path.length || 0) < 2 || loading} onClick={play}><Play weight="fill" />{paused ? "继续" : "播放路线"}</button>}</div></header>
    <div className="route-map-canvas" ref={mapElement}>{loading && <div className="route-map-loading"><SpinnerGap />正在识别地点并规划路线</div>}{error && <div className="route-map-error"><MapTrifold /><strong>{error}</strong><span>检查地点名称或高德地图配置后重试。</span></div>}</div>
    {route && <footer><div className="route-stops">{route.stops.map((stop, index) => <span key={stop.id}><i>{index + 1}</i><b>{stop.time}</b>{stop.place}</span>)}</div>{route.unresolved.length > 0 && <small>未识别：{route.unresolved.join("、")}，可在日程中补充城市或区县。</small>}</footer>}
  </section>;
}
