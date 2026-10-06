"use client";
import { useEffect, useState } from "react";

// Escenarios — Ficha funcional (fase 1); resto en maqueta hasta sus fases.
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TABS = ["Ficha", "Partes", "Editor Tile", "Montajes", "Iluminación", "Audio", "API"];
const KINDS = ["fisico", "digital", "hibrido"];
const EMPTY_SCN = { name: "", kind: "fisico", width_cm: "", depth_cm: "", height_cm: "",
  tile_cm: "", palette: "", texture: "", uses: "", description: "", comments: "",
  url: "", genre: "" };

function Ficha() {
  const [items, setItems] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [form, setForm] = useState<any>(EMPTY_SCN);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const token = (() => { try {
    return JSON.parse(localStorage.getItem("mb_session") || "{}").access_token || "";
  } catch { return ""; } })();
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const inp = "bg-zinc-950 border border-zinc-800 rounded px-3 py-2 outline-none w-full text-sm";
  const lbl = "text-xs text-zinc-400 mb-1 block";

  async function load() {
    try {
      const r = await fetch(`${API}/api/scenarios`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (r.ok) setItems(j.items ?? []);
      else setMsg(j.detail || `Error ${r.status}`);
    } catch (e: any) { setMsg(String(e?.message || e)); }
  }
  useEffect(() => { load(); }, []);
  const set = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.value });

  function toPayload(f: any) {
    const num = (v: any) => (v === "" || v == null ? null : Number(v));
    const list = (v: any) => String(v || "").split(",").map((t: string) => t.trim()).filter(Boolean);
    return { name: f.name, kind: f.kind, width_cm: num(f.width_cm), depth_cm: num(f.depth_cm),
      height_cm: num(f.height_cm), tile_cm: num(f.tile_cm), palette: list(f.palette),
      texture: f.texture || null, uses: list(f.uses), description: f.description || null,
      comments: f.comments || null, url: f.url || null, genre: f.genre || null };
  }
  function fromRec(s: any) {
    return { ...EMPTY_SCN, ...s, width_cm: s.width_cm ?? "", depth_cm: s.depth_cm ?? "",
      height_cm: s.height_cm ?? "", tile_cm: s.tile_cm ?? "",
      palette: (s.palette || []).join(", "), uses: (s.uses || []).join(", ") };
  }
  async function save(e: any) {
    e.preventDefault();
    if (!form.name.trim()) { setMsg("El nombre es obligatorio."); return; }
    const url = editing && sel ? `${API}/api/scenarios/${sel.id}` : `${API}/api/scenarios`;
    const r = await fetch(url, { method: editing ? "PUT" : "POST", headers: H,
      body: JSON.stringify(toPayload(form)) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(String(j.detail || r.status)); return; }
    setForm(EMPTY_SCN); setEditing(false); setSel(j.id ? j : sel); setMsg(""); load();
  }
  async function remove(id: string) {
    if (!confirm("¿Borrar escenario?")) return;
    await fetch(`${API}/api/scenarios/${id}`, { method: "DELETE",
      headers: { Authorization: `Bearer ${token}` } });
    setSel(null); load();
  }

  return (<section className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
    <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-sm">Escenarios ({items.length})</h2>
        <button onClick={() => { setForm(EMPTY_SCN); setEditing(false); setSel(null); }}
          className="text-xs bg-white text-black rounded px-2 py-1 font-semibold">＋ Nuevo</button>
      </div>
      <div className="mt-2 space-y-1 max-h-96 overflow-y-auto">
        {items.map(s => (
          <button key={s.id} onClick={() => { setSel(s); setForm(fromRec(s)); setEditing(true); }}
            className={`w-full text-left rounded px-2 py-1 text-sm border ${sel?.id === s.id ? "bg-zinc-800 border-zinc-600" : "border-transparent hover:bg-zinc-800"}`}>
            <span className="font-semibold">{s.name}</span>
            <span className="text-xs text-zinc-500 ml-2">{s.kind}{s.genre ? ` · ${s.genre}` : ""}</span>
          </button>))}
        {items.length === 0 && <p className="text-xs text-zinc-500">Sin escenarios. Crea el primero →</p>}
      </div>
      {msg && <p className="text-xs text-amber-400 mt-2">{msg}</p>}
    </div>
    <form onSubmit={save} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded p-4">
      <h2 className="font-bold text-sm">{editing && sel ? `Editar: ${sel.name}` : "Nueva ficha de escenario"}</h2>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <div className="col-span-2"><label className={lbl}>Nombre *</label>
          <input className={inp} value={form.name} onChange={set("name")} placeholder="Bosque Élfico — claro central" /></div>
        <div><label className={lbl}>Tipo</label>
          <select className={inp} value={form.kind} onChange={set("kind")}>
            {KINDS.map(k => <option key={k} value={k}>{k}</option>)}</select></div>
        <div><label className={lbl}>Género</label>
          <input className={inp} value={form.genre} onChange={set("genre")} placeholder="fantasy, terror…" /></div>
        <div><label className={lbl}>Ancho cm</label>
          <input type="number" step="any" className={inp} value={form.width_cm} onChange={set("width_cm")} /></div>
        <div><label className={lbl}>Fondo cm</label>
          <input type="number" step="any" className={inp} value={form.depth_cm} onChange={set("depth_cm")} /></div>
        <div><label className={lbl}>Alto cm</label>
          <input type="number" step="any" className={inp} value={form.height_cm} onChange={set("height_cm")} /></div>
        <div><label className={lbl}>Tile cm</label>
          <input type="number" step="any" className={inp} value={form.tile_cm} onChange={set("tile_cm")} /></div>
        <div className="col-span-2"><label className={lbl}>Colores (coma)</label>
          <input className={inp} value={form.palette} onChange={set("palette")} placeholder="verde, marrón, niebla" /></div>
        <div className="col-span-2"><label className={lbl}>Textura</label>
          <input className={inp} value={form.texture} onChange={set("texture")} placeholder="musgo, corteza, piedra" /></div>
        <div className="col-span-2"><label className={lbl}>Usos posibles (coma)</label>
          <input className={inp} value={form.uses} onChange={set("uses")} placeholder="emboscada, ritual, descanso" /></div>
        <div className="col-span-2"><label className={lbl}>Descripción (contexto narrador)</label>
          <textarea className={inp} rows={3} value={form.description} onChange={set("description")} /></div>
        <div className="col-span-2"><label className={lbl}>Comentarios</label>
          <input className={inp} value={form.comments} onChange={set("comments")} /></div>
        <div className="col-span-2"><label className={lbl}>URL referencia</label>
          <input className={inp} value={form.url} onChange={set("url")} /></div>
      </div>
      <div className="flex gap-2 mt-3">
        <button type="submit" className="bg-white text-black rounded px-4 py-2 text-sm font-semibold">Guardar</button>
        {editing && sel && (
          <button type="button" onClick={() => remove(sel.id)}
            className="bg-red-950 border border-red-900 rounded px-4 py-2 text-sm">Borrar</button>)}
      </div>
    </form>
  </section>);
}

function Soon({ label }: { label: string }) {
  const [n, setN] = useState(0);
  return (<button onClick={() => setN(n + 1)}
    className="text-xs bg-zinc-800 border border-zinc-700 rounded px-3 py-2 hover:border-emerald-400">
    {label}{n > 0 && <span className="text-amber-400"> · próximamente ({n})</span>}
  </button>);
}

function Ph({ label, h = "h-24" }: { label: string; h?: string }) {
  return (<div className={`bg-zinc-900 border border-dashed border-zinc-700 rounded flex items-center justify-center ${h}`}>
    <span className="text-xs text-zinc-600">{label} · placeholder</span>
  </div>);
}

export default function Escenarios() {
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState("Ficha");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mb_session");
      if (!raw || !JSON.parse(raw)?.access_token) location.href = "/";
      else setOk(true);
    } catch { location.href = "/"; }
  }, []);

  if (!ok) return (<main className="p-6"><p className="text-zinc-500 text-sm">Verificando acceso…</p></main>);

  return (<main className="p-6 max-w-6xl mx-auto">
    <a href="/" className="text-zinc-400 text-sm">← Volver</a>
    <h1 className="text-2xl font-bold mt-2">◈ Escenarios <span className="text-xs text-emerald-400 font-normal border border-emerald-900 rounded px-2 py-0.5 ml-2">FICHA ACTIVA</span> <span className="text-xs text-amber-400 font-normal border border-amber-900 rounded px-2 py-0.5 ml-1">RESTO MAQUETA</span></h1>
    <p className="text-xs text-zinc-500 mt-1">Escenarios para pantalla o proyección. Contexto para el modelo gestor y el narrador.</p>

    <div className="flex gap-1 mt-4 flex-wrap">
      {TABS.map(t => (
        <button key={t} onClick={() => setTab(t)}
          className={`text-xs rounded px-3 py-2 border ${tab === t ? "bg-white text-black font-semibold" : "bg-zinc-900 border-zinc-800"}`}>{t}</button>))}
    </div>

    {tab === "Ficha" && <Ficha />}

    {tab === "Partes" && (
      <section className="mt-4">
        <h2 className="font-bold text-sm">Partes y variaciones (reutilizables por el modelo)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
          {["suelo bosque", "río", "puente", "claro rúnico", "ladera", "cueva", "ruina", "camino"].map(p => (
            <Ph key={p} label={`parte · ${p}`} />))}
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          <Soon label="＋ Nueva parte" /><Soon label="Variaciones de parte" /><Soon label="Medidas por parte" />
        </div>
      </section>)}

    {tab === "Editor Tile" && (
      <section className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded p-3">
          <h2 className="font-bold text-sm">Canvas 12 × 8 (mock)</h2>
          <div className="grid grid-cols-12 gap-px mt-2 bg-zinc-800 border border-zinc-800">
            {Array.from({ length: 96 }).map((_, i) => (
              <div key={i} className={`aspect-square ${i % 7 === 0 ? "bg-emerald-900" : i % 5 === 0 ? "bg-sky-900" : "bg-zinc-900"}`} />))}
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
          <h2 className="font-bold text-sm">Presets del modelo</h2>
          <div className="grid gap-1 mt-2">
            {["bosque denso 12×8", "aldea + río", "mazmorra 3 niveles", "desierto + oasis"].map(p => (
              <Soon key={p} label={p} />))}
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <Soon label="Guardar preset" /><Soon label="Exportar mapa" />
          </div>
        </div>
      </section>)}

    {tab === "Montajes" && (
      <section className="mt-4">
        <h2 className="font-bold text-sm">Ejemplos de montaje: escenario + escenografía (de tu base) + minis</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
          {[1, 2, 3].map(i => (
            <div key={i}>
              <Ph label={`montaje ejemplo ${i}`} h="h-36" />
              <p className="text-xs text-zinc-500 mt-1">escenografía: — · minis: — (correlación futura)</p>
            </div>))}
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          <Soon label="Combinar PNGs" /><Soon label="Correlacionar minis" /><Soon label="Guardar montaje" />
        </div>
      </section>)}

    {tab === "Iluminación" && (
      <section className="mt-4">
        <h2 className="font-bold text-sm">Ejemplos de iluminación</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
          {["día", "atardecer", "noche + antorchas", "niebla + luna"].map(l => (
            <Ph key={l} label={l} />))}
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          <Soon label="Preset día/noche" /><Soon label="Enviar al proyector" />
        </div>
      </section>)}

    {tab === "Audio" && (
      <section className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded p-4">
          <h2 className="font-bold text-sm">Soundtrack del escenario</h2>
          <Ph label="player · bosque_noche.mp3" h="h-16" />
          <div className="flex gap-2 mt-2 flex-wrap">
            <Soon label="Subir soundtrack" /><Soon label="Por género" />
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded p-4">
          <h2 className="font-bold text-sm">Efectos por zona/género</h2>
          {["pasos en hojas", "agua", "ritual", "combate"].map(s => (
            <div key={s} className="flex items-center gap-2 mt-1">
              <span className="text-xs flex-1">{s}</span><Soon label="▶" /><Soon label="subir" />
            </div>))}
        </div>
      </section>)}

    {tab === "API" && (
      <section className="mt-4 bg-zinc-900 border border-zinc-800 rounded p-4">
        <h2 className="font-bold text-sm">Microservicios futuros (diseño modular)</h2>
        <ul className="text-xs text-zinc-400 mt-2 space-y-1 font-mono">
          <li>GET /api/scenarios — lista + filtros por género/tipo</li>
          <li>POST /api/scenarios — crear ficha (fases: ficha → partes → tile → audio)</li>
          <li>GET /api/scenarios/{"{id}"}/parts — partes y variaciones</li>
          <li>POST /api/scenarios/{"{id}"}/tile/presets — guardar preset del editor</li>
          <li>GET /api/scenarios/{"{id}"}/montajes — ejemplos con escenografía + minis</li>
          <li>POST /api/scenarios/{"{id}"}/project — enviar al proyector (fase, grid, luz)</li>
          <li>GET /api/scenarios/{"{id}"}/dataset — contexto para el narrador/DM</li>
        </ul>
        <p className="text-xs text-zinc-600 mt-2">Cada tarjeta de esta maqueta será un microservicio con su tabla. La DB se diseña sobre esta maqueta.</p>
      </section>)}
  </main>);
}
