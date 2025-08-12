import React, { useEffect, useMemo, useRef, useState } from "react";
import { ComposableMap, Geographies, Geography, Sphere, Graticule, Marker } from "react-simple-maps";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const CITY_GOAL = 100;
const PRESALE_THRESHOLD = 0.01; // show presale button at 1% of goal when testing

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function exportToCSV(rows, filename = "fan_signups.csv") {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v) => `"${String(v ?? "").replaceAll("\"", "\"\"")}` + `"`;
  const csv = [headers.join(","), ...rows.map(r => headers.map(h => escape(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

const COLORS = { bg: "#f7f1e1", ink: "#1f2937", rose: "#ef476f", gold: "#f5c518" };

const SEED_ZIPS = {
  "10001": { city: "New York", state: "NY", lat: 40.7506, lon: -73.9972 },
  "73301": { city: "Austin", state: "TX", lat: 30.2672, lon: -97.7431 },
  "90001": { city: "Los Angeles", state: "CA", lat: 34.0522, lon: -118.2437 },
  "98101": { city: "Seattle", state: "WA", lat: 47.6101, lon: -122.3344 },
  "60601": { city: "Chicago", state: "IL", lat: 41.8853, lon: -87.6216 },
  "80202": { city: "Denver", state: "CO", lat: 39.7508, lon: -104.9966 },
  "94102": { city: "San Francisco", state: "CA", lat: 37.7793, lon: -122.4193 },
  "30301": { city: "Atlanta", state: "GA", lat: 33.749, lon: -84.388 },
  "48201": { city: "Detroit", state: "MI", lat: 42.346, lon: -83.061 },
  "02108": { city: "Boston", state: "MA", lat: 42.357, lon: -71.065 }
};

async function lookupZip(z) {
  if (SEED_ZIPS[z]) return SEED_ZIPS[z];
  const res = await fetch(`https://api.zippopotam.us/us/${z}`);
  if (!res.ok) throw new Error("ZIP lookup failed");
  const data = await res.json();
  const place = data.places?.[0];
  if (!place) throw new Error("ZIP not found");
  return {
    city: place["place name"],
    state: place["state abbreviation"],
    lat: Number(place.latitude),
    lon: Number(place.longitude)
  };
}

export default function FanDemandGlobe() {
  const [rotate, setRotate] = useState([-20, -15, 0]);
  const [zoom, setZoom] = useState(1.15);
  const [cursor, setCursor] = useState("grab");
  const [fatal, setFatal] = useState("");
  const [submissions, setSubmissions] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cc_fan_globe_submissions") || "[]"); } catch { return []; }
  });
  const [form, setForm] = useState({ name: "", email: "", zip: "" });
  const [message, setMessage] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [retroMode, setRetroMode] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [presaleMode, setPresaleMode] = useState(false);
  const resumeTimer = useRef(null);
  const RESUME_AFTER = 1500;

  const containerRef = useRef(null);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startRotate: rotate, factor: 0.35 });

  useEffect(() => { localStorage.setItem("cc_fan_globe_submissions", JSON.stringify(submissions)); }, [submissions]);

  useEffect(() => {
    const onErr = (e) => setFatal(String(e?.message || e));
    const onRej = (e) => setFatal(String(e.reason?.message || e.reason || "Promise error"));
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => { window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); };
  }, []);

  const leaderboard = useMemo(() => {
    const m = new Map();
    for (const s of submissions) m.set(`${s.city}, ${s.state}`, (m.get(`${s.city}, ${s.state}`) || 0) + 1);
    return Array.from(m.entries()).map(([place, count]) => ({ place, count })).sort((a, b) => b.count - a.count || a.place.localeCompare(b.place));
  }, [submissions]);

  const focus = (lat, lon) => setRotate([-lon, -lat, 0]);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const down = (e) => { setCursor("grabbing"); dragRef.current = { ...dragRef.current, dragging: true, startX: e.clientX, startY: e.clientY, startRotate: rotate }; el.setPointerCapture?.(e.pointerId); };
    const move = (e) => { if (!dragRef.current.dragging) return; const dx = e.clientX - dragRef.current.startX; const dy = e.clientY - dragRef.current.startY; const f = e.shiftKey ? dragRef.current.factor * 1.8 : dragRef.current.factor; const [rx, ry] = dragRef.current.startRotate; setRotate([rx + dx * f, clamp(ry - dy * f, -89, 89), 0]); };
    const up = (e) => { dragRef.current.dragging = false; setCursor("grab"); el.releasePointerCapture?.(e.pointerId); };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { el.removeEventListener("pointerdown", down); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [rotate]);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const onWheel = (e) => { e.preventDefault(); setZoom((z) => clamp(z * (e.deltaY > 0 ? 0.95 : 1.05), 0.9, 2.2)); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const autoSpeed = retroMode ? 0.12 : 0.06;
  useEffect(() => {
    if (!autoRotate) return;
    const id = setInterval(() => { setRotate(([x, y, z]) => [x + autoSpeed, y, z]); }, 30);
    return () => clearInterval(id);
  }, [autoRotate, autoSpeed]);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const onDown = () => { setAutoRotate(false); if (resumeTimer.current) clearTimeout(resumeTimer.current); };
    const onUp = () => { if (resumeTimer.current) clearTimeout(resumeTimer.current); resumeTimer.current = setTimeout(() => setAutoRotate(true), RESUME_AFTER); };
    const onWheel = () => { setAutoRotate(false); if (resumeTimer.current) clearTimeout(resumeTimer.current); resumeTimer.current = setTimeout(() => setAutoRotate(true), RESUME_AFTER); };
    const onTouchStart = onDown;
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault(); setMessage("");
    const { name, email, zip } = form;
    if (!name.trim()) return setMessage("Please enter your name.");
    if (!EMAIL_RE.test(email)) return setMessage("Please enter a valid email.");
    const z = String(zip || "").trim(); if (z.length < 5) return setMessage("Enter a 5-digit ZIP.");
    try {
      const info = await lookupZip(z);
      const row = { id: uid(), name: name.trim(), email: email.trim().toLowerCase(), zip: z, city: info.city, state: info.state, lat: Number(info.lat), lon: Number(info.lon), timestamp: new Date().toISOString() };
      setSubmissions((prev) => [row, ...prev]); setForm({ name: "", email: "", zip: "" }); setMessage("Pinned! Thanks for raising your hand."); setHasSubmitted(true);
    } catch (err) {
      setMessage("Couldn't resolve that ZIP right now. Try a different one or use 'Load demo pins'.");
    }
  }

  function seedDemo() {
    const zips = Object.keys(SEED_ZIPS);
    const sample = zips.map((z) => { const info = SEED_ZIPS[z]; return { id: uid(), name: `Fan ${z}`, email: `fan${z}@example.com`, zip: z, city: info.city, state: info.state, lat: info.lat, lon: info.lon, timestamp: new Date().toISOString() }; });
    setSubmissions((prev) => [...sample, ...prev]); setMessage("Loaded sample pins.");
  }

  const jitter = (i) => (i % 2 ? 0.2 : -0.2) * ((i % 5) + 1);

  const theme = useMemo(() => {
    if (!retroMode) return {
      ocean: "#e7f6f2",
      land: "#d2d2d2",
      stroke: "#111",
      barFill: "linear-gradient(90deg,rgba(0,0,0,0.15),transparent 6px),repeating-linear-gradient(90deg,#c8facc,#c8facc 12px,#aaf0b4 12px,#aaf0b4 24px)",
      fontFamily: "inherit"
    };
    return {
      ocean: "#dff5f2",
      land: "#26d0c9",
      stroke: "#0e2a47",
      barFill: "linear-gradient(90deg, rgba(14,42,71,0.15), transparent 6px), repeating-linear-gradient(90deg,#ffd36e,#ffd36e 12px,#ffb84a 12px,#ffb84a 24px)",
      fontFamily: '"Barlow", "Futura", ui-sans-serif, system-ui'
    };
  }, [retroMode]);

  return (
    <div className="min-h-screen w-full" data-retro={retroMode ? "true" : "false"} style={{ background: COLORS.bg, color: COLORS.ink, fontFamily: theme.fontFamily }}>
      {(
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;700;900&family=Press+Start+2P&display=swap');
          [data-retro="true"] .blink { animation: blink 1s steps(2, start) infinite; }
          @keyframes blink { to { visibility: hidden; } }
          [data-retro="true"] .retro-btn { box-shadow: 4px 4px 0 #000; border-width: 3px; }
