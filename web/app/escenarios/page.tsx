"use client";
import { useEffect, useState } from "react";
import { toWebP } from "../../lib/optimize";

// Escenarios — Ficha funcional (fase 1); resto en maqueta hasta sus fases.
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TABS = ["Sheet", "Parts", "Tile Editor", "Mounts", "Lighting", "Audio", "API"];
const KINDS = ["fisico", "digital", "hibrido"];
const EMPTY_SCN = { name: "", kind: "fisico", width_cm: "", depth_cm: "", height_cm: "",
  tile_cm: "", palette: "", texture: "", uses: "", description: "", comments: "",
  url: "", genre: "", grid_cell_cm: "2.5", grid_color: "#22ff88", grid_opacity: "0.6" };

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
      comments: f.comments || null, url: f.url || null, genre: f.genre || null,
      grid_cell_cm: num(f.grid_cell_cm), grid_color: f.grid_color || null,
      grid_opacity: num(f.grid_opacity) };
  }
  function fromRec(s: any) {
    return { ...EMPTY_SCN, ...s, width_cm: s.width_cm ?? "", depth_cm: s.depth_cm ?? "",
      height_cm: s.height_cm ?? "", tile_cm: s.tile_cm ?? "",
      grid_cell_cm: s.grid_cell_cm ?? "2.5", grid_color: s.grid_color ?? "#22ff88",
      grid_opacity: s.grid_opacity ?? "0.6",
      palette: (s.palette || []).join(", "), uses: (s.uses || []).join(", ") };
  }
  async function save(e: any) {
    e.preventDefault();
    if (!form.name.trim()) { setMsg("Name is required."); return; }
    const url = editing && sel ? `${API}/api/scenarios/${sel.id}` : `${API}/api/scenarios`;
    const r = await fetch(url, { method: editing ? "PUT" : "POST", headers: H,
      body: JSON.stringify(toPayload(form)) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(String(j.detail || r.status)); return; }
    setForm(EMPTY_SCN); setEditing(false); setSel(j.id ? j : sel); setMsg(""); load();
  }
  async function remove(id: string) {
    if (!confirm("Delete scenario?")) return;
    const r = await fetch(`${API}/api/scenarios/${id}`, { method: "DELETE",
      headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (typeof j.cloudinary_deleted === "number" &&
        j.cloudinary_deleted < (j.cloudinary_expected ?? 0))
      alert(`Deleted, but Cloudinary cleanup did not complete (` +
            `${j.cloudinary_deleted}/${j.cloudinary_expected} files).`);
    setSel(null); load();
  }

  return (<section className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
    <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-sm">Scenarios ({items.length})</h2>
        <button onClick={() => { setForm(EMPTY_SCN); setEditing(false); setSel(null); }}
          className="text-xs bg-white text-black rounded px-2 py-1 font-semibold">＋ New</button>
      </div>
      <div className="mt-2 space-y-1 max-h-96 overflow-y-auto">
        {items.map(s => (
          <button key={s.id} onClick={() => { setSel(s); setForm(fromRec(s)); setEditing(true); }}
            className={`w-full text-left rounded px-2 py-1 text-sm border ${sel?.id === s.id ? "bg-zinc-800 border-zinc-600" : "border-transparent hover:bg-zinc-800"}`}>
            <span className="font-semibold">{s.name}</span>
            <span className="text-xs text-zinc-500 ml-2">{s.kind}{s.genre ? ` · ${s.genre}` : ""}</span>
          </button>))}
        {items.length === 0 && <p className="text-xs text-zinc-500">No scenarios. Create the first one →</p>}
      </div>
      {msg && <p className="text-xs text-amber-400 mt-2">{msg}</p>}
    </div>
    <form onSubmit={save} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded p-4">
      <h2 className="font-bold text-sm">{editing && sel ? `Edit: ${sel.name}` : "New scenario sheet"}</h2>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <div className="col-span-2"><label className={lbl}>Name *</label>
          <input className={inp} value={form.name} onChange={set("name")} placeholder="Elven Forest — central clearing" /></div>
        <div><label className={lbl}>Type</label>
          <select className={inp} value={form.kind} onChange={set("kind")}>
            {KINDS.map(k => <option key={k} value={k}>{k === "fisico" ? "physical" : k === "digital" ? "digital" : "hybrid"}</option>)}</select></div>
        <div><label className={lbl}>Genre</label>
          <input className={inp} value={form.genre} onChange={set("genre")} placeholder="fantasy, horror…" /></div>
        <div><label className={lbl}>Width cm</label>
          <input type="number" step="any" className={inp} value={form.width_cm} onChange={set("width_cm")} /></div>
        <div><label className={lbl}>Depth cm</label>
          <input type="number" step="any" className={inp} value={form.depth_cm} onChange={set("depth_cm")} /></div>
        <div><label className={lbl}>Height cm</label>
          <input type="number" step="any" className={inp} value={form.height_cm} onChange={set("height_cm")} /></div>
        <div><label className={lbl}>Tile cm (quantity, decimals)</label>
          <input type="number" step="any" className={inp} value={form.tile_cm} onChange={set("tile_cm")} /></div>
        <div><label className={lbl}>Grid: cell cm (decimals)</label>
          <input type="number" step="any" className={inp} value={form.grid_cell_cm} onChange={set("grid_cell_cm")} /></div>
        <div><label className={lbl}>Grid: color</label>
          <input type="color" className={`${inp} h-10 cursor-pointer`} value={form.grid_color} onChange={set("grid_color")} /></div>
        <div><label className={lbl}>Grid: opacity</label>
          <input type="number" step="any" min="0" max="1" className={inp} value={form.grid_opacity} onChange={set("grid_opacity")} /></div>
        <div className="col-span-2"><label className={lbl}>Colors (comma)</label>
          <input className={inp} value={form.palette} onChange={set("palette")} placeholder="green, brown, fog" /></div>
        <div className="col-span-2"><label className={lbl}>Texture</label>
          <input className={inp} value={form.texture} onChange={set("texture")} placeholder="moss, bark, stone" /></div>
        <div className="col-span-2"><label className={lbl}>Possible uses (comma)</label>
          <input className={inp} value={form.uses} onChange={set("uses")} placeholder="ambush, ritual, rest" /></div>
        <div className="col-span-2"><label className={lbl}>Description (narrator context)</label>
          <textarea className={inp} rows={3} value={form.description} onChange={set("description")} /></div>
        <div className="col-span-2"><label className={lbl}>Comments</label>
          <input className={inp} value={form.comments} onChange={set("comments")} /></div>
        <div className="col-span-2"><label className={lbl}>Reference URL</label>
          <input className={inp} value={form.url} onChange={set("url")} /></div>
      </div>
      <div className="flex gap-2 mt-3">
        <button type="submit" className="bg-white text-black rounded px-4 py-2 text-sm font-semibold">Save</button>
        {editing && sel && (
          <button type="button" onClick={() => remove(sel.id)}
            className="bg-red-950 border border-red-900 rounded px-4 py-2 text-sm">Delete</button>)}
      </div>
    </form>
    {editing && sel && (
      <div className="md:col-span-3 mt-1">
        <h3 className="text-sm font-bold">Location: cover, art and reference render (Cloudinary + 💾 Drive)</h3>
        <AssetStrip sid={sel.id} kinds={["cover", "art", "render_3d"]} />
      </div>)}
  </section>);
}

function Soon({ label }: { label: string }) {
  const [n, setN] = useState(0);
  return (<button onClick={() => setN(n + 1)}
    className="text-xs bg-zinc-800 border border-zinc-700 rounded px-3 py-2 hover:border-emerald-400">
    {label}{n > 0 && <span className="text-amber-400"> · coming soon ({n})</span>}
  </button>);
}

function Ph({ label, h = "h-24" }: { label: string; h?: string }) {
  return (<div className={`bg-zinc-900 border border-dashed border-zinc-700 rounded flex items-center justify-center ${h}`}>
    <span className="text-xs text-zinc-600">{label} · placeholder</span>
  </div>);
}

function useToken() {
  try {
    return JSON.parse(localStorage.getItem("mb_session") || "{}").access_token || "";
  } catch { return ""; }
}

// Subida: optimiza a WebP en el navegador -> firma backend -> Cloudinary directo -> registra asset.
// kind: cover|part|montaje|light|art|render_3d|audio_cover
async function uploadAsset(api: string, token: string, scenarioId: string,
    kind: string, label: string, raw: File, onMsg: (m: string) => void) {
  // Paso previo de optimización: convierte a WebP (calidad 0.9) para almacenar menos
  // bytes en Cloudinary; si no se puede convertir, sube el archivo original.
  onMsg("Optimizing to WebP…");
  const file = await toWebP(raw);
  onMsg("Signing…");
  const H: any = { Authorization: `Bearer ${token}` };
  const s = await (await fetch(`${api}/api/scn/assets/sign`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ scenario_id: scenarioId, kind, label }),
  })).json();
  if (!s.upload_url) throw new Error(s.detail || "sign failed (migration 007?)");
  onMsg("Uploading to Cloudinary…");
  const fd = new FormData();
  fd.append("file", file);
  fd.append("api_key", s.api_key);
  fd.append("timestamp", String(s.timestamp));
  fd.append("public_id", s.public_id);
  fd.append("folder", s.folder);
  fd.append("eager", s.eager);
  if (s.transformation) fd.append("transformation", s.transformation);
  fd.append("signature", s.signature);
  const up = await (await fetch(s.upload_url, { method: "POST", body: fd })).json();
  if (up.error) throw new Error(up.error.message);
  const webp = (up.eager && up.eager[0] && up.eager[0].secure_url) || up.secure_url;
  onMsg("Saving…");
  const c = await fetch(`${api}/api/scn/assets/complete`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ scenario_id: scenarioId, kind, label,
      cloudinary_public_id: up.public_id, secure_url: webp,
      mime_type: "image/webp", file_size: file.size, width: up.width, height: up.height }),
  });
  const cj = await c.json();
  if (!c.ok) throw new Error(cj.detail || c.status);
  onMsg("");
  return cj;
}

function AssetStrip({ sid, kinds }: { sid: string; kinds: string[] }) {
  const API2 = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const [items, setItems] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [drive, setDrive] = useState("");
  const token = useToken();
  async function load() {
    const r = await fetch(`${API2}/api/scn/assets?scenario_id=${sid}`,
      { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setItems((j.items || []).filter((a: any) => kinds.includes(a.kind)));
    else if (r.status === 409) setMsg("Run migration 007 in Supabase.");
  }
  useEffect(() => { if (sid) load(); }, [sid]);
  async function up(e: any, kind: string) {
    const f = e.target.files?.[0];
    if (!f) return;
    try { await uploadAsset(API2, token, sid, kind, f.name.replace(/\.\w+$/, ""), f, setMsg); load(); }
    catch (err: any) { setMsg(String(err.message || err)); }
    finally { e.target.value = ""; }
  }
  async function del(id: string) {
    if (!confirm("Delete image?")) return;
    const r = await fetch(`${API2}/api/scn/assets/${id}`, { method: "DELETE",
      headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (j.cloudinary_deleted && !["ok", "not found"].includes(j.cloudinary_deleted))
      setMsg(`Cloudinary cleanup: ${j.cloudinary_deleted} (el archivo puede seguir en el cloud)`);
    load();
  }
  async function backup(id: string) {
    if (!drive) return;
    await fetch(`${API2}/api/scn/assets/backup`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image_id: id, backup_url: drive }) });
    setDrive(""); load();
  }
  return (<div className="mt-2">
    <div className="grid grid-cols-3 md:grid-cols-5 gap-1">
      {items.map(a => (
        <div key={a.id} className="relative group">
          <a href={a.secure_url} target="_blank" rel="noreferrer">
            <img src={a.secure_url} alt={a.label} loading="lazy"
              className="w-full aspect-square object-cover rounded bg-zinc-800" /></a>
          <span className="absolute bottom-1 left-1 text-[10px] bg-black/70 rounded px-1">
            {a.kind}:{a.label}{a.backup_url ? " 💾" : ""}</span>
          <button onClick={() => del(a.id)}
            className="absolute top-1 right-1 text-[10px] bg-red-950/90 rounded px-1 hidden group-hover:block">✕</button>
        </div>))}
    </div>
    <div className="flex gap-1 mt-1 flex-wrap items-center">
      {kinds.map(k => (
        <label key={k} className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 cursor-pointer">
          📷 {k}<input type="file" accept="image/*" className="hidden" onChange={e => up(e, k)} /></label>))}
      <input value={drive} onChange={e => setDrive(e.target.value)} placeholder="Drive link → 💾 latest"
        className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs flex-1 min-w-[140px]" />
      <button onClick={() => items.length && backup(items[items.length - 1].id)}
        className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1">💾</button>
    </div>
    {msg && <p className="text-xs text-amber-400 mt-1">{msg}</p>}
  </div>);
}

const API3 = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function PartsTab({ sid }: { sid: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("suelo");
  const [msg, setMsg] = useState("");
  const token = useToken();
  const H: any = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const inp = "bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs w-full";
  async function load() {
    const r = await fetch(`${API3}/api/scn/parts?scenario_id=${sid}`, {
      headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setItems(j.items ?? []); else setMsg(j.detail || "");
  }
  useEffect(() => { load(); }, [sid]);
  async function add() {
    if (!name.trim()) return;
    const r = await fetch(`${API3}/api/scn/parts`, { method: "POST", headers: H,
      body: JSON.stringify({ scenario_id: sid, name: name.trim(), kind }) });
    if (r.ok) { setName(""); load(); } else setMsg((await r.json()).detail || r.status);
  }
  async function del(id: string) {
    if (!confirm("Delete part?")) return;
    await fetch(`${API3}/api/scn/parts/${id}`, { method: "DELETE",
      headers: { Authorization: `Bearer ${token}` } });
    load();
  }
  return (<section className="mt-4">
    <h2 className="font-bold text-sm">Reusable parts (the model builds maps with these)</h2>
    <AssetStrip sid={sid} kinds={["part", "art", "render_3d"]} />
    <div className="flex gap-1 mt-2">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="forest floor…"
        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs flex-1" />
      <select value={kind} onChange={e => setKind(e.target.value)}
        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs">
        {[["suelo","floor"],["rio","river"],["puente","bridge"],["claro","clearing"],["ladera","hillside"],["cueva","cave"],["ruina","ruin"],["camino","road"],["muro","wall"],["agua","water"]].map(([v,l]) => (
          <option key={v} value={v}>{l}</option>))}</select>
      <button onClick={add} className="text-xs bg-white text-black rounded px-3 py-1 font-semibold">＋</button>
    </div>
    {msg && <p className="text-xs text-amber-400 mt-1">{msg}</p>}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-1 mt-2">
      {items.map(p => (
        <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs">
          <span className="font-semibold">{p.name}</span>
          <span className="text-zinc-500 ml-1">· {p.kind}</span>
          <button onClick={() => del(p.id)} className="ml-2 text-red-400">✕</button>
        </div>))}
    </div>
  </section>);
}

function TilesTab({ sid }: { sid: string }) {
  const [presets, setPresets] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [cols, setCols] = useState(12);
  const [rowsN, setRowsN] = useState(8);
  const [grid, setGrid] = useState<number[]>(() => Array(96).fill(0));
  const [brush, setBrush] = useState(1);
  const [msg, setMsg] = useState("");
  const token = useToken();
  const COLORS = ["#09090b", "#22ff88", "#38bdf8", "#a16207", "#78716c"];
  async function load() {
    const r = await fetch(`${API3}/api/scn/tiles?scenario_id=${sid}`, {
      headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setPresets(j.items ?? []); else setMsg(j.detail || "");
  }
  useEffect(() => { setGrid(Array(cols * rowsN).fill(0)); }, [cols, rowsN]);
  useEffect(() => { load(); }, [sid]);
  function paint(i: number) {
    const g = [...grid]; g[i] = brush; setGrid(g);
  }
  async function save() {
    if (!name.trim()) { setMsg("Name the preset."); return; }
    const r = await fetch(`${API3}/api/scn/tiles`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_id: sid, name: name.trim(), cols, rows: rowsN, grid }) });
    if (r.ok) { setName(""); load(); } else setMsg((await r.json()).detail || r.status);
  }
  function openPreset(p: any) {
    setCols(p.cols); setRowsN(p.rows); setGrid(p.grid || []); setName(p.name);
  }
  return (<section className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
    <div className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded p-3">
      <h2 className="font-bold text-sm">Canvas {cols}×{rowsN} (click paints, the projector grid respects it)</h2>
      <div className="grid gap-px mt-2 bg-zinc-800 border border-zinc-800" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {grid.map((v, i) => (
          <div key={i} onClick={() => paint(i)} className="aspect-square cursor-pointer"
            style={{ background: COLORS[v] || "#09090b" }} />))}
      </div>
      <div className="flex gap-1 mt-2 items-center flex-wrap">
        {COLORS.map((c, i) => (
          <button key={c} onClick={() => setBrush(i)} className={`w-6 h-6 rounded border ${brush === i ? "border-white" : "border-zinc-700"}`} style={{ background: c }} />))}
        <input type="number" value={cols} min={1} max={40} onChange={e => setCols(Number(e.target.value))}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs w-16" />
        <span className="text-xs">×</span>
        <input type="number" value={rowsN} min={1} max={40} onChange={e => setRowsN(Number(e.target.value))}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs w-16" />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="preset name"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs flex-1" />
        <button onClick={save} className="text-xs bg-white text-black rounded px-3 py-1 font-semibold">Save</button>
      </div>
      {msg && <p className="text-xs text-amber-400 mt-1">{msg}</p>}
    </div>
    <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
      <h2 className="font-bold text-sm">Model presets ({presets.length})</h2>
      <div className="grid gap-1 mt-2">
        {presets.map(p => (
          <div key={p.id} className="flex gap-1 items-center">
            <button onClick={() => openPreset(p)} className="flex-1 text-left text-xs bg-zinc-950 border border-zinc-800 rounded px-2 py-1">
              {p.name} <span className="text-zinc-500">({p.cols}×{p.rows})</span></button>
            <button onClick={async () => {
              if (!confirm("Delete preset?")) return;
              await fetch(`${API3}/api/scn/tiles/${p.id}`, { method: "DELETE",
                headers: { Authorization: `Bearer ${token}` } });
              load();
            }} className="text-xs text-red-400">✕</button>
          </div>))}
      </div>
    </div>
  </section>);
}

function MountsTab({ sid }: { sid: string }) {
  const [mounts, setMounts] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [selMount, setSelMount] = useState<any>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const token = useToken();
  const H: any = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  async function load() {
    const r = await fetch(`${API3}/api/scn/mounts?scenario_id=${sid}`, {
      headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setMounts(j.items ?? []);
      if (selMount) {
        const upd = (j.items || []).find((m: any) => m.id === selMount.id);
        if (upd) setSelMount(upd);
      }
    } else setMsg(j.detail || "");
  }
  useEffect(() => { load(); }, [sid]);
  async function addMount() {
    if (!name.trim()) return;
    const r = await fetch(`${API3}/api/scn/mounts`, { method: "POST", headers: H,
      body: JSON.stringify({ scenario_id: sid, name: name.trim() }) });
    if (r.ok) { setName(""); load(); }
  }
  async function searchMinis() {
    const r = await fetch(`${API3}/api/scn/minis?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setFound(j.items ?? []);
  }
  async function addItem(kind: string, ref: any) {
    if (!selMount) return;
    await fetch(`${API3}/api/scn/mounts/${selMount.id}/items`, { method: "POST", headers: H,
      body: JSON.stringify({ kind, ref_id: ref?.id || null,
        x: (selMount.items?.length || 0) % 4, y: Math.floor((selMount.items?.length || 0) / 4) }) });
    load();
  }
  async function delItem(iid: string) {
    await fetch(`${API3}/api/scn/mounts/items/${iid}`, { method: "DELETE",
      headers: { Authorization: `Bearer ${token}` } });
    load();
  }
  async function combine() {
    if (!selMount) return;
    setMsg("Composing PNG…");
    const r = await fetch(`${API3}/api/scn/mounts/${selMount.id}/combine`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setMsg(""); load(); } else setMsg(String(j.detail || r.status));
  }
  return (<section className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
    <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
      <h2 className="font-bold text-sm">Mounts</h2>
      <div className="flex gap-1 mt-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="north ambush…"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs flex-1" />
        <button onClick={addMount} className="text-xs bg-white text-black rounded px-2 py-1 font-semibold">＋</button>
      </div>
      <div className="mt-2 space-y-1">
        {mounts.map(m => (
          <button key={m.id} onClick={() => setSelMount(m)}
            className={`w-full text-left text-xs rounded px-2 py-1 border ${selMount?.id === m.id ? "bg-zinc-800 border-zinc-600" : "border-transparent hover:bg-zinc-800"}`}>
            <span className="font-semibold">{m.name}</span>
            <span className="text-zinc-500 ml-1">{(m.items || []).length} pieces</span>
            {m.composed_url && <span className="text-emerald-400 ml-1">· PNG ✓</span>}
          </button>))}
      </div>
      {msg && <p className="text-xs text-amber-400 mt-1">{msg}</p>}
    </div>
    <div className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded p-3">
      {!selMount ? <p className="text-xs text-zinc-500">Pick a mount ←</p> : (<>
        <h2 className="font-bold text-sm">{selMount.name}</h2>
        {selMount.composed_url && (
          <a href={selMount.composed_url} target="_blank" rel="noreferrer">
            <img src={selMount.composed_url} alt="compuesto" className="rounded mt-2 max-h-64 object-contain bg-black" /></a>)}
        <div className="flex gap-1 mt-2">
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && searchMinis()}
            placeholder="search mini/scenery in your collection…"
            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs flex-1" />
          <button onClick={searchMinis} className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1">Search</button>
        </div>
        <div className="grid grid-cols-2 gap-1 mt-1 max-h-32 overflow-y-auto">
          {found.map((m: any) => (
            <button key={m.id} onClick={() => addItem(m.type === "scenery" ? "scenery" : "mini", m)}
              className="text-left text-xs bg-zinc-950 border border-zinc-800 rounded px-2 py-1">＋ {m.name} <span className="text-zinc-500">({m.type})</span></button>))}
        </div>
        <p className="text-xs text-zinc-500 mt-2">Pieces ({(selMount.items || []).length}):</p>
        <div className="flex gap-1 flex-wrap mt-1">
          {(selMount.items || []).map((it: any) => (
            <span key={it.id} className="text-xs bg-zinc-950 border border-zinc-800 rounded px-2 py-1">
              {it.kind} · ({it.x},{it.y}) <button onClick={() => delItem(it.id)} className="text-red-400 ml-1">✕</button></span>))}
        </div>
        <button onClick={combine} className="mt-2 text-xs bg-emerald-400 text-black rounded px-3 py-1 font-semibold">◈ Combine PNGs</button>
      </>)}
    </div>
  </section>);
}

function LightTab({ sid }: { sid: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [mood, setMood] = useState("dia");
  const [msg, setMsg] = useState("");
  const token = useToken();
  async function load() {
    const r = await fetch(`${API3}/api/scn/lighting?scenario_id=${sid}`, {
      headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setItems(j.items ?? []); else setMsg(j.detail || "");
  }
  useEffect(() => { load(); }, [sid]);
  async function add() {
    if (!name.trim()) return;
    const payload = mood === "dia" ? { brightness: 1 } : mood === "atardecer" ?
      { brightness: 0.7, tint: "#ff9a3c" } : mood === "noche" ?
      { brightness: 0.3, tint: "#1e3a8a", torches: true } :
      { brightness: 0.5, tint: "#a5b4fc", fog: true };
    const r = await fetch(`${API3}/api/scn/lighting`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_id: sid, name: name.trim(), mood,
        params: payload, projector_payload: { mood, ...payload } }) });
    if (r.ok) { setName(""); load(); }
  }
  return (<section className="mt-4">
    <h2 className="font-bold text-sm">Lighting (presets the projector uses)</h2>
    <AssetStrip sid={sid} kinds={["light"]} />
    <div className="flex gap-1 mt-2">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="night + torches…"
        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs flex-1" />
      <select value={mood} onChange={e => setMood(e.target.value)}
        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs">
        {[["dia","day"],["atardecer","sunset"],["noche","night"],["niebla","fog"],["custom","custom"]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
      <button onClick={add} className="text-xs bg-white text-black rounded px-3 py-1 font-semibold">＋</button>
    </div>
    {msg && <p className="text-xs text-amber-400 mt-1">{msg}</p>}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-1 mt-2">
      {items.map((l: any) => (
        <div key={l.id} className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs">
          <span className="font-semibold">{l.name}</span>
          <span className="text-zinc-500 ml-1">· {l.mood}</span>
          <button onClick={async () => {
            await fetch(`${API3}/api/scn/lighting/${l.id}`, { method: "DELETE",
              headers: { Authorization: `Bearer ${token}` } });
            load();
          }} className="ml-2 text-red-400">✕</button>
        </div>))}
    </div>
  </section>);
}

function AudioTab({ sid }: { sid: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("soundtrack");
  const [genre, setGenre] = useState("");
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  const token = useToken();
  async function load() {
    const r = await fetch(`${API3}/api/scn/audios?scenario_id=${sid}`, {
      headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setItems(j.items ?? []); else setMsg(j.detail || "");
  }
  useEffect(() => { load(); }, [sid]);
  async function add() {
    if (!title.trim()) return;
    const r = await fetch(`${API3}/api/scn/audios`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_id: sid, kind, genre: genre || null,
        title: title.trim(), url: url || null }) });
    if (r.ok) { setTitle(""); setUrl(""); load(); }
  }
  const sts = items.filter((a: any) => a.kind === "soundtrack");
  const sfx = items.filter((a: any) => a.kind === "sfx");
  return (<section className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
    <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
      <h2 className="font-bold text-sm">Soundtracks ({sts.length})</h2>
      {sts.map((a: any) => (
        <div key={a.id} className="mt-1">
          <p className="text-xs font-semibold">{a.title} {a.genre && <span className="text-zinc-500">· {a.genre}</span>}</p>
          {a.url && <audio controls src={a.url} className="w-full h-8 mt-1" />}
        </div>))}
      {sts.length === 0 && <p className="text-xs text-zinc-500 mt-1">No soundtracks.</p>}
    </div>
    <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
      <h2 className="font-bold text-sm">Effects ({sfx.length})</h2>
      {sfx.map((a: any) => (
        <div key={a.id} className="flex items-center gap-2 mt-1">
          <span className="text-xs flex-1">{a.title} {a.zone && <span className="text-zinc-500">· {a.zone}</span>}</span>
          {a.url && <audio controls src={a.url} className="h-8 w-32" />}
        </div>))}
      {sfx.length === 0 && <p className="text-xs text-zinc-500 mt-1">No effects.</p>}
    </div>
    <div className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded p-3">
      <h2 className="font-bold text-sm">＋ Add (paste a Drive/Cloudinary URL or upload it as an asset and paste the link)</h2>
      <div className="flex gap-1 mt-2 flex-wrap">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="title"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs flex-1" />
        <select value={kind} onChange={e => setKind(e.target.value)}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs">
          <option value="soundtrack">soundtrack</option><option value="sfx">sfx</option></select>
        <input value={genre} onChange={e => setGenre(e.target.value)} placeholder="genre"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs" />
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…mp3"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs flex-1" />
        <button onClick={add} className="text-xs bg-white text-black rounded px-3 py-1 font-semibold">Save</button>
      </div>
      {msg && <p className="text-xs text-amber-400 mt-1">{msg}</p>}
    </div>
  </section>);
}

export default function Escenarios() {
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState("Sheet");
  const [scns, setScns] = useState<any[]>([]);
  const [selId, setSelId] = useState("");
  const API4 = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mb_session");
      const t = raw ? JSON.parse(raw)?.access_token : "";
      if (!t) { location.href = "/"; return; }
      setOk(true);
      fetch(`${API4}/api/scenarios`, { headers: { Authorization: `Bearer ${t}` } })
        .then(r => r.json()).then(j => {
          const items = j.items ?? [];
          setScns(items);
          if (items.length && !selId) setSelId(items[0].id);
        }).catch(() => {});
    } catch { location.href = "/"; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ok) return (<main className="p-6"><p className="text-zinc-500 text-sm">Checking access…</p></main>);

  return (<main className="p-6 max-w-6xl mx-auto">
    <a href="/" className="text-zinc-400 text-sm">← Back</a>
    <h1 className="text-2xl font-bold mt-2">◈ Scenarios <span className="text-xs text-emerald-400 font-normal border border-emerald-900 rounded px-2 py-0.5 ml-2">ACTIVE MODULES</span> <a href="/proyector" className="text-xs bg-white text-black rounded px-2 py-1 ml-2 font-semibold">◉ Projector</a></h1>
    <p className="text-xs text-zinc-500 mt-1">Scenarios for screen or projection. Context for the manager model and the narrator.</p>

    <div className="flex gap-1 mt-4 flex-wrap items-center">
      {TABS.map(t => (
        <button key={t} onClick={() => setTab(t)}
          className={`text-xs rounded px-3 py-2 border ${tab === t ? "bg-white text-black font-semibold" : "bg-zinc-900 border-zinc-800"}`}>{t}</button>))}
    </div>
    {tab !== "Sheet" && (
      <div className="mt-2 flex gap-2 items-center">
        <span className="text-xs text-zinc-400">Scenario:</span>
        <select value={selId} onChange={e => setSelId(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs">
          <option value="">— pick —</option>
          {scns.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>)}

    {tab === "Sheet" && <Ficha />}

    {tab === "Parts" && (selId
      ? <PartsTab sid={selId} />
      : <p className="text-xs text-zinc-500 mt-4">Create a scenario in Sheet first ↑</p>)}

    {tab === "Tile Editor" && (selId
      ? <TilesTab sid={selId} />
      : <p className="text-xs text-zinc-500 mt-4">Create a scenario in Sheet first ↑</p>)}

    {tab === "Mounts" && (selId
      ? <MountsTab sid={selId} />
      : <p className="text-xs text-zinc-500 mt-4">Create a scenario in Sheet first ↑</p>)}

    {tab === "Lighting" && (selId
      ? <LightTab sid={selId} />
      : <p className="text-xs text-zinc-500 mt-4">Create a scenario in Sheet first ↑</p>)}

    {tab === "Audio" && (selId
      ? <AudioTab sid={selId} />
      : <p className="text-xs text-zinc-500 mt-4">Create a scenario in Sheet first ↑</p>)}

    {tab === "API" && (
      <section className="mt-4 bg-zinc-900 border border-zinc-800 rounded p-4">
        <h2 className="font-bold text-sm">Active modules (modular design)</h2>
        <ul className="text-xs text-zinc-400 mt-2 space-y-1 font-mono">
          <li>✓ /api/scenarios — sheet CRUD + {"{id}"}/dataset narrator</li>
          <li>✓ /api/scn/parts — reusable parts</li>
          <li>✓ /api/scn/tiles — tile presets (grid JSONB)</li>
          <li>✓ /api/scn/mounts — mounts + items + combine PNG</li>
          <li>✓ /api/scn/lighting — light presets + projector_payload</li>
          <li>✓ /api/scn/audios — soundtracks + sfx (metadata)</li>
          <li>✓ /api/scn/assets — Cloudinary photos + Drive backup</li>
          <li>· /api/scn/mounts/{"{id}"}/project — to projector (next)</li>
        </ul>
      </section>)}
  </main>);
}
