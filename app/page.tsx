"use client";

import {
  AirplaneTilt, ArrowRight, Bed, CalendarBlank, Camera, CaretDown, CaretLeft, CaretRight, ChartDonut, Check, Clock,
  Coffee, Compass, Copy, DownloadSimple, ForkKnife, LinkSimple, MapPin, MapTrifold, PencilSimple, Plus, Receipt,
  Train, Trash, UploadSimple, UsersThree, Wallet, X,
} from "@phosphor-icons/react";
import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import RouteMap from "./components/RouteMap";
import { parseScheduleText, scheduleImportSummary } from "../lib/schedule-import.mjs";

type Category = "交通" | "住宿" | "餐饮" | "门票" | "其他";
type View = "journey" | "ledger" | "history";
type Expense = { id: number; category: Category; title: string; amount: number; time: string; day: number; createdBy?: string; occurredAt?: string };
type PlanItem = { id: number; time: string; title: string; place: string; day: number; done?: boolean };
type Member = { deviceId: string; name: string; color: string; lastSeen?: string };
type DayPhoto = { id: number; day: number; place: string; url: string; sourceType: string };
type Trip = { id?: string; title: string; destination: string; startDate?: string; endDate?: string };
type TripHistory = { id: number; title: string; destination: string; startDate: string; endDate: string; archivedAt: string; snapshot: { expenses: Expense[]; plan: PlanItem[]; photos: DayPhoto[] } };
type CalendarDay = { day: number; weekday: string; date: string; month: string; label: string; iso: string };

const categoryMeta: Record<Category, { color: string; icon: typeof Train; hint: string }> = {
  交通: { color: "#2f6b55", icon: Train, hint: "机票、打车与公共交通" },
  住宿: { color: "#d66d49", icon: Bed, hint: "酒店、民宿与营地" },
  餐饮: { color: "#d2a33c", icon: ForkKnife, hint: "正餐、咖啡和小吃" },
  门票: { color: "#537ca6", icon: Receipt, hint: "景点、演出与体验" },
  其他: { color: "#8b6b82", icon: Coffee, hint: "购物及临时开销" },
};

const starterExpenses: Expense[] = [];
const starterPlan: PlanItem[] = [];
const starterMembers: Member[] = [];
const heroSlides = [
  { src: "/photos/chiang-mai-street.jpg", eyebrow: "CITY WANDER", title: "走进一座城的日常", place: "街巷、晨光与慢下来的脚步" },
  { src: "/photos/chiang-mai-temple.jpg", eyebrow: "GOLDEN HOUR", title: "把日落留给山顶", place: "寺庙、晚风与远处的天际线" },
  { src: "/photos/chiang-mai-mountains.jpg", eyebrow: "INTO THE WILD", title: "雨后，去看更远的山", place: "山野、云雾与公路尽头" },
  { src: "/photos/island-beach.jpg", eyebrow: "ISLAND TIME", title: "把时间交给海浪", place: "白沙、椰林与一整片清澈的蓝" },
  { src: "/photos/alpine-lake.jpg", eyebrow: "STAY WILD", title: "在湖边醒来的清晨", place: "群山、木屋与风吹过水面的声音" },
  { src: "/photos/coastal-road.jpg", eyebrow: "OPEN ROAD", title: "沿着海岸一直开", place: "弯道、海风与没有写完的目的地" },
];

const money = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);

const memberColors = ["#2f6b55", "#d66d49", "#537ca6", "#8b6b82", "#b98725", "#467f79"];

function createMemberIdentity(): Member {
  const deviceId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const suffix = deviceId.replace(/\D/g, "").slice(-4) || deviceId.replace(/-/g, "").slice(-4).toUpperCase();
  const colorIndex = Array.from(deviceId).reduce((sum, character) => sum + character.charCodeAt(0), 0) % memberColors.length;
  return { deviceId, name: `旅伴 ${suffix}`, color: memberColors[colorIndex] };
}

function formatExpenseMoment(expense: Expense) {
  if (!expense.occurredAt) return expense.time || "时间未记录";
  const date = new Date(expense.occurredAt);
  if (Number.isNaN(date.getTime())) return expense.time || "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replaceAll("/", "-");
}

const PHOTO_UPLOAD_TARGET = 850 * 1024;

async function decodePhoto(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch { /* Fall back to an HTML image for browsers with partial bitmap support. */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("无法读取这张照片，请换用 JPG、PNG 或 WebP 格式"));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("照片压缩失败，请重试")), "image/jpeg", quality));
}

async function preparePhotoForUpload(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("请选择照片文件");
  if (file.size > 40 * 1024 * 1024) throw new Error("原图超过 40MB，请先在相册中缩小后再上传");
  if (file.size <= PHOTO_UPLOAD_TARGET) return file;
  const source = await decodePhoto(file);
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  let scale = Math.min(1, 1920 / Math.max(sourceWidth, sourceHeight));
  let smallest: Blob | null = null;
  try {
    for (let pass = 0; pass < 5; pass += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前浏览器无法处理照片");
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.84, 0.74, 0.64, 0.54]) {
        const blob = await canvasBlob(canvas, quality);
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= PHOTO_UPLOAD_TARGET) return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "travel-photo"}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
      }
      scale *= 0.78;
    }
  } finally {
    if ("close" in source && typeof source.close === "function") source.close();
  }
  if (!smallest) throw new Error("照片压缩失败，请重试");
  return new File([smallest], `${file.name.replace(/\.[^.]+$/, "") || "travel-photo"}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

async function loadPosterImage(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("照片读取失败");
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("照片读取失败"));
      image.src = objectUrl;
    });
  } finally { URL.revokeObjectURL(objectUrl); }
}

function drawImageCover(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  context.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2, sourceWidth, sourceHeight, x, y, width, height);
}

function wrapPosterText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 2) {
  const lines: string[] = [];
  let line = "";
  for (const character of text) {
    const candidate = line + character;
    if (context.measureText(candidate).width > maxWidth && line) { lines.push(line); line = character; }
    else line = candidate;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.join("").length < text.length) lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
  return lines;
}

async function createTripPoster(trip: Trip, days: CalendarDay[], plan: PlanItem[], photos: DayPhoto[]) {
  const contentDays = days.filter((day) => plan.some((item) => item.day === day.day) || photos.some((photo) => photo.day === day.day));
  if (!contentDays.length) throw new Error("先添加行程或随拍，再生成打卡长图");
  const dayLayouts = contentDays.map((day) => {
    const dayPlan = plan.filter((item) => item.day === day.day);
    const dayPhotos = photos.filter((photo) => photo.day === day.day);
    const shownPhotos = dayPhotos.slice(0, 6);
    const height = 120 + dayPlan.length * 52 + (shownPhotos.length ? Math.ceil(shownPhotos.length / 2) * 250 + 28 : 0) + (dayPhotos.length > shownPhotos.length ? 34 : 0);
    return { day, dayPlan, dayPhotos, shownPhotos, height };
  });
  const width = 1080;
  const height = 500 + dayLayouts.reduce((sum, layout) => sum + layout.height + 28, 0) + 130;
  if (height > 28000) throw new Error("这趟旅程内容太多，请减少部分照片后再导出单张长图");
  await document.fonts.ready;
  const photoUrls = [...new Set(dayLayouts.flatMap((layout) => layout.shownPhotos.map((photo) => photo.url)))];
  const loadedEntries = await Promise.all(photoUrls.map(async (url) => [url, await loadPosterImage(url).catch(() => null)] as const));
  const loadedPhotos = new Map(loadedEntries);
  const coverUrl = photos[0]?.url || "/photos/coastal-road.jpg";
  const coverImage = loadedPhotos.get(coverUrl) || await loadPosterImage(coverUrl).catch(() => null);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d"); if (!context) throw new Error("当前浏览器无法生成图片");
  context.fillStyle = "#f2f3ed"; context.fillRect(0, 0, width, height);
  if (coverImage) drawImageCover(context, coverImage, 0, 0, width, 430);
  const coverGradient = context.createLinearGradient(0, 0, 0, 430); coverGradient.addColorStop(0, "rgba(15,45,35,.18)"); coverGradient.addColorStop(1, "rgba(15,45,35,.92)"); context.fillStyle = coverGradient; context.fillRect(0, 0, width, 430);
  context.fillStyle = "#d7ed89"; context.font = "600 22px sans-serif"; context.fillText("TRAVEL CHECK-IN · 在途", 70, 72);
  context.fillStyle = "#ffffff"; context.font = "700 64px sans-serif"; wrapPosterText(context, trip.title || "我的旅程", 820, 2).forEach((line, index) => context.fillText(line, 70, 160 + index * 74));
  context.font = "400 28px sans-serif"; context.fillStyle = "rgba(255,255,255,.86)"; context.fillText(`${trip.destination || "待定目的地"}  ·  ${trip.startDate || ""} — ${trip.endDate || ""}`, 70, 350);
  context.font = "500 22px sans-serif"; context.fillText(`${contentDays.length} 个有记录的日子  ·  ${plan.length} 项行程  ·  ${photos.length} 张随拍`, 70, 392);
  let y = 478;
  for (const layout of dayLayouts) {
    context.fillStyle = "#ffffff"; context.beginPath(); context.roundRect(48, y, 984, layout.height, 24); context.fill();
    context.fillStyle = "#183f32"; context.font = "700 34px sans-serif"; context.fillText(`DAY ${String(layout.day.day).padStart(2, "0")}`, 78, y + 55);
    context.fillStyle = "#78867f"; context.font = "400 20px sans-serif"; context.fillText(`${layout.day.month}${layout.day.date}日 · ${layout.day.weekday}`, 260, y + 53);
    let itemY = y + 92;
    for (const item of layout.dayPlan) {
      context.fillStyle = "#d7ed89"; context.beginPath(); context.arc(87, itemY - 6, 7, 0, Math.PI * 2); context.fill();
      context.fillStyle = "#718078"; context.font = "500 19px monospace"; context.fillText(item.time, 110, itemY);
      context.fillStyle = "#1c332b"; context.font = "600 23px sans-serif"; context.fillText(item.title, 220, itemY);
      context.fillStyle = "#87938d"; context.font = "400 18px sans-serif"; context.textAlign = "right"; context.fillText(item.place, 990, itemY); context.textAlign = "left";
      itemY += 52;
    }
    if (layout.shownPhotos.length) {
      itemY += 6;
      const gap = 18; const photoWidth = 433; const photoHeight = 222;
      layout.shownPhotos.forEach((photo, index) => {
        const column = index % 2; const row = Math.floor(index / 2); const x = 78 + column * (photoWidth + gap); const photoY = itemY + row * 250;
        context.fillStyle = index % 2 ? "#f5efe7" : "#f7f7f1"; context.fillRect(x - 7, photoY - 7, photoWidth + 14, photoHeight + 26);
        const image = loadedPhotos.get(photo.url);
        if (image) drawImageCover(context, image, x, photoY, photoWidth, photoHeight);
        else { context.fillStyle = "#d9dfd8"; context.fillRect(x, photoY, photoWidth, photoHeight); }
        context.fillStyle = "#5f7068"; context.font = "500 15px sans-serif"; context.fillText(photo.place, x + 4, photoY + photoHeight + 16);
      });
      itemY += Math.ceil(layout.shownPhotos.length / 2) * 250;
    }
    if (layout.dayPhotos.length > layout.shownPhotos.length) { context.fillStyle = "#87938d"; context.font = "400 17px sans-serif"; context.fillText(`还有 ${layout.dayPhotos.length - layout.shownPhotos.length} 张照片留在旅途相册`, 78, y + layout.height - 22); }
    y += layout.height + 28;
  }
  context.fillStyle = "#183f32"; context.font = "700 28px sans-serif"; context.fillText("在途 · 边走，边记。", 58, height - 72);
  context.fillStyle = "#7d8b84"; context.font = "400 17px sans-serif"; context.textAlign = "right"; context.fillText("照片与行程由同行成员共同记录", width - 58, height - 72); context.textAlign = "left";
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("长图生成失败")), "image/png"));
  return blob;
}

export default function Home() {
  const [view, setView] = useState<View>("journey");
  const [expenses, setExpenses] = useState<Expense[]>(starterExpenses);
  const [plan, setPlan] = useState<PlanItem[]>(starterPlan);
  const [members, setMembers] = useState<Member[]>(starterMembers);
  const [identity, setIdentity] = useState<Member | null>(null);
  const [photos, setPhotos] = useState<DayPhoto[]>([]);
  const [trip, setTrip] = useState<Trip>({ title: "我的新旅程", destination: "待定目的地" });
  const [histories, setHistories] = useState<TripHistory[]>([]);
  const [selectedDay, setSelectedDay] = useState(1);
  const [category, setCategory] = useState<Category>("餐饮");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showDates, setShowDates] = useState(false);
  const [activeHistory, setActiveHistory] = useState<TripHistory | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editingPlan, setEditingPlan] = useState<PlanItem | null>(null);
  const [photoToDelete, setPhotoToDelete] = useState<DayPhoto | null>(null);
  const [importText, setImportText] = useState("");
  const [toast, setToast] = useState("");
  const [syncState, setSyncState] = useState<"connecting" | "synced" | "offline">("connecting");
  const [heroSlide, setHeroSlide] = useState(0);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [exportingPoster, setExportingPoster] = useState(false);
  const [posterPreview, setPosterPreview] = useState<{ url: string; filename: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const dayScroll = useRef<HTMLDivElement>(null);
  const initializedDateRange = useRef("");
  const dragState = useRef({ active: false, moved: false, x: 0, scrollLeft: 0 });
  const shareCode = "TRIP-START";

  const applySnapshot = useCallback((data: { trip?: Trip; expenses?: Expense[]; plan?: PlanItem[]; members?: Member[]; photos?: DayPhoto[]; histories?: TripHistory[] }) => {
    if (data.trip) setTrip(data.trip);
    if (data.expenses) setExpenses(data.expenses);
    if (data.plan) setPlan(data.plan);
    if (data.members) setMembers(data.members);
    if (data.photos) setPhotos(data.photos);
    if (data.histories) setHistories(data.histories);
    setSyncState("synced");
  }, []);

  useEffect(() => {
    if (!activeHistory) return;
    const refreshed = histories.find((history) => history.id === activeHistory.id);
    if (!refreshed) setActiveHistory(null);
    else if (refreshed !== activeHistory) setActiveHistory(refreshed);
  }, [activeHistory, histories]);

  const refreshTrip = useCallback(async () => {
    try {
      const response = await fetch(`/api/trip?code=${shareCode}`, { cache: "no-store" });
      if (!response.ok) throw new Error("sync failed");
      applySnapshot(await response.json());
    } catch {
      setSyncState("offline");
    }
  }, [applySnapshot]);

  useEffect(() => {
    refreshTrip();
    const timer = window.setInterval(refreshTrip, 5000);
    return () => window.clearInterval(timer);
  }, [refreshTrip]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("traveling-member");
      const parsed = saved ? JSON.parse(saved) as Member : null;
      if (parsed?.deviceId && parsed.name && parsed.color) setIdentity(parsed);
      else {
        const created = createMemberIdentity();
        window.localStorage.setItem("traveling-member", JSON.stringify(created));
        setIdentity(created);
      }
    } catch {
      setIdentity(createMemberIdentity());
    }
  }, []);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    async function syncMember() {
      try {
        const response = await fetch("/api/trip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "upsert_member", member: identity }) });
        if (!response.ok) throw new Error("member sync failed");
        if (!cancelled) applySnapshot(await response.json());
      } catch {
        if (!cancelled) setSyncState("offline");
      }
    }
    syncMember();
    const timer = window.setInterval(syncMember, 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [applySnapshot, identity]);

  useEffect(() => {
    const timer = window.setInterval(() => setHeroSlide((current) => (current + 1) % heroSlides.length), 6000);
    return () => window.clearInterval(timer);
  }, []);

  async function postTrip(payload: Record<string, unknown>) {
    try {
      setSyncState("connecting");
      const response = await fetch("/api/trip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error("save failed");
      const data = await response.json();
      applySnapshot(data);
      return data;
    } catch {
      setSyncState("offline");
      flash("暂时离线，已保留在当前页面");
      return null;
    }
  }

  const total = useMemo(() => expenses.reduce((sum, item) => sum + Number(item.amount), 0), [expenses]);
  const grouped = useMemo(() => (Object.keys(categoryMeta) as Category[]).map((name) => ({ name, value: expenses.filter((item) => item.category === name).reduce((sum, item) => sum + Number(item.amount), 0) })), [expenses]);
  const maxCategory = Math.max(...grouped.map((item) => item.value), 1);
  const dayPlan = useMemo(() => plan.filter((item) => item.day === selectedDay), [plan, selectedDay]);
  const daySpent = expenses.filter((item) => item.day === selectedDay).reduce((sum, item) => sum + Number(item.amount), 0);
  const calendarDays = useMemo<CalendarDay[]>(() => {
    if (trip.startDate && trip.endDate) {
      const start = new Date(`${trip.startDate}T12:00:00`);
      const end = new Date(`${trip.endDate}T12:00:00`);
      const count = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
      if (Number.isFinite(count) && count > 0) return Array.from({ length: Math.min(count, 90) }, (_, index) => {
        const date = new Date(start); date.setDate(start.getDate() + index);
        const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const compare = new Date(date); compare.setHours(0, 0, 0, 0);
        return { day: index + 1, weekday: new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date), date: String(date.getDate()), month: `${date.getMonth() + 1}月`, label: compare.getTime() === today.getTime() ? "今天" : compare < today ? "已过去" : `第${index + 1}天`, iso };
      });
    }
    const count = Math.max(1, ...plan.map((item) => item.day));
    return Array.from({ length: count }, (_, index) => ({ day: index + 1, weekday: "DAY", date: String(index + 1), month: "", label: "待设置日期", iso: "" }));
  }, [trip.startDate, trip.endDate, plan]);

  useEffect(() => {
    if (selectedDay > calendarDays.length) setSelectedDay(calendarDays.length);
  }, [calendarDays.length, selectedDay]);

  useEffect(() => {
    if (!trip.startDate || !trip.endDate) return;
    const rangeKey = `${trip.startDate}|${trip.endDate}`;
    if (initializedDateRange.current === rangeKey) return;
    initializedDateRange.current = rangeKey;
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const targetDay = calendarDays.find((item) => item.iso === todayIso)?.day || 1;
    setSelectedDay(targetDay);
    window.requestAnimationFrame(() => dayScroll.current?.querySelector<HTMLElement>(`[data-day="${targetDay}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }));
  }, [calendarDays, trip.endDate, trip.startDate]);

  function flash(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2200); }

  function startDayDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const element = dayScroll.current; if (!element) return;
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    dragState.current = { active: true, moved: false, x: event.clientX, scrollLeft: element.scrollLeft };
  }

  function moveDayDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragState.current.active || !dayScroll.current) return;
    if (Math.abs(event.clientX - dragState.current.x) > 4) {
      if (!dragState.current.moved) dayScroll.current.setPointerCapture(event.pointerId);
      dragState.current.moved = true;
      event.preventDefault();
    }
    dayScroll.current.scrollLeft = dragState.current.scrollLeft - (event.clientX - dragState.current.x);
  }

  function endDayDrag() {
    dragState.current.active = false;
    window.setTimeout(() => { dragState.current.moved = false; }, 0);
  }

  function selectCalendarDay(day: number) {
    if (dragState.current.moved) { dragState.current.moved = false; return; }
    setSelectedDay(day);
  }

  function saveTripDates(values: { title: string; destination: string; startDate: string; endDate: string }) {
    if (!values.startDate || !values.endDate) return flash("请先选择完整的出发和返程日期");
    if (values.endDate < values.startDate) return flash("返程日期不能早于出发日期");
    setTrip((current) => ({ ...current, ...values }));
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const targetDay = todayIso >= values.startDate && todayIso <= values.endDate ? Math.floor((new Date(`${todayIso}T12:00:00`).getTime() - new Date(`${values.startDate}T12:00:00`).getTime()) / 86400000) + 1 : 1;
    initializedDateRange.current = `${values.startDate}|${values.endDate}`;
    setSelectedDay(targetDay); setShowDates(false); flash(targetDay > 1 ? `旅行日期已保存，已定位到今天（第 ${targetDay} 天）` : "旅行日期已保存，可以左右滑动浏览");
    window.requestAnimationFrame(() => dayScroll.current?.querySelector<HTMLElement>(`[data-day="${targetDay}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }));
    postTrip({ action: "update_trip", ...values });
  }

  function archiveTrip() {
    if (!trip.startDate || !trip.endDate) { setShowDates(true); return flash("先设置旅行日期，再保存旅程"); }
    postTrip({ action: "archive_trip" });
    flash("已保存一份当前旅程快照");
  }

  async function updateHistory(history: TripHistory, values: { title: string; destination: string; startDate: string; endDate: string }) {
    const result = await postTrip({ action: "update_archive", id: history.id, ...values });
    if (result) flash("历史旅程信息已修改");
  }

  async function refreshHistory(history: TripHistory) {
    const result = await postTrip({ action: "refresh_archive", id: history.id });
    if (result) flash("已把当前行程、账单和照片同步到这段旅程");
  }

  async function deleteHistory(history: TripHistory) {
    const result = await postTrip({ action: "delete_archive", id: history.id });
    if (result) {
      setActiveHistory(null);
      flash("历史旅程已删除");
    }
  }

  function addExpense() {
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) return flash("先填一个有效金额");
    const now = new Date();
    const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
    const item: Expense = { id: now.getTime(), category, title: note.trim() || `${category}开销`, amount: numericAmount, time, occurredAt: now.toISOString(), day: selectedDay, createdBy: identity?.name || "同行旅伴" };
    setExpenses((current) => [item, ...current]);
    setAmount(""); setNote(""); flash(`已记下 ¥${money(numericAmount)}`);
    postTrip({ action: "add_expense", item });
  }

  function updateExpense(item: Expense) {
    setExpenses((current) => current.map((expense) => expense.id === item.id ? item : expense));
    setEditingExpense(null); flash("账单记录已修改并同步");
    postTrip({ action: "update_expense", item });
  }

  function deleteExpense(item: Expense) {
    setExpenses((current) => current.filter((expense) => expense.id !== item.id));
    setEditingExpense(null); flash("这笔记录已删除");
    postTrip({ action: "delete_expense", id: item.id });
  }

  function togglePlan(item: PlanItem) {
    const done = !item.done;
    setPlan((current) => current.map((entry) => entry.id === item.id ? { ...entry, done } : entry));
    postTrip({ action: "toggle_plan", id: item.id, done });
  }

  function updatePlan(item: PlanItem) {
    setPlan((current) => current.map((entry) => entry.id === item.id ? item : entry));
    setSelectedDay(item.day);
    setEditingPlan(null);
    flash("行程已修改并同步");
    postTrip({ action: "update_plan", item });
  }

  function deletePlan(item: PlanItem) {
    setPlan((current) => current.filter((entry) => entry.id !== item.id));
    setEditingPlan(null);
    flash("这条行程已删除");
    postTrip({ action: "delete_plan", id: item.id });
  }

  function importSchedule() {
    const parsed = parseScheduleText(importText, selectedDay);
    const imported: PlanItem[] = parsed.map((item: Omit<PlanItem, "id">, index: number) => ({ ...item, id: Date.now() + index }));
    if (!importText.trim()) return flash("粘贴几行日程后再导入");
    if (!imported.length) return flash("只识别到了日期，还需要添加具体行程");
    const importedDays = new Set(imported.map((item) => item.day));
    setPlan(imported);
    setSelectedDay(Math.min(...importedDays));
    setShowImport(false); setImportText(""); flash(`已导入 ${imported.length} 项 · ${importedDays.size} 天`);
    postTrip({ action: "replace_all_plan", items: imported });
  }

  function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => setImportText(String(reader.result || "")); reader.readAsText(file);
  }

  async function uploadDayPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setPhotoUploading(true);
    try {
      flash(file.size > PHOTO_UPLOAD_TARGET ? "正在压缩手机原图…" : "正在上传照片…");
      const uploadFile = await preparePhotoForUpload(file);
      const body = new FormData(); body.append("photo", uploadFile); body.append("day", String(selectedDay)); body.append("place", dayPlan[0]?.place || "当天行程");
      setSyncState("connecting");
      const response = await fetch("/api/photos", { method: "POST", body });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        if (response.status === 413) throw new Error("照片仍然过大，请换一张后重试");
        throw new Error(detail?.error || "照片上传失败，请稍后重试");
      }
      applySnapshot(await response.json()); flash("旅途随拍已上传并同步给同行伙伴");
    } catch (error) {
      setSyncState("synced");
      flash(error instanceof Error ? error.message : "照片上传失败，请稍后重试");
    } finally { setPhotoUploading(false); }
    event.target.value = "";
  }

  async function deletePhoto(photo: DayPhoto) {
    try {
      setSyncState("connecting");
      const response = await fetch(`/api/photos?id=${photo.id}`, { method: "DELETE" });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(detail?.error || "照片删除失败");
      }
      applySnapshot(await response.json()); setPhotoToDelete(null); flash("这张旅途照片已删除");
    } catch (error) {
      setSyncState("synced"); flash(error instanceof Error ? error.message : "照片删除失败");
    }
  }

  async function exportTripPoster() {
    try {
      setExportingPoster(true); flash("正在把随拍和日程排成长图…");
      const blob = await createTripPoster(trip, calendarDays, plan, photos);
      if (posterPreview) URL.revokeObjectURL(posterPreview.url);
      const safeName = (trip.title || "旅行打卡").replace(/[\\/:*?"<>|]/g, "-");
      setPosterPreview({ url: URL.createObjectURL(blob), filename: `${safeName}-打卡长图.png` });
      flash("打卡长图已生成");
    } catch (error) { flash(error instanceof Error ? error.message : "长图生成失败"); }
    finally { setExportingPoster(false); }
  }

  function closePosterPreview() {
    if (posterPreview) URL.revokeObjectURL(posterPreview.url);
    setPosterPreview(null);
  }

  async function copyInvite() {
    const url = `${window.location.origin}/?trip=${shareCode}`;
    await navigator.clipboard.writeText(url);
    flash("同行邀请链接已复制");
  }

  function updateMemberName(value: string) {
    if (!identity) return;
    const name = value.trim().slice(0, 20);
    if (!name) return flash("请输入你的同行昵称");
    const updated = { ...identity, name };
    setIdentity(updated);
    window.localStorage.setItem("traveling-member", JSON.stringify(updated));
    postTrip({ action: "upsert_member", member: updated });
    flash("同行昵称已更新");
  }

  const headings: Record<View, string> = { journey: "今天，先去想去的地方。", ledger: "账单", history: "过去的旅程" };
  const activeHero = heroSlides[heroSlide];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Compass weight="fill" /></span><span>在途</span></div>
        <div className="trip-switcher"><span>共享旅程</span><button aria-label="旅程菜单"><span>LIVE</span><CaretDown /></button><strong>{trip.title}</strong><small>{trip.destination || "待定目的地"}{trip.startDate ? ` · ${trip.startDate.slice(5)} 至 ${trip.endDate?.slice(5)}` : " · 等待设置日期"}</small></div>
        <nav aria-label="主导航">
          <button aria-label="行程与记账" className={view === "journey" ? "active" : ""} onClick={() => setView("journey")}><MapTrifold /><span>行程与记账</span></button>
          <button aria-label="旅途账单" className={view === "ledger" ? "active" : ""} onClick={() => setView("ledger")}><Wallet /><span>旅途账单</span></button>
          <button aria-label="历史旅程" className={view === "history" ? "active" : ""} onClick={() => setView("history")}><Receipt /><span>历史旅程</span></button>
        </nav>
        <div className="route-stamp" aria-hidden="true"><div><span>FROM</span><AirplaneTilt weight="fill" /><span>TO</span></div><small>YOUR NEXT JOURNEY</small></div>
        <div className="travel-note"><MapPin weight="fill" /><p>{trip.destination || "还没有目的地"}<br />每一天都可以重新安排。</p></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><button className="location" onClick={() => setShowDates(true)}><MapPin weight="fill" />{trip.destination || "设置目的地与日期"}</button><h1>{headings[view]}</h1></div>
          <div className="header-actions">
            <button className="travelers-button" onClick={() => setShowShare(true)} aria-label="查看同行成员与同步状态">
              <span className="avatar-stack">{members.slice(0, 3).map((member, index) => <i key={`${member.name}-${index}`} style={{ background: member.color }}>{member.name.slice(0, 1)}</i>)}</span>
              <span>{members.length}人同行</span><b className={`sync-dot ${syncState}`} />
            </button>
            <button className="import-button" onClick={() => setShowImport(true)}><UploadSimple />导入日程</button>
          </div>
        </header>

        {view === "journey" && (
          <>
            <section className="travel-hero" aria-roledescription="carousel" aria-label="旅行风景轮播">
              <img key={activeHero.src} src={activeHero.src} alt={activeHero.place} />
              <div className="hero-caption"><span>{activeHero.eyebrow}</span><strong>{activeHero.title}</strong><div><MapPin weight="fill" />{activeHero.place}</div></div>
              <div className="carousel-arrows"><button aria-label="上一张风景" onClick={() => setHeroSlide((heroSlide - 1 + heroSlides.length) % heroSlides.length)}><CaretLeft /></button><button aria-label="下一张风景" onClick={() => setHeroSlide((heroSlide + 1) % heroSlides.length)}><CaretRight /></button></div>
              <div className="carousel-dots">{heroSlides.map((slide, index) => <button key={slide.src} aria-label={`查看第 ${index + 1} 张风景`} aria-current={index === heroSlide} className={index === heroSlide ? "active" : ""} onClick={() => setHeroSlide(index)} />)}</div>
              <span className="hero-note">旅行灵感 · 首页风景由你决定</span>
            </section>

            <section className="day-navigator" aria-label="旅行日期">
              <div className="date-range-bar"><div><CalendarBlank /><span>{trip.startDate ? `${trip.startDate} — ${trip.endDate}` : "先选择整趟旅行的日期"}</span><small>{calendarDays.length} 天行程</small></div><button onClick={() => setShowDates(true)}>{trip.startDate ? "修改日期" : "选择日期"}</button></div>
              <div className="day-strip">
                <div className="day-scroll" ref={dayScroll} onPointerDown={startDayDrag} onPointerMove={moveDayDrag} onPointerUp={endDayDrag} onPointerCancel={endDayDrag} onPointerLeave={endDayDrag}>
                  {calendarDays.map((item) => <button type="button" key={`${item.day}-${item.iso}`} data-day={item.day} aria-current={item.label === "今天" ? "date" : undefined} aria-pressed={selectedDay === item.day} className={selectedDay === item.day ? "active" : ""} onClick={() => selectCalendarDay(item.day)}><span>{item.weekday}</span><strong>{item.date}</strong><small>{item.month} {item.label}</small></button>)}
                </div>
                <div className="day-summary"><span>第 {selectedDay} 天已记</span><strong>{expenses.filter((item) => item.day === selectedDay).length} 笔</strong><small>拖动浏览全部日期</small></div>
              </div>
            </section>

            <RouteMap day={selectedDay} destination={trip.destination} plan={dayPlan} />

            <section className="focus-grid">
              <div className="itinerary-section">
                <div className="section-title"><div><CalendarBlank /><h2>当天行程</h2></div><button onClick={() => setShowImport(true)}>编辑日程</button></div>
                {dayPlan.length ? <div className="timeline">{dayPlan.map((item) => <div className={`timeline-item ${item.done ? "done" : ""}`} key={item.id}><button className="plan-check" aria-label={item.done ? "标记为未完成" : "标记为完成"} onClick={() => togglePlan(item)}>{item.done ? <Check weight="bold" /> : null}</button><time>{item.time}</time><div className="plan-copy"><strong>{item.title}</strong><span><MapPin />{item.place}</span></div><button className="plan-edit-button" aria-label={`修改行程：${item.title}`} onClick={() => setEditingPlan(item)}><PencilSimple /></button></div>)}</div> : <EmptyPlan onImport={() => setShowImport(true)} />}
              </div>

              <div className="add-expense">
                <div className="add-title"><span><Plus weight="bold" /></span><div><strong>随手记一笔</strong><small>先选是什么，再填金额</small></div></div>
                <div className="record-day-indicator"><CalendarBlank /><span>计入第 {selectedDay} 天{calendarDays[selectedDay - 1]?.iso ? ` · ${calendarDays[selectedDay - 1].iso}` : ""}</span><small>点击上方日期卡可切换</small></div>
                <div className="category-tabs" role="group" aria-label="开销分类">{(Object.keys(categoryMeta) as Category[]).map((name) => { const Icon = categoryMeta[name].icon; return <button key={name} aria-label={`${name}开销`} className={category === name ? "selected" : ""} onClick={() => setCategory(name)}><Icon weight={category === name ? "fill" : "regular"} /><span>{name}</span></button>; })}</div>
                <div className="category-hint"><span style={{ background: categoryMeta[category].color }} />正在记录：<strong>{category}</strong> · {categoryMeta[category].hint}</div>
                <label className="amount-input"><span>¥</span><input aria-label="金额" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" /></label>
                <label className="note-input"><span>花在</span><input aria-label="开销备注" value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：夜市芒果糯米饭" onKeyDown={(event) => event.key === "Enter" && addExpense()} /></label>
                <button className="save-expense" onClick={addExpense}>记下并同步<ArrowRight weight="bold" /></button>
                <div className="sync-note"><UsersThree />同行成员会在几秒内看到这笔记录</div>
              </div>
            </section>

            <section className={`photo-journal stamp-gallery ${photos.length ? "has-photos" : "is-empty"}`}>
              <div className="journal-heading"><span>TRAVEL MOMENTS</span><h2>旅途随拍</h2><p>把沿途遇见的光、风景和同行瞬间，收进这一页旅途邮票。</p><div className="journal-actions"><button disabled={photoUploading} onClick={() => photoInput.current?.click()}><Camera weight="fill" />{photoUploading ? "正在处理…" : "拍一张 / 上传"}</button><button className="poster-button" disabled={exportingPoster || (!plan.length && !photos.length)} onClick={exportTripPoster}><DownloadSimple />{exportingPoster ? "正在生成…" : "生成打卡长图"}</button></div><small>手机原图会自动优化，并归入第 {selectedDay} 天</small></div>
              {photos.length ? <div className="stamp-wall">{photos.map((photo, index) => <article className={`photo-stamp stamp-tone-${index % 4}`} key={photo.id || `${photo.day}-${photo.url}`}><div className="stamp-photo"><img src={photo.url} alt={`第 ${photo.day} 天 · ${photo.place}`} /><button aria-label={`删除第 ${photo.day} 天的照片`} onClick={() => setPhotoToDelete(photo)}><Trash /></button></div><footer><div><span>DAY {String(photo.day).padStart(2, "0")}</span><strong>{photo.place}</strong></div><i>{String(index + 1).padStart(2, "0")}</i></footer></article>)}</div> : <div className="journal-empty"><Camera /><strong>第一张照片，留给旅途中</strong><span>现在拍一张，或从手机相册选择。</span><button disabled={photoUploading} onClick={() => photoInput.current?.click()}>{photoUploading ? "正在处理照片…" : "打开相机 / 相册"}</button></div>}
              <input ref={photoInput} type="file" accept="image/*" capture="environment" onChange={uploadDayPhoto} hidden />
            </section>
          </>
        )}

        {view === "ledger" && <LedgerView expenses={expenses} grouped={grouped} maxCategory={maxCategory} total={total} budget={0} daySpent={daySpent} selectedDay={selectedDay} calendarDays={calendarDays} onEdit={setEditingExpense} />}
        {view === "history" && <HistoryView histories={histories} canArchive={Boolean(plan.length || expenses.length || photos.length)} onArchive={archiveTrip} onOpen={setActiveHistory} />}
      </section>

      {showImport && <ImportModal importText={importText} setImportText={setImportText} selectedDay={selectedDay} onClose={() => setShowImport(false)} onImport={importSchedule} onFile={readFile} fileInput={fileInput} />}
      {showShare && <ShareModal members={members} identity={identity} code={shareCode} state={syncState} onClose={() => setShowShare(false)} onCopy={copyInvite} onRename={updateMemberName} />}
      {showDates && <DateRangeModal trip={trip} onClose={() => setShowDates(false)} onSave={saveTripDates} />}
      {activeHistory && <HistoryModal history={activeHistory} onClose={() => setActiveHistory(null)} onUpdate={updateHistory} onRefresh={refreshHistory} onDelete={deleteHistory} />}
      {editingExpense && <ExpenseEditModal expense={editingExpense} maxDay={calendarDays.length} onClose={() => setEditingExpense(null)} onSave={updateExpense} onDelete={deleteExpense} />}
      {editingPlan && <PlanEditModal item={editingPlan} maxDay={calendarDays.length} onClose={() => setEditingPlan(null)} onSave={updatePlan} onDelete={deletePlan} />}
      {photoToDelete && <PhotoDeleteModal photo={photoToDelete} onClose={() => setPhotoToDelete(null)} onDelete={() => deletePhoto(photoToDelete)} />}
      {posterPreview && <PosterPreviewModal preview={posterPreview} onClose={closePosterPreview} />}
      {toast && <div className="toast"><Check weight="bold" />{toast}</div>}
    </main>
  );
}

function EmptyPlan({ onImport }: { onImport: () => void }) { return <div className="empty-plan"><MapTrifold /><strong>这一天还很自由</strong><span>导入日程，给旅途一个轻轻的方向。</span><button onClick={onImport}>导入日程</button></div>; }

function LedgerView({ expenses, grouped, maxCategory, total, budget, calendarDays, onEdit }: { expenses: Expense[]; grouped: { name: Category; value: number }[]; maxCategory: number; total: number; budget: number; daySpent: number; selectedDay: number; calendarDays: CalendarDay[]; onEdit: (expense: Expense) => void }) {
  return <section className="ledger-view">
    <div className="ledger-intro"><span>共享账本</span></div>
    <div className="ledger-grid">
      <div className="expense-list ledger-list"><div className="section-title"><div><Clock /><h2>全部开销</h2></div><span>{expenses.length} 笔</span></div>{expenses.length ? expenses.map((item) => { const Icon = categoryMeta[item.category].icon; const tripDate = calendarDays.find((day) => day.day === item.day)?.iso; return <div className="expense-row" key={item.id}><span className="expense-icon" style={{ color: categoryMeta[item.category].color }}><Icon weight="fill" /></span><div><strong>{item.title}</strong><span>{item.category} · 第 {item.day} 天{tripDate ? `（${tripDate}）` : ""} · 记于 {formatExpenseMoment(item)} · {item.createdBy || "同行旅伴"}</span></div><b>− ¥{money(item.amount)}</b><button className="expense-edit" aria-label={`修改 ${item.title}`} onClick={() => onEdit(item)}><PencilSimple /></button></div>; }) : <div className="ledger-empty"><Receipt /><strong>还没有开销记录</strong><span>旅途中记下的第一笔，会出现在这里。</span></div>}</div>
      <div className="spend-summary"><div className="summary-heading"><span>本次总开销</span><span className="live-dot">同行实时汇总</span></div><div className="total-line"><span>¥</span><strong>{money(total)}</strong><small>{budget ? `/ 预算 ¥${money(budget)}` : "/ 未设置预算"}</small></div><div className="budget-track"><span style={{ width: budget ? `${Math.min((total / budget) * 100, 100)}%` : "0%" }} /></div><div className="budget-caption"><span>{budget ? `预算用了 ${Math.round((total / budget) * 100)}%` : "添加预算后可查看进度"}</span><span>{budget ? `还可花 ¥${money(Math.max(budget - total, 0))}` : ""}</span></div><div className="category-bars">{grouped.map((item) => { const Icon = categoryMeta[item.name].icon; return <div className="bar-row" key={item.name}><span className="bar-label"><Icon />{item.name}</span><div><i style={{ width: `${(item.value / maxCategory) * 100}%`, background: categoryMeta[item.name].color }} /></div><strong>¥{money(item.value)}</strong></div>; })}</div></div>
    </div>
  </section>;
}

function HistoryView({ histories, canArchive, onArchive, onOpen }: { histories: TripHistory[]; canArchive: boolean; onArchive: () => void; onOpen: (history: TripHistory) => void }) {
  if (!histories.length) return <section className="history-view"><div className="history-empty"><span className="modal-icon"><MapTrifold /></span><strong>还没有过去的旅程</strong><p>旅行途中也可以随时保存当前快照，不必等到旅程结束。之后打开它，还能继续同步最新日程、账单和照片。</p><button disabled={!canArchive} onClick={onArchive}><Receipt />{canArchive ? "保存当前快照" : "先记录一段旅程"}</button></div></section>;
  return <section className="history-view"><div className="history-toolbar"><div><span>TRIP ARCHIVE</span><h2>{histories.length} 段被好好保存的旅程</h2><p>这里保存的是旅程快照；打开任意一段，可同步当前记录、编辑或删除。</p></div><button disabled={!canArchive} onClick={onArchive}><Receipt />保存当前快照</button></div><div className="history-cards">{histories.map((history, index) => { const total = history.snapshot.expenses.reduce((sum, item) => sum + Number(item.amount), 0); return <button className={`history-card tone-${index % 3}`} key={history.id} onClick={() => onOpen(history)}><span>{history.startDate || "未设日期"} — {history.endDate || ""}</span><strong>{history.title}</strong><small><MapPin weight="fill" />{history.destination || "待定目的地"}</small><div><span>{history.snapshot.plan.length} 项行程 · {history.snapshot.photos.length} 张照片 · {history.snapshot.expenses.length} 笔账单</span><b>¥{money(total)}</b></div></button>; })}</div></section>;
}

function DateRangeModal({ trip, onClose, onSave }: { trip: Trip; onClose: () => void; onSave: (values: { title: string; destination: string; startDate: string; endDate: string }) => void }) {
  const [title, setTitle] = useState(trip.title || "我的新旅程");
  const [destination, setDestination] = useState(trip.destination === "添加目的地" ? "" : trip.destination || "");
  const [startDate, setStartDate] = useState(trip.startDate || "");
  const [endDate, setEndDate] = useState(trip.endDate || "");
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="import-modal date-modal" role="dialog" aria-modal="true" aria-labelledby="date-title" onMouseDown={(event) => event.stopPropagation()}><button className="close-modal" aria-label="关闭" onClick={onClose}><X /></button><span className="modal-icon"><CalendarBlank /></span><h2 id="date-title">这趟旅行，从哪天到哪天？</h2><p>日期范围决定顶部可以滑动浏览多少天，过去和未来的日期都支持。</p><div className="trip-fields"><label><span>旅程名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：我们的毕业旅行" /></label><label><span>目的地</span><input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="由你填写真实目的地" /></label><div><label><span>出发日期</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><i>到</i><label><span>返程日期</span><input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label></div></div><button className="confirm-import range-save" onClick={() => onSave({ title: title.trim() || "我的新旅程", destination: destination.trim() || "待定目的地", startDate, endDate })}>保存日期并开始浏览<ArrowRight /></button></section></div>;
}

function HistoryModal({ history, onClose, onUpdate, onRefresh, onDelete }: { history: TripHistory; onClose: () => void; onUpdate: (history: TripHistory, values: { title: string; destination: string; startDate: string; endDate: string }) => void; onRefresh: (history: TripHistory) => void; onDelete: (history: TripHistory) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(history.title);
  const [destination, setDestination] = useState(history.destination);
  const [startDate, setStartDate] = useState(history.startDate);
  const [endDate, setEndDate] = useState(history.endDate);
  const groupedPlan = Array.from(new Set(history.snapshot.plan.map((item) => item.day))).sort((a, b) => a - b);
  const total = history.snapshot.expenses.reduce((sum, item) => sum + Number(item.amount), 0);
  function saveInfo() {
    if (!startDate || !endDate || endDate < startDate) return;
    onUpdate(history, { title: title.trim() || "未命名旅程", destination: destination.trim() || "待定目的地", startDate, endDate });
    setEditing(false);
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="import-modal history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title" onMouseDown={(event) => event.stopPropagation()}><button className="close-modal" aria-label="关闭" onClick={onClose}><X /></button>{editing ? <div className="history-edit-fields"><label><span>旅程名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label><span>目的地</span><input value={destination} onChange={(event) => setDestination(event.target.value)} /></label><div><label><span>出发日期</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label><span>返程日期</span><input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div><div className="history-edit-actions"><button className="file-button" onClick={() => setEditing(false)}>取消</button><button className="confirm-import" onClick={saveInfo}>保存修改</button></div></div> : <><span className="history-kicker">{history.startDate} — {history.endDate}</span><h2 id="history-title">{history.title}</h2><p><MapPin weight="fill" />{history.destination}</p></>}<div className="history-snapshot-note">这是一份独立快照，不会被当前账单自动覆盖。旅行中可随时点击“同步当前记录”更新它。</div><div className="history-modal-actions"><button onClick={() => onRefresh(history)}><Clock />同步当前记录</button><button onClick={() => setEditing(true)}><PencilSimple />编辑信息</button><button className={`history-delete ${confirmDelete ? "confirming" : ""}`} onClick={() => confirmDelete ? onDelete(history) : setConfirmDelete(true)}><Trash />{confirmDelete ? "确认删除" : "删除旅程"}</button></div><div className="history-overview"><div><span>日程</span><strong>{history.snapshot.plan.length}</strong></div><div><span>照片</span><strong>{history.snapshot.photos.length}</strong></div><div><span>总开销</span><strong>¥{money(total)}</strong></div></div><div className="archive-days">{groupedPlan.length ? groupedPlan.map((day) => <section key={day}><span>DAY {String(day).padStart(2, "0")}</span>{history.snapshot.plan.filter((item) => item.day === day).map((item) => <div key={item.id}><time>{item.time}</time><strong>{item.title}</strong><small>{item.place}</small></div>)}</section>) : <div className="archive-empty">这趟旅程没有保存日程项目</div>}</div><div className="archive-expenses"><span>保存的账单 · {history.snapshot.expenses.length} 笔</span>{history.snapshot.expenses.length ? history.snapshot.expenses.map((item) => <div key={item.id}><span>第 {item.day} 天 · {item.category}</span><strong>{item.title}</strong><b>¥{money(item.amount)}</b></div>) : <div className="archive-empty">这份快照还没有账单记录</div>}</div></section></div>;
}

function PlanEditModal({ item, maxDay, onClose, onSave, onDelete }: { item: PlanItem; maxDay: number; onClose: () => void; onSave: (item: PlanItem) => void; onDelete: (item: PlanItem) => void }) {
  const [time, setTime] = useState(item.time);
  const [title, setTitle] = useState(item.title);
  const [place, setPlace] = useState(item.place);
  const [day, setDay] = useState(item.day);
  const [confirmDelete, setConfirmDelete] = useState(false);
  function save() {
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time) || !title.trim()) return;
    onSave({ ...item, time, title: title.trim(), place: place.trim() || title.trim(), day });
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="import-modal expense-modal plan-edit-modal" role="dialog" aria-modal="true" aria-labelledby="plan-edit-title" onMouseDown={(event) => event.stopPropagation()}><button className="close-modal" aria-label="关闭" onClick={onClose}><X /></button><span className="modal-icon"><PencilSimple /></span><h2 id="plan-edit-title">修改这条行程</h2><p>时间、地点或归属日期修改后，会立即同步给同行伙伴。</p><div className="trip-fields"><label><span>行程名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：参观博物馆" /></label><label><span>地图地点</span><input value={place} onChange={(event) => setPlace(event.target.value)} placeholder="用于地图定位，例如：莫高窟" /></label><div><label><span>时间</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label><i>·</i><label><span>归入哪一天</span><input type="number" min={1} max={Math.max(maxDay, item.day)} value={day} onChange={(event) => setDay(Math.min(Math.max(1, Number(event.target.value)), Math.max(maxDay, item.day)))} /></label></div></div><div className="expense-modal-actions"><button className={`delete-expense ${confirmDelete ? "confirming" : ""}`} onClick={() => confirmDelete ? onDelete(item) : setConfirmDelete(true)}><Trash />{confirmDelete ? "确认删除" : "删除行程"}</button><button className="confirm-import" onClick={save}>保存修改<ArrowRight /></button></div>{confirmDelete && <small className="delete-warning">删除后无法恢复，再点一次确认删除。</small>}</section></div>;
}

function ExpenseEditModal({ expense, maxDay, onClose, onSave, onDelete }: { expense: Expense; maxDay: number; onClose: () => void; onSave: (expense: Expense) => void; onDelete: (expense: Expense) => void }) {
  const [category, setCategory] = useState<Category>(expense.category);
  const [title, setTitle] = useState(expense.title);
  const [amount, setAmount] = useState(String(expense.amount));
  const [day, setDay] = useState(expense.day);
  const [confirmDelete, setConfirmDelete] = useState(false);
  function save() {
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) return;
    onSave({ ...expense, category, title: title.trim() || `${category}开销`, amount: numericAmount, day });
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="import-modal expense-modal" role="dialog" aria-modal="true" aria-labelledby="expense-edit-title" onMouseDown={(event) => event.stopPropagation()}><button className="close-modal" aria-label="关闭" onClick={onClose}><X /></button><span className="modal-icon"><PencilSimple /></span><h2 id="expense-edit-title">修改这笔开销</h2><p>修改后会立即同步给同行伙伴。</p><div className="edit-category">{(Object.keys(categoryMeta) as Category[]).map((name) => { const Icon = categoryMeta[name].icon; return <button key={name} className={category === name ? "active" : ""} onClick={() => setCategory(name)}><Icon /><span>{name}</span></button>; })}</div><div className="trip-fields"><label><span>花在</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="这笔钱花在什么地方" /></label><div><label><span>金额</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} /></label><i>·</i><label><span>归入哪一天</span><input type="number" min={1} max={Math.max(maxDay, expense.day)} value={day} onChange={(event) => setDay(Math.max(1, Number(event.target.value)))} /></label></div></div><div className="expense-modal-actions"><button className={`delete-expense ${confirmDelete ? "confirming" : ""}`} onClick={() => confirmDelete ? onDelete(expense) : setConfirmDelete(true)}><Trash />{confirmDelete ? "确认删除" : "删除记录"}</button><button className="confirm-import" onClick={save}>保存修改<ArrowRight /></button></div>{confirmDelete && <small className="delete-warning">删除后无法恢复，再点一次确认删除。</small>}</section></div>;
}

function PhotoDeleteModal({ photo, onClose, onDelete }: { photo: DayPhoto; onClose: () => void; onDelete: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="import-modal photo-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="photo-delete-title" onMouseDown={(event) => event.stopPropagation()}><button className="close-modal" aria-label="关闭" onClick={onClose}><X /></button><div className="delete-photo-preview"><img src={photo.url} alt={`准备删除：第 ${photo.day} 天 ${photo.place}`} /></div><h2 id="photo-delete-title">要取下这张邮票吗？</h2><p>这会删除第 {photo.day} 天「{photo.place}」的照片，其他随拍不会受影响。</p><div className="expense-modal-actions"><button className="file-button" onClick={onClose}>先留着</button><button className="delete-expense confirming" onClick={onDelete}><Trash />确认删除</button></div></section></div>;
}

function PosterPreviewModal({ preview, onClose }: { preview: { url: string; filename: string }; onClose: () => void }) {
  return <div className="modal-backdrop poster-backdrop" role="presentation" onMouseDown={onClose}><section className="poster-preview-modal" role="dialog" aria-modal="true" aria-labelledby="poster-preview-title" onMouseDown={(event) => event.stopPropagation()}><button className="close-modal" aria-label="关闭" onClick={onClose}><X /></button><div className="poster-preview-heading"><span>CHECK-IN POSTER</span><h2 id="poster-preview-title">你的旅行打卡长图</h2><p>已按日期自动配好当天日程与随拍。</p></div><div className="poster-preview-scroll"><img src={preview.url} alt="旅行打卡长图预览" /></div><div className="poster-preview-actions"><button className="file-button" onClick={onClose}>返回调整</button><a href={preview.url} download={preview.filename}><DownloadSimple />保存 PNG 图片</a></div></section></div>;
}

function ImportModal({ importText, setImportText, selectedDay, onClose, onImport, onFile, fileInput }: { importText: string; setImportText: (value: string) => void; selectedDay: number; onClose: () => void; onImport: () => void; onFile: (event: ChangeEvent<HTMLInputElement>) => void; fileInput: React.RefObject<HTMLInputElement | null> }) {
  const preview = useMemo(() => scheduleImportSummary(parseScheduleText(importText, selectedDay)), [importText, selectedDay]);
  const itemCount = preview.reduce((sum, item) => sum + item.count, 0);
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}><button className="close-modal" aria-label="关闭" onClick={onClose}><X /></button><span className="modal-icon"><UploadSimple /></span><h2 id="import-title">一次导入整趟行程</h2><p>支持“第2天、第二天、Day 2、8月3日”等分组，也支持 Markdown、TXT、CSV 和 ICS 文件。</p><textarea value={importText} onChange={(event) => setImportText(event.target.value)} aria-label="待导入的多日行程" placeholder={"第一天｜8月2日\n09:30 故宫参观｜故宫博物院\n14:00 景山看全景｜景山公园\n\n第二天｜8月3日\n10:00 逛胡同｜南锣鼓巷\n18:30 看夜景｜什刹海"} />{importText.trim() && <div className={`import-preview ${preview.length ? "recognized" : "unrecognized"}`}><div><strong>{preview.length ? `已识别 ${preview.length} 天 · ${itemCount} 项` : "还没有识别到具体行程"}</strong><span>{preview.length ? "导入前先确认每天数量" : "请检查日期标题和每行内容"}</span></div>{preview.length > 0 && <div>{preview.map((item) => <span key={item.day}>第 {item.day} 天 <b>{item.count}</b> 项</span>)}</div>}</div>}<input ref={fileInput} type="file" accept=".txt,.csv,.ics,text/plain,text/calendar" onChange={onFile} hidden /><div className="modal-actions"><button className="file-button" onClick={() => fileInput.current?.click()}><UploadSimple />选择文件</button><button className="confirm-import" onClick={onImport}>导入整趟行程<ArrowRight /></button></div></section></div>;
}

function ShareModal({ members, identity, code, state, onClose, onCopy, onRename }: { members: Member[]; identity: Member | null; code: string; state: string; onClose: () => void; onCopy: () => void; onRename: (name: string) => void }) {
  const [name, setName] = useState(identity?.name || "");
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="import-modal share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onMouseDown={(event) => event.stopPropagation()}><button className="close-modal" aria-label="关闭" onClick={onClose}><X /></button><span className="modal-icon"><UsersThree /></span><h2 id="share-title">一起看，同步记</h2><p>每台设备会登记为一位同行成员，账单会显示真实记录者。修改昵称后，同一设备下次仍会记住。</p><div className="member-profile"><label><span>我的同行昵称</span><input value={name} maxLength={20} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onRename(name)} /></label><button onClick={() => onRename(name)}>保存昵称</button></div><div className="share-code"><span>旅程码</span><strong>{code}</strong><button onClick={onCopy} aria-label="复制邀请链接"><Copy /></button></div><div className="member-list">{members.map((member) => <div key={member.deviceId}><i style={{ background: member.color }}>{member.name.slice(0, 1)}</i><span>{member.name}</span><small>{member.deviceId === identity?.deviceId ? "当前设备" : "已同步"}</small></div>)}</div><div className={`sync-status ${state}`}><span />{state === "synced" ? "云端已同步" : state === "connecting" ? "正在同步" : "当前离线，恢复后会继续同步"}</div><button className="confirm-import share-button" onClick={onCopy}><LinkSimple />复制同行邀请链接</button></section></div>;
}
