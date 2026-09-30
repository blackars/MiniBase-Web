"use client";
import { useEffect, useState } from "react";
import { supabase, hasSupabase, SUPABASE_URL, SUPABASE_KEY } from "../lib/supabase";

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

const EMPTY = { name: "", type: "mini", quantity: 1, shape: "", bioform: "", material: "", main_color: "", secondary_color: "", weight_g: "", height_mm: "", radius_of_base_mm: "", scale: "28mm", tags: "", designer: "", painted_by: "", label: "", lore_is_canon: "", story: "", character_origin: "", year: "", code_or_reference: "", url: "", system: "", faction: "" };
const TYPES = ["mini", "scenery", "token", "tile", "prop"];
const FILTER_FIELDS = [
  { k: "main_color", label: "Color princ." }, { k: "secondary_color", label: "Color sec." },
  { k: "bioform", label: "Bioforma" }, { k: "material", label: "Material" },
  { k: "height_mm", label: "Altura mm" }, { k: "radius_of_base_mm", label: "Base mm" },
  { k: "designer", label: "Diseñador" }, { k: "painted_by", label: "Pintor" },
  { k: "label", label: "Marca/sello" }, { k: "character_origin", label: "Origen" },
  { k: "year", label: "Año" },
];

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
  return { collection_id: "default", name: f.name, type: f.type, quantity: Number(f.quantity) || 1,
    shape: f.shape || null, bioform: f.bioform || null, material: f.material || null,
    main_color: f.main_color || null, secondary_color: f.secondary_color || null,
    weight_g: num(f.weight_g), height_mm: num(f.height_mm), radius_of_base_mm: num(f.radius_of_base_mm),
    scale: f.scale || "28mm", tags,
    designer: f.designer || null, painted_by: f.painted_by || null, story: f.story || null,
    label: f.label || null, lore_is_canon: f.lore_is_canon === "" ? null : f.lore_is_canon === "true",
    character_origin: f.character_origin || null, year: f.year || null,
    code_or_reference: f.code_or_reference || null, url: f.url || null,
    system: f.system || null, faction: f.faction || null, stats: {} };
}
function fromRec(m: any) {
  return { ...EMPTY, ...m, tags: Array.isArray(m.tags) ? m.tags.join(", ") : (m.tags || ""),
    lore_is_canon: m.lore_is_canon == null ? "" : String(m.lore_is_canon),
    weight_g: m.weight_g ?? "", height_mm: m.height_mm ?? "", radius_of_base_mm: m.radius_of_base_mm ?? "" };
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
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setMsg("Máx 10MB por foto."); return; }
    setBusy(true); setMsg("Firmando…");
    try {
      // 1. Firma (el backend genera derivados WebP vía eager)
      const s = await (await fetch(
        `${api}/api/minis/${mini.id}/images/sign?view_type=${view}&collection=default&slug=${mini.slug || "mini"}&user=me`,
        { method: "POST", headers: H })).json();
      if (s.demo) throw new Error("Cloudinary sin configurar");
      // 2. Subida directa navegador → Cloudinary
      setMsg("Subiendo…");
      const fd = new FormData();
      fd.append("file", f);
      fd.append("api_key", s.api_key);
      fd.append("timestamp", String(s.timestamp));
      fd.append("public_id", s.public_id);
      fd.append("folder", s.folder);
      fd.append("eager", s.eager);
      fd.append("signature", s.signature);
      const up = await (await fetch(s.upload_url, { method: "POST", body: fd })).json();
      if (up.error) throw new Error(up.error.message);
      const webp = (up.eager && up.eager[0] && up.eager[0].secure_url) || up.secure_url;
      // 3. Registrar en MiniBase (WebP como canonical)
      setMsg("Guardando…");
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
    } catch (err: any) { setMsg(String(err.message || err)); }
    finally { setBusy(false); e.target.value = ""; }
  }

  async function del(id: string) {
    if (!confirm("¿Borrar esta imagen?")) return;
    await fetch(`${api}/api/images/${id}`, { method: "DELETE", headers: H });
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

  if (!gal) return (<p className="text-xs text-zinc-500 mt-3">Cargando galería…</p>);
  return (<div className="mt-3">
    <div className="flex items-center gap-2">
      <span className="text-xs font-bold">Fotos {gal.photos.length}/13 {gal.cv_ready ? <span className="text-emerald-400">· CV-ready ✓</span> : <span className="text-zinc-500">· faltan {3 - gal.photos.length} para CV</span>}</span>
    </div>
    <div className="grid grid-cols-4 gap-1 mt-1">{gal.photos.map(thumb)}</div>
    {gal.photos.length === 0 && <p className="text-xs text-zinc-500 mt-1">Sin fotos todavía.</p>}
    {(gal.references.length > 0 || gal.videos.length > 0) && (
      <div className="mt-2"><span className="text-xs font-bold text-zinc-400">Referencia (no entrena)</span>
        <div className="grid grid-cols-4 gap-1 mt-1">{[...gal.references, ...gal.videos].map(thumb)}</div></div>)}
    <div className="flex gap-1 mt-2 items-center flex-wrap">
      <select value={view} onChange={e => setView(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs">
        <optgroup label="Foto (entrena)">{PHOTO_VIEWS.map(v => <option key={v} value={v}>{v}</option>)}</optgroup>
        <optgroup label="Referencia (no entrena)">{REF_VIEWS.map(v => <option key={v} value={v}>{v}</option>)}</optgroup>
      </select>
      <label className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 cursor-pointer">
        {busy ? "…" : "📷 Subir foto"}
        <input type="file" accept="image/*" className="hidden" onChange={upload} disabled={busy} />
      </label>
    </div>
    {msg && <p className="text-xs text-amber-400 mt-1">{msg}</p>}
    <div className="flex gap-1 mt-2 items-center">
      <input value={drive} onChange={e => setDrive(e.target.value)} placeholder="Pegar link Drive (bóveda) para la última foto…"
        className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs" />
      <button onClick={() => gal.photos.length && attachBackup(gal.photos[gal.photos.length - 1].id)}
        className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1">💾</button>
    </div>
  </div>);
}

export default function Dashboard() {
  const [minis, setMinis] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [apiOk, setApiOk] = useState("probando…");
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
  const [facets, setFacets] = useState<any[]>([]);
  const [selTags, setSelTags] = useState<string[]>([]);
  const [ftype, setFtype] = useState("");
  const [fvals, setFvals] = useState<any>({});
  const [ffacets, setFfacets] = useState<any>({});
  const [loading, setLoading] = useState(false);

  function authHeaders(extra: any = {}) {
    return token
      ? { ...extra, "Authorization": `Bearer ${token}` }
      : { ...extra };
  }

  useEffect(() => {
    fetch(`${API}/health`).then(() => setApiOk("API conectada")).catch(() => setApiOk("API apagada"));
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
              reload("", s.access_token); loadFacets(s.access_token); loadFieldFacets(s.access_token);
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
      if (r.ok) { setMinis(j.items ?? []); setTotal(j.total ?? 0); setPage(j.page ?? p); }
      else setLoginMsg(j.detail ? String(j.detail) : "");
    } catch {} finally { setLoading(false); }
  }
  async function loadFacets(tk: string) {
    try {
      const r = await fetch(`${API}/api/minis/facets/tags`, {
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
    if (!lemail || !lpass) { setLoginMsg("Escribe correo y contraseña."); return; }
    setLoginMsg("Verificando…");
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
      setLoginMsg(""); reload("", data.access_token); loadFacets(data.access_token); loadFieldFacets(data.access_token);
    } catch (e: any) {
      setLoginMsg("Sin conexión a Supabase: " + (e?.message || e));
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
    if (!form.name.trim()) return alert("El nombre es obligatorio");
    const payload = toPayload(form);
    const url = editing ? `${API}/api/minis/${editing.id}` : `${API}/api/minis`;
    const r = await fetch(url, { method: editing ? "PUT" : "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(payload) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); return alert("Error al guardar: " + (j.detail || r.status)); }
    setShowForm(false); reload(q, token, page); loadFacets(token); loadFieldFacets(token);
  }
  async function remove(m: any) {
    if (!confirm(`¿Borrar ${m.name}?`)) return;
    const r = await fetch(`${API}/api/minis/${m.id}`, { method: "DELETE", headers: authHeaders() });
    if (!r.ok) { const j = await r.json().catch(() => ({})); return alert("Error al borrar: " + (j.detail || r.status)); }
    setDetail(null); setShowForm(false); reload(q, token, page); loadFacets(token); loadFieldFacets(token);
  }
  const set = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.value });
  const inp = "bg-zinc-900 border border-zinc-800 rounded px-3 py-2 outline-none w-full text-sm";
  const lbl = "text-xs text-zinc-400 mb-1 block";

  if (checking) return (<main className="min-h-screen flex items-center justify-center mb-sharp">
    <p className="text-zinc-500 text-sm">Verificando sesión…</p>
  </main>);

  // PUERTA TOTAL: sin sesión no se renderiza nada de la app (ni buscador ni minis).
  if (!user) return (<main className="min-h-screen flex items-center justify-center p-6 mb-sharp">
    <div className="bg-zinc-900 border border-zinc-800 rounded p-6 w-full max-w-sm">
      <h1 className="text-2xl font-bold">MiniBase Web</h1>
      <p className="text-xs text-zinc-500 mt-1">Acceso privado — {apiOk}</p>
      <input value={lemail} onChange={e => setLemail(e.target.value)} placeholder="tu@correo.com" type="email"
        onKeyDown={e => e.key === "Enter" && doLogin()}
        className="mt-4 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 outline-none w-full text-sm" />
      <input value={lpass} onChange={e => setLpass(e.target.value)} placeholder="contraseña" type="password"
        onKeyDown={e => e.key === "Enter" && doLogin()}
        className="mt-2 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 outline-none w-full text-sm" />
      <button onClick={() => doLogin()} className="mt-3 bg-white text-black rounded px-4 py-2 text-sm font-semibold w-full">Entrar</button>
      {loginMsg && <p className="text-xs text-amber-400 mt-2">{loginMsg}</p>}
    </div>
  </main>);

  return (<main className="p-6 max-w-6xl mx-auto mb-sharp">
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <h1 className="text-3xl font-bold flex items-center gap-3"><Logo />MiniBase Web</h1>
      <div className="bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-zinc-400 text-right">
        <p className="text-zinc-500">API: {apiOk} · {total} minis · Supabase nube · <a className="underline" href={`${API}/docs`} target="_blank">Swagger</a></p>
        <p className="mt-1">Conectado: <span className="text-emerald-400">{user.email}</span>
          <button onClick={doLogout} className="underline ml-3">Salir</button>
        </p>
      </div>
    </div>
    <div className="flex gap-2 mt-4 flex-wrap">
      <div className="relative flex-1 min-w-[200px]">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar: dragon, bosque, token…"
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 pr-8 outline-none" />
        {q && (<button onClick={() => setQ("")} title="Limpiar búsqueda"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white text-xl leading-none">×</button>)}
      </div>
      <select value={ftype} onChange={e => { setFtype(e.target.value); setPage(1); reload(q, token, 1, selTags, e.target.value); }}
        className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm">
        <option value="">todo tipo</option>
        {["mini", "scenery", "token", "tile", "prop"].map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <button onClick={openCreate} className="bg-white text-black rounded px-4 py-2 font-semibold">+ Nueva mini</button>
      <a href="/imports" className="bg-zinc-800 border border-zinc-700 rounded px-4 py-2">⭳ Importar Excel</a>
      <a href="/inbox" className="bg-zinc-800 border border-zinc-700 rounded px-4 py-2">✓ Completar</a>
    </div>
    {facets.length > 0 && (
      <div className="flex gap-1 mt-2 flex-wrap items-center">
        <span className="text-xs text-zinc-500">Tags (cualquiera):</span>
        {facets.slice(0, 30).map((t: any) => (
          <button key={t.name} onClick={() => {
            const next = selTags.includes(t.name) ? selTags.filter(x => x !== t.name) : [...selTags, t.name];
            setSelTags(next); setPage(1); reload(q, token, 1, next, ftype);
          }}
            className={`tag-pill text-xs rounded-full px-2 py-1 border ${selTags.includes(t.name) ? "bg-white text-black" : "bg-zinc-900 border-zinc-700"}`}>
            {t.name} ({t.count})</button>))}
      </div>)}
    {loading && <p className="text-xs text-zinc-500 mt-2">Buscando…</p>}
    <div className="mt-3 bg-zinc-900/60 border border-zinc-800 rounded p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-zinc-400 font-bold">Filtros{nActiveFilters > 0 && ` (${nActiveFilters})`}</span>
        {nActiveFilters > 0 && (
          <button onClick={clearFilters} className="text-xs bg-red-950 border border-red-900 rounded px-2 py-1">Limpiar filtros</button>)}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
        {FILTER_FIELDS.map(f => (
          <label key={f.k} className="text-xs text-zinc-400">{f.label}
            <select value={fvals[f.k] || ""} onChange={e => applyFilter(f.k, e.target.value)}
              className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200">
              <option value="">Todos</option>
              {(ffacets[f.k] || []).map((o: any) => (
                <option key={o.value} value={o.value}>{o.value} ({o.count})</option>))}
            </select>
          </label>))}
      </div>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
      {minis.map((m: any) => (
        <div key={m.id} onClick={() => setDetail(m)} className="cursor-pointer bg-zinc-900 border border-zinc-800 rounded p-3 hover:border-zinc-500">
          <div className="aspect-square bg-zinc-800 rounded mb-2 flex items-center justify-center text-4xl">
            {m.type === "scenery" ? "🏰" : m.type === "token" ? "🪙" : "🐉"}</div>
          <div className="font-semibold truncate">{m.name}</div>
          <div className="text-xs text-zinc-400">{m.type} · x{m.quantity ?? 1} · {m.completeness_score ?? 0}%</div>
          <div className="h-1 bg-zinc-800 rounded mt-2"><div className="h-1 bg-emerald-400 rounded" style={{ width: `${m.completeness_score ?? 0}%` }} /></div>
          <div className="flex gap-2 mt-2">
            <button onClick={(e) => { e.stopPropagation(); openEdit(m); }} className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 w-full">Editar</button>
          </div>
        </div>))}
    </div>
    {minis.length === 0 && !loading && <p className="text-zinc-500 mt-6">Sin resultados. Ajusta búsqueda o filtros.</p>}
    {total > pageSize && (
      <div className="mt-4 flex flex-col items-center gap-2">
        <div className="flex gap-2 items-center text-sm">
          <button disabled={page <= 1} onClick={() => { const p = page - 1; setPage(p); reload(q, token, p); }}
            className="bg-zinc-800 rounded px-3 py-1 disabled:opacity-40">←</button>
          <span className="text-xs text-zinc-400">pág {page} de {Math.ceil(total / pageSize)} · {total} minis</span>
          <button disabled={page * pageSize >= total} onClick={() => { const p = page + 1; setPage(p); reload(q, token, p); }}
            className="bg-zinc-800 rounded px-3 py-1 disabled:opacity-40">→</button>
        </div>
        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); reload(q, token, 1, selTags, ftype, Number(e.target.value)); }}
          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-xs text-zinc-400">
          {[24, 50, 100].map(n => <option key={n} value={n}>{n}/pág</option>)}
        </select>
      </div>)}

    {detail && (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
        <div className="bg-zinc-950 border border-zinc-800 rounded max-w-lg w-full p-5" onClick={e => e.stopPropagation()}>
          <h2 className="text-xl font-bold">{detail.name}</h2>
          <p className="text-xs text-zinc-400">{detail.type} · {detail.system || "sin sistema"} · {detail.faction || "sin facción"}</p>
          <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
            <div><span className={lbl}>Forma / Bioforma</span>{detail.shape || "—"} / {detail.bioform || "—"}</div>
            <div><span className={lbl}>Material / Escala</span>{detail.material || "—"} / {detail.scale || "—"}</div>
            <div><span className={lbl}>Colores</span>{detail.main_color || "—"} + {detail.secondary_color || "—"}</div>
            <div><span className={lbl}>Alto / Peso / Base</span>{detail.height_mm ?? "—"}mm / {detail.weight_g ?? "—"}g / {detail.radius_of_base_mm ?? "—"}mm</div>
            <div><span className={lbl}>Tags</span>{(detail.tags || []).join(", ") || "—"}</div>
            <div><span className={lbl}>Autor / Pintor / Año</span>{detail.designer || "—"} / {detail.painted_by || "—"} / {detail.year || "—"}</div>
          </div>
          <p className="text-sm mt-3"><span className={lbl}>Historia / lore</span>{detail.story || "Sin historia todavía"}</p>
          <p className="text-xs text-zinc-500 mt-1">Origen: {detail.character_origin || "—"} · Ref: {detail.code_or_reference || "—"}</p>
          <Gallery mini={detail} token={token} api={API} />
          <div className="flex gap-2 mt-4">
            <button onClick={() => openEdit(detail)} className="bg-white text-black rounded px-3 py-2 text-sm font-semibold">Editar ficha</button>
            <button onClick={() => setDetail(null)} className="bg-zinc-800 rounded px-3 py-2 text-sm">Cerrar</button>
          </div>
        </div>
      </div>)}

    {showForm && (
      <div className="fixed inset-0 bg-black/70 overflow-y-auto p-4">
        <form onSubmit={save} className="bg-zinc-950 border border-zinc-800 rounded max-w-2xl mx-auto p-5">
          <h2 className="text-xl font-bold">{editing ? `Editar ${editing.name}` : "Nueva miniatura — ficha completa"}</h2>
          <p className="text-xs text-zinc-500 mb-3">Todo lo que pongas aquí lo podrá usar después la IA/DM/CV. Solo nombre es obligatorio.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className={lbl}>Nombre *</label><input className={inp} value={form.name} onChange={set("name")} placeholder="Ej: Dragón Rojo" /></div>
            <div><label className={lbl}>Tipo (mini / escenografía / token…)</label><select className={inp} value={form.type} onChange={set("type")}>{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className={lbl}>Cantidad</label><input type="number" className={inp} value={form.quantity} onChange={set("quantity")} /></div>
            <div><label className={lbl}>Forma (shape)</label><input className={inp} value={form.shape} onChange={set("shape")} placeholder="humanoide, bestia…" /></div>
            <div><label className={lbl}>Bioforma</label><input className={inp} value={form.bioform} onChange={set("bioform")} placeholder="dragón, orco…" /></div>
            <div><label className={lbl}>Material</label><input className={inp} value={form.material} onChange={set("material")} placeholder="resina, PLA…" /></div>
            <div><label className={lbl}>Escala</label><input className={inp} value={form.scale} onChange={set("scale")} /></div>
            <div><label className={lbl}>Color principal</label><input className={inp} value={form.main_color} onChange={set("main_color")} /></div>
            <div><label className={lbl}>Color secundario</label><input className={inp} value={form.secondary_color} onChange={set("secondary_color")} /></div>
            <div><label className={lbl}>Alto mm</label><input type="number" step="any" className={inp} value={form.height_mm} onChange={set("height_mm")} /></div>
            <div><label className={lbl}>Peso g</label><input type="number" step="any" className={inp} value={form.weight_g} onChange={set("weight_g")} /></div>
            <div><label className={lbl}>Base mm</label><input type="number" step="any" className={inp} value={form.radius_of_base_mm} onChange={set("radius_of_base_mm")} /></div>
            <div><label className={lbl}>Sistema RPG</label><input className={inp} value={form.system} onChange={set("system")} placeholder="D&D, Warhammer…" /></div>
            <div className="col-span-2"><label className={lbl}>Tags (separados por coma)</label><input className={inp} value={form.tags} onChange={set("tags")} placeholder="Fantasy, D&D" /></div>
            <div><label className={lbl}>Diseñador</label><input className={inp} value={form.designer} onChange={set("designer")} /></div>
            <div><label className={lbl}>Pintor</label><input className={inp} value={form.painted_by} onChange={set("painted_by")} /></div>
            <div><label className={lbl}>Marca / sello (label)</label><input className={inp} value={form.label} onChange={set("label")} placeholder="AB!, Reaper…" /></div>
            <div><label className={lbl}>Lore canon</label><select className={inp} value={form.lore_is_canon} onChange={set("lore_is_canon")}><option value="">—</option><option value="true">Sí</option><option value="false">No</option></select></div>
            <div><label className={lbl}>Facción</label><input className={inp} value={form.faction} onChange={set("faction")} /></div>
            <div><label className={lbl}>Año / Ref</label><div className="flex gap-2"><input className={inp} value={form.year} onChange={set("year")} placeholder="año" /><input className={inp} value={form.code_or_reference} onChange={set("code_or_reference")} placeholder="ref" /></div></div>
            <div className="col-span-2"><label className={lbl}>Origen del personaje</label><input className={inp} value={form.character_origin} onChange={set("character_origin")} /></div>
            <div className="col-span-2"><label className={lbl}>Historia / lore</label><textarea className={inp} rows={3} value={form.story} onChange={set("story")} placeholder="Lore, personalidad, cómo usarla en partida…" /></div>
            <div className="col-span-2"><label className={lbl}>URL referencia</label><input className={inp} value={form.url} onChange={set("url")} /></div>
          </div>
          <div className="flex gap-2 mt-4">
            <button type="submit" className="bg-white text-black rounded px-4 py-2 font-semibold">Guardar</button>
            <button type="button" onClick={() => setShowForm(false)} className="bg-zinc-800 rounded px-4 py-2">Cancelar</button>
            {editing && (<button type="button" onClick={() => remove(editing)}
              className="bg-red-950 border border-red-900 rounded px-4 py-2 ml-auto">Borrar</button>)}
          </div>
        </form>
      </div>)}
  </main>);
}
