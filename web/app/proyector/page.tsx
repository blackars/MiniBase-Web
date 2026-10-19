"use client";
import { useEffect, useRef, useState } from "react";
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Proyector: imagen del escenario a pantalla completa + rejilla de TAMANO REAL.
// La rejilla NO esta horneada: se dibuja encima solo cuando se indica.
// Calibracion: px_por_cm = (ancho_px_pantalla / ancho_cm_fisico) * zoom.
// Segunda pantalla: API Multi-Screen (getScreenDetails) o fullscreen manual.
export default function Proyector() {
  const [ok, setOk] = useState(false);
  const [token, setToken] = useState("");
  const [scns, setScns] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [img, setImg] = useState<string>("");
  const [showGrid, setShowGrid] = useState(false);
  const [cellCm, setCellCm] = useState(2.5);
  const [zoom, setZoom] = useState(1);
  const [screenWcm, setScreenWcm] = useState(() => {
    try { return Number(localStorage.getItem("mb_screen_cm")) || 0; } catch { return 0; }
  });
  const [ppcm, setPpcm] = useState(0); // px por cm medido
  const [screens, setScreens] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mb_session");
      if (!raw || !JSON.parse(raw)?.access_token) { location.href = "/"; return; }
      const t = JSON.parse(raw).access_token;
      setToken(t);
      fetch(`${API}/api/scenarios`, { headers: { Authorization: `Bearer ${t}` } })
        .then(r => r.json()).then(j => setScns(j.items ?? []));
      setOk(true);
    } catch { location.href = "/"; }
    // Deteccion de pantallas (Chrome/Edge; pide permiso una vez)
    (async () => {
      try {
        const gsd: any = (window as any).getScreenDetails;
        if (gsd) {
          const d = await gsd();
          const list = [...d.screens];
          setScreens(list);
          d.addEventListener("screenschange", async () => {
            const dd: any = await (window as any).getScreenDetails();
            setScreens([...dd.screens]);
          });
        }
      } catch {}
    })();
  }, []);

  // px/cm base del monitor (sin zoom). Sin calibrar se estima 96dpi CSS.
  useEffect(() => {
    if (screenWcm > 0) setPpcm(window.screen.width / screenWcm);
    else setPpcm(0);
  }, [screenWcm]);

  // Tecla G: rejilla ON/OFF (movimiento). No interfiere escribiendo en campos.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = (e.target as HTMLElement)?.tagName;
      if ((e.key === "g" || e.key === "G") && !["INPUT", "SELECT", "TEXTAREA"].includes(t)) {
        e.preventDefault();
        setShowGrid(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const PXCM_STD = 96 / 2.54; // 96dpi CSS cuando no hay calibracion
  const baseEff = ppcm || PXCM_STD;
  const calibrated = ppcm > 0;

  function saveCal(v: number) {
    setScreenWcm(v);
    try { localStorage.setItem("mb_screen_cm", String(v)); } catch {}
  }
  function pickScn(id: string) {
    const s = scns.find(x => x.id === id);
    setSel(s || null);
    if (s?.grid_cell_cm) setCellCm(Number(s.grid_cell_cm));
  }
  function onFile(e: any) {
    const f = e.target.files?.[0];
    if (!f) return;
    // dataURL para que la 2da pantalla (otra ventana) reciba la misma imagen
    const rd = new FileReader();
    rd.onload = () => {
      try { setImg(String(rd.result)); }
      catch { setMsg("Image too heavy to sync; use a lighter one."); }
    };
    rd.readAsDataURL(f);
  }

  // Arrastre del fondo: explorar el mapa con zoom (la rejilla queda fija)
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<any>(null);
  function panStart(e: any) {
    const p = e.touches?.[0] || e;
    drag.current = { sx: p.clientX, sy: p.clientY, ox: pan.x, oy: pan.y };
  }
  function panMove(e: any) {
    if (!drag.current) return;
    const p = e.touches?.[0] || e;
    setPan({ x: drag.current.ox + (p.clientX - drag.current.sx),
             y: drag.current.oy + (p.clientY - drag.current.sy) });
  }
  function panEnd() { drag.current = null; }
  function recenter() { setPan({ x: 0, y: 0 }); setZoom(1); }

  // Sincroniza estado principal -> ventana pop (?pop=1) por localStorage
  const projState = { img, showGrid, cellCm, zoom, pan,
    color: sel?.grid_color || "#22ff88", opacity: sel?.grid_opacity ?? 0.6,
    baseEff, calibrated, selName: sel?.name || "",
    sw: (typeof window !== "undefined" ? window.screen.width : 0) };
  useEffect(() => {
    try { localStorage.setItem("mb_proj", JSON.stringify({ ...projState, img: img.slice(0, 4000000) })); }
    catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, showGrid, cellCm, zoom, pan, sel]);
  function readPop(): any {
    try { return JSON.parse(localStorage.getItem("mb_proj") || "{}"); }
    catch { return {}; }
  }
  async function openSecond() {
    // Intenta mover una ventana a la segunda pantalla; si no hay API, fullscreen aqui
    try {
      const gsd: any = (window as any).getScreenDetails;
      if (gsd && screens.length > 1) {
        const second = screens.find((s: any) => !s.isPrimary) || screens[1];
        const w = window.open(`${location.origin}/proyector?pop=1`, "_blank",
          `left=${second.availLeft},top=${second.availTop},width=${second.availWidth},height=${second.availHeight}`);
        if (w) { setMsg(`Projection sent to: ${second.label || "second screen"}`); return; }
      }
    } catch {}
    try {
      await boxRef.current?.requestFullscreen();
      setMsg("Local fullscreen (no multi-screen API in this browser).");
    } catch { setMsg("Browser blocked fullscreen."); }
  }

  if (!ok) return (<main className="p-6"><p className="text-zinc-500 text-sm">Checking access…</p></main>);

  // Modo ventana emergente en la 2da pantalla: solo lienzo (lo controla la principal)
  if (typeof window !== "undefined" && new URLSearchParams(location.search).get("pop") === "1") {
    return <PopCanvas />;
  }

  // Rejilla CONGELADA a 1.0x: el zoom solo agranda la imagen, la celda
  // mantiene sus cm reales como referencia fija de medida.
  const cellPx = cellCm * baseEff;

  return (<main className="p-6 max-w-6xl mx-auto">
    <a href="/escenarios" className="text-zinc-400 text-sm">← Scenarios</a>
    <h1 className="text-2xl font-bold mt-2">◉ Projector</h1>
    <p className="text-xs text-zinc-500 mt-1">
      Detected screens: {screens.length || "API unavailable (use manual fullscreen)"}
      {screens.map((s: any, i: number) => (
        <span key={i} className="ml-2">{s.label || `screen ${i + 1}`} {s.isPrimary ? "(primary)" : ""} {s.width}x{s.height}</span>))}
    </p>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
      <div className="bg-zinc-900 border border-zinc-800 rounded p-3 space-y-2">
        <label className="text-xs text-zinc-400 block">Scenario (brings cell/color)
          <select value={sel?.id || ""} onChange={e => pickScn(e.target.value)}
            className="mt-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-2 w-full text-sm">
            <option value="">— none —</option>
            {scns.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="text-xs text-zinc-400 block">Image to project
          <input type="file" accept="image/*" onChange={onFile}
            className="mt-1 text-xs text-zinc-300" /></label>
        <label className="text-xs text-zinc-400 block">Physical monitor width (cm) — real-size calibration
          <input type="number" step="any" value={screenWcm || ""} onChange={e => saveCal(Number(e.target.value))}
            placeholder="e.g. 52 for 24&quot;" className="mt-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-2 w-full text-sm" /></label>
        <p className="text-xs text-zinc-500">
          {calibrated ? `Measured: ${baseEff.toFixed(1)} px/cm → cell ${cellCm}cm = ${cellPx.toFixed(0)}px` : `Estimated 96dpi: cell ${cellCm}cm = ${cellPx.toFixed(0)}px (calibrate for accuracy). G key = grid.`}
        </p>
        <label className="text-xs text-zinc-400 block">Grid cell (cm, decimals)
          <input type="number" step="any" value={cellCm} onChange={e => setCellCm(Number(e.target.value))}
            className="mt-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-2 w-full text-sm" /></label>
        <label className="text-xs text-zinc-400 block">Scenario zoom: {zoom.toFixed(2)}x
          <input type="range" min="0.25" max="4" step="0.05" value={zoom} onChange={e => setZoom(Number(e.target.value))}
            className="w-full" /></label>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowGrid(!showGrid)}
            className={`text-sm rounded px-3 py-2 font-semibold ${showGrid ? "bg-emerald-400 text-black" : "bg-zinc-800 border border-zinc-700"}`}>
            {showGrid ? "⛶ Grid ON" : "⛶ Grid OFF"}</button>
          <button onClick={openSecond} className="text-sm bg-white text-black rounded px-3 py-2 font-semibold">
            ⧉ Send to 2nd screen</button>
        </div>
        {msg && <p className="text-xs text-amber-400">{msg}</p>}
      </div>
      <div className="md:col-span-2">
        <div ref={boxRef} className="relative bg-black border border-zinc-800 rounded overflow-hidden aspect-video select-none touch-none cursor-grab active:cursor-grabbing"
          onMouseDown={panStart} onMouseMove={panMove} onMouseUp={panEnd} onMouseLeave={panEnd}
          onTouchStart={panStart} onTouchMove={panMove} onTouchEnd={panEnd}>
          {img ? <img src={img} alt="" draggable={false} className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} /> : (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm">
              Load a scenario image
            </div>)}
          {showGrid && <GridOverlay cellPx={cellPx} color={sel?.grid_color || "#22ff88"} opacity={sel?.grid_opacity ?? 0.6} />}
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          {cellPx ? `Real-size cell: ${cellCm} cm = ${cellPx.toFixed(0)} px on this monitor.` : "Calibrate the monitor for exact real size."}
          {" "}Drag to explore · <button onClick={recenter} className="underline">recenter</button>
        </p>
      </div>
    </div>
  </main>);
}

function PopCanvas() {
  const [st, setSt] = useState<any>({});
  useEffect(() => {
    try { setSt(JSON.parse(localStorage.getItem("mb_proj") || "{}")); } catch {}
    function onSto(e: StorageEvent) {
      if (e.key === "mb_proj") {
        try { setSt(JSON.parse(e.newValue || "{}")); } catch {}
      }
    }
    window.addEventListener("storage", onSto);
    const t = setInterval(() => {
      try { setSt(JSON.parse(localStorage.getItem("mb_proj") || "{}")); } catch {}
    }, 1000);
    return () => { window.removeEventListener("storage", onSto); clearInterval(t); };
  }, []);
  // Re-calibra px/cm a ESTE monitor manteniendo el tamaño real en cm
  const mainSw = st.sw || window.screen.width;
  const eff = (st.baseEff || 96 / 2.54) * (window.screen.width / mainSw);
  const cellPx = (st.cellCm || 2.5) * eff;
  const pp = st.pan || { x: 0, y: 0 };
  return (<div className="fixed inset-0 bg-black overflow-hidden">
    {st.img ? <img src={st.img} alt="" className="absolute inset-0 w-full h-full object-contain"
      style={{ transform: `translate(${pp.x}px, ${pp.y}px) scale(${st.zoom || 1})` }} /> : (
      <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm">
        Waiting for image from the main window… (press G there for the grid)
      </div>)}
    {st.showGrid && <GridOverlay cellPx={cellPx} color={st.color || "#22ff88"} opacity={st.opacity ?? 0.6} />}
  </div>);
}

function GridOverlay({ cellPx, color, opacity }: { cellPx: number; color: string; opacity: number }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  if (!cellPx || cellPx < 4) return null;
  const lines = [];
  for (let x = 0; x <= size.w; x += cellPx)
    lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={size.h} stroke={color} strokeOpacity={opacity} strokeWidth={1} />);
  for (let y = 0; y <= size.h; y += cellPx)
    lines.push(<line key={`h${y}`} x1={0} y1={y} x2={size.w} y2={y} stroke={color} strokeOpacity={opacity} strokeWidth={1} />);
  return (<div ref={ref} className="absolute inset-0 pointer-events-none">
    <svg width={size.w} height={size.h}>{lines}</svg>
  </div>);
}
