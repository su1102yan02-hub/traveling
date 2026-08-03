"use client";

import { MapPin, MapTrifold, Pause, Play, SpinnerGap } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PlanLocation = { id: number; time: string; title: string; place: string };
type Coordinate = [number, number];
type RouteStop = PlanLocation & { address: string; location: Coordinate };
type RouteData = { stops: RouteStop[]; path: Coordinate[]; unresolved: string[] };
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
const locationCache = new Map<string, RouteData>();

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

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

export default function RouteMap({ day, destination, plan, revision = 0 }: { day: number; destination: string; plan: PlanLocation[]; revision?: number }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const movingMarker = useRef<MarkerInstance | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const jsKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY || "";
  const securityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE || "";
  const routeItems = useMemo(() => plan.filter((item) => item.place && item.place !== "待确认地点"), [plan]);
  const routePayload = useMemo(() => routeItems.length ? JSON.stringify({ destination, items: routeItems }) : "", [destination, routeItems]);
  const routeKey = `${revision}|${routePayload}`;

  useEffect(() => {
    const controller = new AbortController();
    movingMarker.current?.stopMove?.();
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setPlaying(false); setPaused(false); setError("");
      setRoute(null); map.current?.clearMap();
      if (!routePayload || !jsKey || !securityCode) { setRoute(null); setLoading(false); return; }
      const cached = locationCache.get(routeKey);
      if (cached) { setRoute(cached); setLoading(false); return; }
      setLoading(true);
      fetch("/api/map/route", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: routePayload })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "地点定位失败");
          return data as RouteData;
        })
        .then((data) => { if (!data.unresolved.length) locationCache.set(routeKey, data); setRoute(data); })
        .catch((reason) => { if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "地点定位失败"); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    });
    return () => controller.abort();
  }, [jsKey, retryCount, routeKey, routePayload, securityCode]);

  useEffect(() => {
    if (!route || !route.stops.length || !mapElement.current || !jsKey || !securityCode) return;
    let cancelled = false;
    loadAmap(jsKey, securityCode).then((AMap) => {
      if (cancelled || !mapElement.current) return;
      if (!map.current) map.current = new AMap.Map(mapElement.current, { zoom: 12, mapStyle: "amap://styles/whitesmoke", viewMode: "2D" });
      map.current.clearMap();
      if (route.path.length > 1) new AMap.Polyline({ map: map.current, path: route.path, strokeColor: "#2f6b55", strokeWeight: 5, strokeOpacity: 0.82, strokeStyle: "dashed", lineJoin: "round", showDir: true });
      route.stops.forEach((stop, index) => new AMap.Marker({ map: map.current, position: stop.location, title: stop.place, label: { direction: "top", content: `<span class="amap-stop-label">${index + 1}. ${escapeHtml(stop.place)}</span>`, offset: new AMap.Pixel(0, -7) }, content: `<span class="amap-stop-dot">${index + 1}</span>`, offset: new AMap.Pixel(-15, -15) }));
      movingMarker.current = new AMap.Marker({ map: map.current, position: route.stops[0].location, zIndex: 120, content: '<span class="amap-traveler">➜</span>', offset: new AMap.Pixel(-17, -17) });
      map.current.setFitView();
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "地图加载失败"));
    return () => { cancelled = true; movingMarker.current?.stopMove?.(); };
  }, [jsKey, route, securityCode]);

  useEffect(() => () => { map.current?.destroy(); map.current = null; }, []);

  const play = useCallback(() => {
    if (!route || route.path.length < 2 || !movingMarker.current) return;
    if (paused) { movingMarker.current.resumeMove?.(); setPaused(false); setPlaying(true); return; }
    movingMarker.current.stopMove?.(); movingMarker.current.setPosition(route.path[0]);
    movingMarker.current.moveAlong?.(route.path, { duration: 900, autoRotation: true });
    setPlaying(true); setPaused(false);
  }, [paused, route]);

  function pause() { movingMarker.current?.pauseMove?.(); setPaused(true); setPlaying(false); }

  if (!routeItems.length) return <section className="route-map route-map-empty"><div><span><MapTrifold /></span><strong>导入地点后，地图会在这里展开</strong><p>地图会定位当天的真实地点，再按行程顺序直接连接，不进行道路规划。</p></div></section>;
  if (!jsKey || !securityCode) return <section className="route-map route-map-setup"><div><span><MapPin /></span><strong>路线地图已经准备好</strong><p>还差高德地图 Key。配置后即可显示真实地图和地点。</p><small>NEXT_PUBLIC_AMAP_JS_KEY · NEXT_PUBLIC_AMAP_SECURITY_CODE · AMAP_WEB_SERVICE_KEY</small></div></section>;

  return <section className="route-map" aria-label={`第 ${day} 天地点地图`}>
    <header><div><span>DAY {String(day).padStart(2, "0")} · MAP</span><h2>当天地点地图</h2><p>{route?.stops.length || routeItems.length} 个地点 · 真实地图定位，按顺序直线连接</p></div><div className="route-map-controls">{playing ? <button className="route-play" onClick={pause}><Pause weight="fill" />暂停</button> : <button className="route-play" disabled={(route?.path.length || 0) < 2 || loading} onClick={play}><Play weight="fill" />{paused ? "继续" : "播放行程"}</button>}</div></header>
    <div className="route-map-canvas" ref={mapElement}>{loading && <div className="route-map-loading"><SpinnerGap />正在定位当天地点</div>}{error && <div className="route-map-error"><MapTrifold /><strong>{error}</strong><span>可在行程编辑中把“地图地点”改得更具体。</span><button onClick={() => setRetryCount((current) => current + 1)}>重新定位</button></div>}</div>
    {route && <footer><div className="route-stops">{route.stops.map((stop, index) => <span key={stop.id}><i>{index + 1}</i><b>{stop.time}</b>{stop.place}</span>)}</div><small>虚线只表达游览顺序，不代表实际道路、距离或驾车时间。</small>{route.unresolved.length > 0 && <div className="route-unresolved"><small>未定位：{route.unresolved.join("、")}。请修改对应行程的“地图地点”。</small><button onClick={() => setRetryCount((current) => current + 1)}>重新定位</button></div>}</footer>}
  </section>;
}
