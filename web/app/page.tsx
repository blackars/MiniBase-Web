"use client";
import { useEffect, useState } from "react";
import { supabase, hasSupabase, SUPABASE_URL, SUPABASE_KEY } from "../lib/supabase";
import { toWebP } from "../lib/optimize";

// Login manual por REST (sin GoTrue): el wrapper JS de auth rompe `fetch` en este
// entorno, pero el endpoint /auth/v1 responde bien. Sesión en localStorage.
async function restLogin(email: string, password: string, mode: "in" | "up") {
  const path = mode === "in" ? "token?grant_type=password" : "signup";
  const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: j };
}
async function restMe(accessToken: string) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, user: j };
}
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const EMPTY = { name: "", type: "mini", quantity: 1, shape: "", bioform: "", material: "", main_color: "", secondary_color: "", weight_g: "", height_mm: "", radius_of_base_mm: "", diameter_mm: "", scale: "28mm", tags: "", designer: "", painted_by: "", label: "", lore_is_canon: "", story: "", comment: "", character_origin: "", year: "", code_or_reference: "", url: "", system: "", faction: "",
  size_category: "", paint_status: "", aliases: "", grid_cells: 1, role: "", play_count: 0, is_favorite: "" };
const TYPES = ["mini", "scenery", "token", "tile", "prop"];
const SIZE_CATEGORIES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const PAINT_STATES = ["sin_pintar", "base", "avanzado", "terminada"];
const FILTER_FIELDS = [
  { k: "main_color", label: "Main color" }, { k: "secondary_color", label: "Secondary color" },
  { k: "bioform", label: "Bioform" }, { k: "material", label: "Material" },
  { k: "height_mm", label: "Height mm" }, { k: "radius_of_base_mm", label: "Base mm" },
  { k: "diameter_mm", label: "Diameter mm" },
  { k: "size_category", label: "Size" }, { k: "paint_status", label: "Painted" },
  { k: "designer", label: "Designer" }, { k: "painted_by", label: "Painter" },
  { k: "label", label: "Brand/stamp" }, { k: "character_origin", label: "Origin" },
  { k: "year", label: "Year" },
];

function errText(j: any, status: number) {
  const d = j?.detail;
  if (typeof d === "string" && d) return d;
  if (Array.isArray(d) && d.length)
    return d.map((e: any) => `${(e.loc || []).join(".")}: ${e.msg}`).join(" | ");
  if (d && typeof d === "object") return JSON.stringify(d);
  return String(status);
}
function canonTag(s: string) {
  const c = s.replace(/\s+/g, " ").trim();
  if (!c) return "";
  return c.split(" ").map(w => {
    if (w === w.toUpperCase() && w.length <= 4) return w;
    if (w.includes("-")) return w.split("-").map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("-");
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}

function toPayload(f: any) {
  const num = (v: any) => (v === "" || v == null ? null : Number(v));
  const tags: string[] = [];
  for (const t of String(f.tags || "").split(",")) {
    const c = canonTag(t);
    if (c && !tags.includes(c)) tags.push(c);
  }
  const aliases: string[] = [];
  for (const a of String(f.aliases || "").split(",")) {
    const c = a.trim();
    if (c && !aliases.includes(c)) aliases.push(c);
  }
  return { collection_id: "default", name: f.name, type: f.type, quantity: Number(f.quantity) || 1,
    shape: f.shape || null, bioform: f.bioform || null, material: f.material || null,
    main_color: f.main_color || null, secondary_color: f.secondary_color || null,
    weight_g: num(f.weight_g), height_mm: num(f.height_mm), radius_of_base_mm: num(f.radius_of_base_mm),
    diameter_mm: num(f.diameter_mm),
    scale: f.scale || "28mm", tags,
    designer: f.designer || null, painted_by: f.painted_by || null, story: f.story || null,
    comment: f.comment || null,
    label: f.label || null, lore_is_canon: f.lore_is_canon === "" ? null : f.lore_is_canon === "true",
    character_origin: f.character_origin || null, year: f.year || null,
    code_or_reference: f.code_or_reference || null, url: f.url || null,
    system: f.system || null, faction: f.faction || null, stats: {},
    size_category: f.size_category || null, paint_status: f.paint_status || null, aliases,
    grid_cells: Number(f.grid_cells) || 1, role: f.role || null,
    play_count: Number(f.play_count) || 0,
    is_favorite: f.is_favorite === "" ? null : f.is_favorite === "true" };
}
function fromRec(m: any) {
  return { ...EMPTY, ...m, tags: Array.isArray(m.tags) ? m.tags.join(", ") : (m.tags || ""),
    aliases: Array.isArray(m.aliases) ? m.aliases.join(", ") : (m.aliases || ""),
    lore_is_canon: m.lore_is_canon == null ? "" : String(m.lore_is_canon),
    is_favorite: m.is_favorite == null ? "" : String(m.is_favorite),
    grid_cells: m.grid_cells ?? 1, play_count: m.play_count ?? 0,
    weight_g: m.weight_g ?? "", height_mm: m.height_mm ?? "", radius_of_base_mm: m.radius_of_base_mm ?? "", diameter_mm: m.diameter_mm ?? "" };
}

// Vistas por roles: photo = entrena CV / reference = NO entrena (solo rastrear fuente)
const PHOTO_VIEWS = ["frontal", "black_background", "white_background", "lateral_1", "lateral_2",
  "back_view", "top_view", "bottom_view", "close_up", "isometric", "other"];
const REF_VIEWS = ["render_3d", "concept_art", "paint_reference"];

// Logo MiniBase (web/public/logo.webp, convertido del PNG con ffmpeg).
function Logo() {
  return (<img src="/logo.webp" width="34" height="34" alt="MiniBase" />);
}

function Gallery({ mini, token, api }: { mini: any; token: string; api: string }) {  const [gal, setGal] = useState<any>(null);
  const [view, setView] = useState("frontal");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [drive, setDrive] = useState("");
  const H = { Authorization: `Bearer ${token}` };

  async function load() {
    try {
      const r = await fetch(`${api}/api/images/by-mini/${mini.id}`, { headers: H });
      if (r.ok) setGal(await r.json());
    } catch {}
  }
  useEffect(() => { load(); }, [mini.id]);

  async function upload(e: any) {
    const raw = e.target.files?.[0];
    if (!raw) return;
    if (raw.size > 10 * 1024 * 1024) { setMsg("Max 10MB per photo."); return; }
    setBusy(true);
    // Paso previo de optimización: convierte a WebP (calidad 0.9) antes de subir
    // para que Cloudinary almacene y sincronice menos bytes cada foto.
    setMsg("Optimizing to WebP…");
    const f = await toWebP(raw);
    if (f.size > 10 * 1024 * 1024) { setBusy(false); setMsg("Max 10MB per photo."); return; }
    setMsg("Signing…");
    try {
      // 1. Firma (el backend genera derivados WebP vía eager)
      const s = await (await fetch(
        `${api}/api/minis/${mini.id}/images/sign?view_type=${view}&collection=default&slug=${mini.slug || "mini"}&user=me`,
        { method: "POST", headers: H })).json();
      if (s.demo) throw new Error("Cloudinary sin configurar");
      // 2. Subida directa navegador → Cloudinary
      setMsg("Uploading…");
      const fd = new FormData();
      fd.append("file", f);
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
      // 3. Registrar en MiniBase (WebP como canonical)
      setMsg("Saving…");
      const c = await fetch(`${api}/api/images/complete`, {
        method: "POST", headers: { ...H, "Content-Type": "application/json" },
        body: JSON.stringify({
          miniature_id: mini.id, view_type: view,
          cloudinary_public_id: up.public_id, secure_url: webp,
          mime_type: "image/webp", file_size: f.size,
          width: up.width, height: up.height,
        }),
      });
      const cj = await c.json();
      if (!c.ok) throw new Error(cj.detail || c.status);
      setMsg(""); load();
    } catch (err: any) {
      let m = String(err?.message || err);
      if (m.includes("missing permissions"))
        m += " → In Cloudinary: Settings → API Keys → your key → enable the Upload permission, save and retry.";
      setMsg(m);
    }
    finally { setBusy(false); e.target.value = ""; }
  }

  async function del(id: string) {
    if (!confirm("Delete this image?")) return;
    const r = await fetch(`${api}/api/images/${id}`, { method: "DELETE", headers: H });
    const j = await r.json().catch(() => ({}));
    if (j.cloudinary_deleted && !["ok", "not found"].includes(j.cloudinary_deleted))
      setMsg(`Cloudinary cleanup: ${j.cloudinary_deleted} (el archivo puede seguir en el cloud)`);
    load();
  }
  async function attachBackup(id: string) {
    if (!drive) return;
    await fetch(`${api}/api/images/backup`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ image_id: id, backup_url: drive }),
    });
    setDrive(""); load();
  }

  function thumb(img: any) {
    return (<div key={img.id} className="relative group">
      <a href={img.secure_url} target="_blank" rel="noreferrer">
        <img src={img.secure_url} alt={img.view_type} className="w-full aspect-square object-cover rounded bg-zinc-800" loading="lazy" />
      </a>
      <span className="absolute top-1 left-1 text-[10px] bg-black/70 rounded px-1">{img.view_type}{img.backup_url ? " 💾" : ""}</span>
      <button onClick={() => del(img.id)} className="absolute top-1 right-1 text-[10px] bg-red-950/90 rounded px-1 hidden group-hover:block">✕</button>
    </div>);
  }

  if (!gal) return (<p className="text-xs text-zinc-500 mt-3">Loading gallery…</p>);
  return (<div className="mt-3">
    <div className="flex items-center gap-2">
      <span className="text-xs font-bold">Photos {gal.photos.length}/13 {gal.cv_ready ? <span className="text-emerald-400">· CV-ready ✓</span> : <span className="text-zinc-500">· {3 - gal.photos.length} more for CV</span>}</span>
    </div>
    <div className="grid grid-cols-4 gap-1 mt-1">{gal.photos.map(thumb)}</div>
    {gal.photos.length === 0 && <p className="text-xs text-zinc-500 mt-1">No photos yet.</p>}
    {(gal.references.length > 0 || gal.videos.length > 0) && (
      <div className="mt-2"><span className="text-xs font-bold text-zinc-400">Reference (does not train)</span>
        <div className="grid grid-cols-4 gap-1 mt-1">{[...gal.references, ...gal.videos].map(thumb)}</div></div>)}
    <div className="flex gap-1 mt-2 items-center flex-wrap">
      <select value={view} onChange={e => setView(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs">
        <optgroup label="Photo (trains)">{PHOTO_VIEWS.map(v => <option key={v} value={v}>{v}</option>)}</optgroup>
        <optgroup label="Reference (does not train)">{REF_VIEWS.map(v => <option key={v} value={v}>{v}</option>)}</optgroup>
      </select>
      <label className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 cursor-pointer">
        {busy ? "…" : "📷 Upload photo"}
        <input type="file" accept="image/*" className="hidden" onChange={upload} disabled={busy} />
      </label>
    </div>
    {msg && <p className="text-xs text-amber-400 mt-1">{msg}</p>}
    <div className="flex gap-1 mt-2 items-center">
      <input value={drive} onChange={e => setDrive(e.target.value)} placeholder="Paste Drive link (vault) for the latest photo…"
        className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs" />
      <button onClick={() => gal.photos.length && attachBackup(gal.photos[gal.photos.length - 1].id)}
        className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1">💾</button>
    </div>
  </div>);
}

export default function Dashboard() {
  const [minis, setMinis] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [apiOk, setApiOk] = useState("checking…");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [detail, setDetail] = useState<any | null>(null);

  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string>("");
  const [loginMsg, setLoginMsg] = useState("");
  const [lemail, setLemail] = useState("");
  const [lpass, setLpass] = useState("");
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [facets, setFacets] = useState<any[]>([]);
  const [selTags, setSelTags] = useState<string[]>([]);
  const [ftype, setFtype] = useState("");
  const [fvals, setFvals] = useState<any>({});
  const [ffacets, setFfacets] = useState<any>({});
  const [covers, setCovers] = useState<any>({});
  const [loading, setLoading] = useState(false);

  function authHeaders(extra: any = {}) {
    return token
      ? { ...extra, "Authorization": `Bearer ${token}` }
      : { ...extra };
  }

  useEffect(() => {
    fetch(`${API}/health`).then(() => setApiOk("API connected")).catch(() => setApiOk("API offline"));
    // Restaura sesión guardada y valídala contra /auth/v1/user.
    // Sin sesión NO se carga nada de la app (landing de auth primero).
    (async () => {
      try {
        const raw = localStorage.getItem("mb_session");
        if (raw) {
          const s = JSON.parse(raw);
          if (s.access_token) {
            const me = await restMe(s.access_token);
            if (me.ok && me.user?.email) {
              setUser(me.user); setToken(s.access_token);
              reload("", s.access_token); loadFacets(s.access_token, ""); loadFieldFacets(s.access_token); loadStats(s.access_token);
              setChecking(false);
              return;
            }
            localStorage.removeItem("mb_session");
          }
        }
      } catch {}
      setChecking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reload(query: string, tk: string = token, p: number = page,
                      tags: string[] = selTags, type: string = ftype, size: number = pageSize,
                      fv: any = fvals) {
    try {
      setLoading(true);
      const h: any = tk ? { "Authorization": `Bearer ${tk}` } : {};
      const fparams: any = {};
      for (const [k, v] of Object.entries(fv)) if (v) fparams[k] = String(v);
      const qs = new URLSearchParams({
        collection_id: "default", q: query, page: String(p), page_size: String(size),
        ...(type ? { type } : {}), ...(tags.length ? { tags: tags.join(",") } : {}),
        ...fparams,
      });
      const r = await fetch(`${API}/api/minis?${qs}`, { headers: h });
      const j = await r.json();
      if (r.ok) {
        setMinis(j.items ?? []); setTotal(j.total ?? 0); setPage(j.page ?? p);
        loadCovers((j.items ?? []).map((m: any) => m.id), tk);
      }
      else setLoginMsg(j.detail ? String(j.detail) : "");
    } catch {} finally { setLoading(false); }
  }
  // Portadas en 1 sola llamada: frontal > render_3d > concept_art > 1ra foto
  async function loadCovers(ids: string[], tk: string = token) {
    if (!ids.length || !tk) return;
    try {
      const r = await fetch(`${API}/api/images/covers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ids }) });
      const j = await r.json();
      if (r.ok) setCovers(j.covers ?? {});
    } catch {}
  }
  async function loadFacets(tk: string, type: string = "") {
    try {
      const qs = type ? `?type=${encodeURIComponent(type)}` : "";
      const r = await fetch(`${API}/api/minis/facets/tags${qs}`, {
        headers: { Authorization: `Bearer ${tk}` } });
      const j = await r.json();
      if (r.ok) setFacets(j.tags ?? []);
    } catch {}
  }
  async function loadFieldFacets(tk: string) {
    try {
      const r = await fetch(`${API}/api/minis/facets/fields`, {
        headers: { Authorization: `Bearer ${tk}` } });
      const j = await r.json();
      if (r.ok) setFfacets(j.fields ?? {});
    } catch {}
  }
  // Totales en vivo: tipos únicos + piezas (suma quantity). El conteo principal es tipos.
  async function loadStats(tk: string) {
    try {
      const r = await fetch(`${API}/api/minis/stats`, {
        headers: { Authorization: `Bearer ${tk}` } });
      const j = await r.json();
      if (r.ok) setStats(j);
    } catch {}
  }
  function applyFilter(k: string, v: string) {
    const next = { ...fvals, [k]: v };
    if (!v) delete next[k];
    setFvals(next); setPage(1); reload(q, token, 1, selTags, ftype, pageSize, next);
  }
  function clearFilters() {
    setFvals({}); setSelTags([]); setFtype(""); setPage(1);
    reload(q, token, 1, [], "", pageSize, {});
  }
  const nActiveFilters = Object.keys(fvals).length + selTags.length + (ftype ? 1 : 0);
  // Debounce de búsqueda: no dispara por tecla sino 350ms después de parar
  useEffect(() => {
    if (!token) return;
    const t = setTimeout(() => reload(q, token, 1), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  // Registro BLOQUEADO: solo entra la cuenta existente (miniaturesab).
  // Para abrir registro en el futuro: restLogin(..., "up") + deshabilitar RLS de signup.
  async function doLogin() {
    if (!lemail || !lpass) { setLoginMsg("Enter email and password."); return; }
    setLoginMsg("Checking…");
    try {
      const { ok, status, data } = await restLogin(lemail, lpass, "in");
      if (!ok) {
        const msg = data?.msg || data?.error_description || data?.error || `Error ${status}`;
        setLoginMsg(String(msg));
        return;
      }
      localStorage.setItem("mb_session", JSON.stringify({
        access_token: data.access_token, refresh_token: data.refresh_token, user: data.user,
      }));
      setUser(data.user); setToken(data.access_token);
      setLoginMsg(""); reload("", data.access_token); loadFacets(data.access_token, ""); loadFieldFacets(data.access_token); loadStats(data.access_token);
    } catch (e: any) {
      setLoginMsg("No connection to Supabase: " + (e?.message || e));
    }
  }
  async function doLogout() {
    try {
      if (token) await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      });
    } catch {}
    localStorage.removeItem("mb_session");
    setUser(null); setToken(""); setMinis([]);
  }
  function openCreate() { setEditing(null); setForm(EMPTY); setShowForm(true); }
  function openEdit(m: any) { setEditing(m); setForm(fromRec(m)); setShowForm(true); setDetail(null); }
  async function save(e: any) {
    e.preventDefault();
    if (!form.name.trim()) return alert("Name is required");
    const payload = toPayload(form);
    const url = editing ? `${API}/api/minis/${editing.id}` : `${API}/api/minis`;
    const r = await fetch(url, { method: editing ? "PUT" : "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(payload) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); return alert("Error saving: " + errText(j, r.status)); }
    setShowForm(false); reload(q, token, page); loadFacets(token, ftype); loadFieldFacets(token); loadStats(token);
  }
  async function remove(m: any) {
    if (!confirm(`Delete ${m.name}?`)) return;
    const r = await fetch(`${API}/api/minis/${m.id}`, { method: "DELETE", headers: authHeaders() });
    const j = await r.json().catch(() => ({}));
    if (typeof j.cloudinary_deleted === "number" &&
        j.cloudinary_deleted < (j.cloudinary_expected ?? 0))
      alert(`Deleted, but Cloudinary cleanup did not complete (` +
            `${j.cloudinary_deleted}/${j.cloudinary_expected} files).`);
    if (!r.ok) { return alert("Error deleting: " + errText(j, r.status)); }
    setDetail(null); setShowForm(false); reload(q, token, page); loadFacets(token, ftype); loadFieldFacets(token); loadStats(token);
  }
  const set = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.value });
  const inp = "bg-zinc-900 border border-zinc-800 rounded px-3 py-2 outline-none w-full text-sm";
  const lbl = "text-xs text-zinc-400 mb-1 block";

  if (checking) return (<main className="min-h-screen flex items-center justify-center mb-sharp">
    <p className="text-zinc-500 text-sm">Checking session…</p>
  </main>);

  // PUERTA TOTAL: sin sesión no se renderiza nada de la app (ni buscador ni tipos).
  if (!user) return (<main className="min-h-screen flex items-center justify-center p-6 mb-sharp">
    <div className="bg-zinc-900 border border-zinc-800 rounded p-6 w-full max-w-sm">
      <h1 className="text-2xl font-bold">MiniBase Web</h1>
      <p className="text-xs text-zinc-500 mt-1">Private access — {apiOk}</p>
      <input value={lemail} onChange={e => setLemail(e.target.value)} placeholder="you@email.com" type="email"
        onKeyDown={e => e.key === "Enter" && doLogin()}
        className="mt-4 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 outline-none w-full text-sm" />
      <input value={lpass} onChange={e => setLpass(e.target.value)} placeholder="password" type="password"
        onKeyDown={e => e.key === "Enter" && doLogin()}
        className="mt-2 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 outline-none w-full text-sm" />
      <button onClick={() => doLogin()} className="mt-3 bg-white text-black rounded px-4 py-2 text-sm font-semibold w-full">Sign in</button>
      {loginMsg && <p className="text-xs text-amber-400 mt-2">{loginMsg}</p>}
    </div>
  </main>);

  return (<main className="p-6 max-w-6xl mx-auto mb-sharp">
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <h1 className="text-3xl font-bold flex items-center gap-3"><Logo />MiniBase Web</h1>
      <div className="bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-zinc-400 text-right">
        <p className="text-zinc-500">API: {apiOk} · {stats ? `${stats.tipos} types · ${stats.piezas} pieces` : `${total} types`} · Supabase cloud · <a className="underline" href={`${API}/docs`} target="_blank">Swagger</a></p>
        <p className="mt-1">Signed in as: <span className="text-emerald-400">{user.email}</span>
          <button onClick={doLogout} className="underline ml-3">Sign out</button>
        </p>
      </div>
    </div>
    <div className="flex gap-2 mt-4 flex-wrap">
      <div className="relative flex-1 min-w-[200px]">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search: dragon, forest, token…"
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 pr-8 outline-none" />
        {q && (<button onClick={() => setQ("")} title="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white text-xl leading-none">×</button>)}
      </div>
      <select value={ftype} onChange={e => { const t = e.target.value; setFtype(t); setSelTags([]); setPage(1); loadFacets(token, t); reload(q, token, 1, [], t); }}
        className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm">
        <option value="">all types</option>
        {["mini", "scenery", "token", "tile", "prop"].map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <button onClick={openCreate} className="bg-white text-black rounded px-4 py-2 font-semibold">+ New type</button>
      <a href="/imports" className="bg-zinc-800 border border-zinc-700 rounded px-4 py-2">⭳ Import Excel</a>
      <a href="/inbox" className="bg-zinc-800 border border-zinc-700 rounded px-4 py-2">✓ Complete</a>
      <a href="/escenarios" className="bg-emerald-400 text-black rounded px-4 py-2 font-semibold">◈ Scenarios</a>
    </div>
    {facets.length > 0 && (
      <div className="flex gap-1 mt-2 flex-wrap items-center">
        <span className="text-xs text-zinc-500">Tags{ftype ? ` in ${ftype}` : ""} (any):</span>
        {facets.slice(0, 30).map((t: any) => (
          <button key={t.name} onClick={() => {
            const next = selTags.includes(t.name) ? selTags.filter(x => x !== t.name) : [...selTags, t.name];
            setSelTags(next); setPage(1); reload(q, token, 1, next, ftype);
          }}
            className={`tag-pill text-xs rounded-full px-2 py-1 border ${selTags.includes(t.name) ? "bg-white text-black" : "bg-zinc-900 border-zinc-700"}`}>
            {t.name} ({t.count})</button>))}
      </div>)}
    {loading && <p className="text-xs text-zinc-500 mt-2">Searching…</p>}
    <div className="mt-3 bg-zinc-900/60 border border-zinc-800 rounded p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-zinc-400 font-bold">Filters{nActiveFilters > 0 && ` (${nActiveFilters})`}</span>
        {nActiveFilters > 0 && (
          <button onClick={clearFilters} className="text-xs bg-red-950 border border-red-900 rounded px-2 py-1">Clear filters</button>)}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
        {FILTER_FIELDS.map(f => (
          <label key={f.k} className="text-xs text-zinc-400">{f.label}
            <select value={fvals[f.k] || ""} onChange={e => applyFilter(f.k, e.target.value)}
              className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200">
              <option value="">All</option>
              {(ffacets[f.k] || []).map((o: any) => (
                <option key={o.value} value={o.value}>{o.value} ({o.count})</option>))}
            </select>
          </label>))}
      </div>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
      {minis.map((m: any) => (
        <div key={m.id} onClick={() => setDetail(m)} className="cursor-pointer bg-zinc-900 border border-zinc-800 rounded p-3 hover:border-zinc-500">
          <div className="aspect-square bg-zinc-800 rounded mb-2 overflow-hidden">
            {covers[m.id] ? <img src={covers[m.id]} alt={m.name} loading="lazy"
              className="w-full h-full object-cover" /> : (
              <div className="w-full h-full flex items-center justify-center text-4xl">
                {m.type === "scenery" ? "🏰" : m.type === "token" ? "🪙" : "🐉"}</div>)}
          </div>
          <div className="font-semibold truncate">{m.name}</div>
          <div className="text-xs text-zinc-400">{m.type} · x{m.quantity ?? 1} · {m.completeness_score ?? 0}%</div>
          <div className="h-1 bg-zinc-800 rounded mt-2"><div className="h-1 bg-emerald-400 rounded" style={{ width: `${m.completeness_score ?? 0}%` }} /></div>
          <div className="flex gap-2 mt-2">
            <button onClick={(e) => { e.stopPropagation(); openEdit(m); }} className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 w-full">Edit</button>
          </div>
        </div>))}
    </div>
    {minis.length === 0 && !loading && <p className="text-zinc-500 mt-6">No results. Adjust search or filters.</p>}
    {total > pageSize && (
      <div className="mt-4 flex flex-col items-center gap-2">
        <div className="flex gap-2 items-center text-sm">
          <button disabled={page <= 1} onClick={() => { const p = page - 1; setPage(p); reload(q, token, p); }}
            className="bg-zinc-800 rounded px-3 py-1 disabled:opacity-40">←</button>
          <span className="text-xs text-zinc-400">page {page} of {Math.ceil(total / pageSize)} · {total} types</span>
          <button disabled={page * pageSize >= total} onClick={() => { const p = page + 1; setPage(p); reload(q, token, p); }}
            className="bg-zinc-800 rounded px-3 py-1 disabled:opacity-40">→</button>
        </div>
        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); reload(q, token, 1, selTags, ftype, Number(e.target.value)); }}
          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-xs text-zinc-400">
          {[24, 50, 100].map(n => <option key={n} value={n}>{n}/page</option>)}
        </select>
      </div>)}

    {detail && (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
        <div className="bg-zinc-950 border border-zinc-800 rounded max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          {covers[detail.id] && (
            <img src={covers[detail.id]} alt={detail.name} className="w-full max-h-64 object-contain rounded bg-black mb-2" />)}
          <h2 className="text-xl font-bold">{detail.name}</h2>
          <p className="text-xs text-zinc-400">{detail.type} · {detail.system || "no system"} · {detail.faction || "no faction"}</p>
          <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
            <div><span className={lbl}>Shape / Bioform</span>{detail.shape || "—"} / {detail.bioform || "—"}</div>
            <div><span className={lbl}>Material / Scale</span>{detail.material || "—"} / {detail.scale || "—"}</div>
            <div><span className={lbl}>Colors</span>{detail.main_color || "—"} + {detail.secondary_color || "—"}</div>
            <div><span className={lbl}>Height / Weight / Base / Diam.</span>{detail.height_mm ?? "—"}mm / {detail.weight_g ?? "—"}g / {detail.radius_of_base_mm ?? "—"}mm / {detail.diameter_mm ?? "—"}mm</div>
            <div><span className={lbl}>Tags</span>{(detail.tags || []).join(", ") || "—"}</div>
            <div><span className={lbl}>Designer / Painter / Year</span>{detail.designer || "—"} / {detail.painted_by || "—"} / {detail.year || "—"}</div>
            <div><span className={lbl}>Size / Painted / Grid</span>{detail.size_category || "—"} / {detail.paint_status || "—"} / {detail.grid_cells ?? 1} cells</div>
            <div><span className={lbl}>Role / Plays / Fav</span>{detail.role || "—"} / {detail.play_count ?? 0} / {detail.is_favorite ? "★" : "—"}</div>
          </div>
          {(detail.aliases || []).length > 0 && (<p className="text-xs text-zinc-500 mt-1">Aliases: {(detail.aliases || []).join(", ")}</p>)}
          <p className="text-sm mt-3"><span className={lbl}>Story / lore</span>{detail.story || "No story yet"}</p>
          {detail.comment && (<p className="text-sm mt-2"><span className={lbl}>Comment</span>{detail.comment}</p>)}
          <p className="text-xs text-zinc-500 mt-1">Origin: {detail.character_origin || "—"} · Ref: {detail.code_or_reference || "—"}</p>
          <Gallery mini={detail} token={token} api={API} />
          <div className="flex gap-2 mt-4">
            <button onClick={() => openEdit(detail)} className="bg-white text-black rounded px-3 py-2 text-sm font-semibold">Edit entry</button>
            <button onClick={() => setDetail(null)} className="bg-zinc-800 rounded px-3 py-2 text-sm">Close</button>
          </div>
        </div>
      </div>)}

    {showForm && (
      <div className="fixed inset-0 bg-black/70 overflow-y-auto p-4">
        <form onSubmit={save} className="bg-zinc-950 border border-zinc-800 rounded max-w-2xl mx-auto p-5">
          <h2 className="text-xl font-bold">{editing ? `Edit ${editing.name}` : "New type — full entry"}</h2>
          <p className="text-xs text-zinc-500 mb-3">Everything you enter here can later be used by the AI/DM/CV. Only name is required.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className={lbl}>Name *</label><input className={inp} value={form.name} onChange={set("name")} placeholder="E.g.: Red Dragon" /></div>
            <div><label className={lbl}>Type (mini / scenery / token…)</label><select className={inp} value={form.type} onChange={set("type")}>{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className={lbl}>Quantity</label><input type="number" className={inp} value={form.quantity} onChange={set("quantity")} /></div>
            <div><label className={lbl}>Shape</label><input className={inp} value={form.shape} onChange={set("shape")} placeholder="humanoid, beast…" /></div>
            <div><label className={lbl}>Bioform</label><input className={inp} value={form.bioform} onChange={set("bioform")} placeholder="dragon, orc…" /></div>
            <div><label className={lbl}>Material</label><input className={inp} value={form.material} onChange={set("material")} placeholder="resin, PLA…" /></div>
            <div><label className={lbl}>Scale</label><input className={inp} value={form.scale} onChange={set("scale")} /></div>
            <div><label className={lbl}>Main color</label><input className={inp} value={form.main_color} onChange={set("main_color")} /></div>
            <div><label className={lbl}>Secondary color</label><input className={inp} value={form.secondary_color} onChange={set("secondary_color")} /></div>
            <div><label className={lbl}>Height mm</label><input type="number" step="any" className={inp} value={form.height_mm} onChange={set("height_mm")} /></div>
            <div><label className={lbl}>Weight g</label><input type="number" step="any" className={inp} value={form.weight_g} onChange={set("weight_g")} /></div>
            <div><label className={lbl}>Base mm</label><input type="number" step="any" className={inp} value={form.radius_of_base_mm} onChange={set("radius_of_base_mm")} /></div>
            <div><label className={lbl}>Diameter mm</label><input type="number" step="any" className={inp} value={form.diameter_mm} onChange={set("diameter_mm")} placeholder="tokens" /></div>
            <div><label className={lbl}>RPG system</label><input className={inp} value={form.system} onChange={set("system")} placeholder="D&D, Warhammer…" /></div>
            <div className="col-span-2"><label className={lbl}>Tags (comma-separated)</label><input className={inp} value={form.tags} onChange={set("tags")} placeholder="Fantasy, D&D" /></div>
            <div><label className={lbl}>Designer</label><input className={inp} value={form.designer} onChange={set("designer")} /></div>
            <div><label className={lbl}>Painter</label><input className={inp} value={form.painted_by} onChange={set("painted_by")} /></div>
            <div><label className={lbl}>Brand / stamp (label)</label><input className={inp} value={form.label} onChange={set("label")} placeholder="AB!, Reaper…" /></div>
            <div><label className={lbl}>Canon lore</label><select className={inp} value={form.lore_is_canon} onChange={set("lore_is_canon")}><option value="">—</option><option value="true">Yes</option><option value="false">No</option></select></div>
            <div><label className={lbl}>Faction</label><input className={inp} value={form.faction} onChange={set("faction")} /></div>
            <div><label className={lbl}>Scene role (DM)</label><input className={inp} value={form.role} onChange={set("role")} placeholder="tank, damage, support…" /></div>
            <div><label className={lbl}>Size (DM)</label><select className={inp} value={form.size_category} onChange={set("size_category")}><option value="">—</option>{SIZE_CATEGORIES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><label className={lbl}>Painted</label><select className={inp} value={form.paint_status} onChange={set("paint_status")}><option value="">—</option>{PAINT_STATES.map(s => <option key={s} value={s}>{s === "sin_pintar" ? "unpainted" : s === "avanzado" ? "advanced" : s === "terminada" ? "finished" : s}</option>)}</select></div>
            <div><label className={lbl}>Grid cells</label><input type="number" min={1} max={10} className={inp} value={form.grid_cells} onChange={set("grid_cells")} /></div>
            <div><label className={lbl}>Games played</label><input type="number" min={0} className={inp} value={form.play_count} onChange={set("play_count")} /></div>
            <div><label className={lbl}>Favorite</label><select className={inp} value={form.is_favorite} onChange={set("is_favorite")}><option value="">—</option><option value="true">Yes</option><option value="false">No</option></select></div>
            <div className="col-span-2"><label className={lbl}>Aliases (other names, comma-separated)</label><input className={inp} value={form.aliases} onChange={set("aliases")} placeholder="the sea vampire, …" /></div>
            <div><label className={lbl}>Year / Ref</label><div className="flex gap-2"><input className={inp} value={form.year} onChange={set("year")} placeholder="year" /><input className={inp} value={form.code_or_reference} onChange={set("code_or_reference")} placeholder="ref" /></div></div>
            <div className="col-span-2"><label className={lbl}>Character origin</label><input className={inp} value={form.character_origin} onChange={set("character_origin")} /></div>
            <div className="col-span-2"><label className={lbl}>Story / lore</label><textarea className={inp} rows={3} value={form.story} onChange={set("story")} placeholder="Lore, personality, how to use it in game…" /></div>
            <div className="col-span-2"><label className={lbl}>Comment</label><input className={inp} value={form.comment} onChange={set("comment")} placeholder="short note…" /></div>
            <div className="col-span-2"><label className={lbl}>Reference URL</label><input className={inp} value={form.url} onChange={set("url")} /></div>
          </div>
          {editing ? (
            <div className="mt-3 border-t border-zinc-800 pt-3">
              <h3 className="text-sm font-bold">Photos per view (13 schema + reference)</h3>
              <p className="text-xs text-zinc-500">Frontal is the cover; if missing, render_3d; otherwise the illustration (concept_art).</p>
              <Gallery mini={editing} token={token} api={API} />
            </div>
          ) : (
            <p className="text-xs text-zinc-500 mt-3">Save the entry first and you can upload its 13 views right here.</p>
          )}
          <div className="flex gap-2 mt-4">
            <button type="submit" className="bg-white text-black rounded px-4 py-2 font-semibold">Save</button>
            <button type="button" onClick={() => setShowForm(false)} className="bg-zinc-800 rounded px-4 py-2">Cancel</button>
            {editing && (<button type="button" onClick={() => remove(editing)}
              className="bg-red-950 border border-red-900 rounded px-4 py-2 ml-auto">Delete</button>)}
          </div>
        </form>
      </div>)}
  </main>);
}
