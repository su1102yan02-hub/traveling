"use client";

import { MapTrifold, Pause, Play } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

type PlanLocation = { id: number; time: string; title: string; place: string };
type RoutePoint = { x: number; y: number; item: PlanLocation };

function placeSeed(value: string) {
  return [...value].reduce((sum, character) => sum + character.charCodeAt(0), 0);
}

function simulatedPoints(items: PlanLocation[]): RoutePoint[] {
  return items.map((item, index) => {
    if (items.length === 1) return { x: 50, y: 50, item };
    const x = 10 + (index / (items.length - 1)) * 80;
    const lane = index % 2 === 0 ? 32 : 68;
    const jitter = (placeSeed(item.place) % 15) - 7;
    return { x, y: Math.max(18, Math.min(82, lane + jitter)), item };
  });
}

function pathFrom(points: RoutePoint[]) {
  return points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
}

export default function RouteMap({ day, destination, plan }: { day: number; destination: string; plan: PlanLocation[] }) {
  const svg = useRef<SVGSVGElement>(null);
  const motion = useRef<SVGAnimateMotionElement>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const routeItems = useMemo(() => plan.filter((item) => item.place && item.place !== "待确认地点"), [plan]);
  const points = useMemo(() => simulatedPoints(routeItems), [routeItems]);
  const path = useMemo(() => pathFrom(points), [points]);
  const routeKey = points.map((point) => `${point.item.id}-${point.x}-${point.y}`).join("|");

  useEffect(() => {
    svg.current?.unpauseAnimations();
    setPlaying(false);
    setPaused(false);
  }, [day, routeKey]);

  function play() {
    if (points.length < 2) return;
    if (paused) {
      svg.current?.unpauseAnimations();
      setPaused(false);
      setPlaying(true);
      return;
    }
    motion.current?.beginElement();
    setPlaying(true);
  }

  function pause() {
    svg.current?.pauseAnimations();
    setPaused(true);
    setPlaying(false);
  }

  if (!routeItems.length) return <section className="route-map route-map-empty"><div><span><MapTrifold /></span><strong>导入地点后，路线会在这里展开</strong><p>无需等待智能规划，系统会按当天行程顺序立即生成一条旅行路线演示。</p></div></section>;

  return <section className="route-map route-map-simulated" aria-label={`第 ${day} 天路线演示`}>
    <header><div><span>DAY {String(day).padStart(2, "0")} · ROUTE STORY</span><h2>当天路线演示</h2><p>{routeItems.length} 个地点 · 按行程顺序模拟，不进行智能路线规划</p></div><div className="route-map-controls">{playing ? <button className="route-play" onClick={pause}><Pause weight="fill" />暂停</button> : <button className="route-play" disabled={points.length < 2} onClick={play}><Play weight="fill" />{paused ? "继续演示" : "播放演示"}</button>}</div></header>
    <div className="route-map-canvas route-sim-canvas">
      <div className="route-sim-destination"><span>TRAVEL SKETCH</span><strong>{destination && destination !== "待定目的地" ? destination : "这一天的沿途风景"}</strong></div>
      <svg ref={svg} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`依次经过 ${routeItems.map((item) => item.place).join("、")}`}>
        <defs><pattern id="route-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(47,107,85,.08)" strokeWidth=".22" /></pattern><filter id="route-shadow"><feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#173f31" floodOpacity=".2" /></filter></defs>
        <rect width="100" height="100" fill="url(#route-grid)" />
        {path && <><path d={path} className="route-sim-path-shadow" /><path d={path} className="route-sim-path" /></>}
        {points.map((point, index) => <g key={point.item.id} className="route-sim-stop" transform={`translate(${point.x} ${point.y})`}><circle r="3.7" /><text x="0" y="1.25" textAnchor="middle">{index + 1}</text></g>)}
        {points.length > 1 && <g className="route-sim-traveler" filter="url(#route-shadow)"><circle r="3.3" /><path d="M-1.4 0 L1.4 0 M.2 -1.2 L1.6 0 .2 1.2" /><animateMotion ref={motion} key={routeKey} begin="indefinite" dur={`${Math.max(6, points.length * 1.4)}s`} repeatCount="indefinite" path={path} /></g>}
      </svg>
      <div className="route-sim-labels">{points.map((point, index) => <span key={point.item.id} style={{ left: `${point.x}%`, top: `${point.y}%` }} className={point.y > 50 ? "label-above" : "label-below"}><i>{index + 1}</i><b>{point.item.place}</b></span>)}</div>
    </div>
    <footer><div className="route-stops">{routeItems.map((item, index) => <span key={item.id}><i>{index + 1}</i><b>{item.time}</b>{item.place}</span>)}</div><small>这是一条视觉化演示路线，只表达游览顺序，不代表真实道路、里程或预计用时。</small></footer>
  </section>;
}
