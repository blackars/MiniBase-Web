"use client";
import { useEffect, useState } from "react";
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function Imports() {
  const [token, setToken] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [sheet, setSheet] = useState("");
  const [mapping, setMapping] = useState<any>({});
  const [rows, setRows] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mb_session");
      if (raw) {
        const s = JSON.parse(raw);
        if (!s.access_token) location.href = "/";
        else setToken(s.access_token);
      } else location.href = "/";
    } catch { location.href = "/"; }
  }, []);

  async function upload() {
    if (!file) return;
    setBusy(true); setMsg("Reading file…"); setReport(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${API}/api/imports/excel/preview`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) { setMsg("Error: " + (j.detail || r.status)); return; }
      setPreview(j);
      const first = Object.keys(j.sheets)[0];
      setSheet(first);
      const m: any = {};
      for (const [c, v] of Object.entries<any>(j.sheets[first].mapping)) m[c] = v.canon || "";
      setMapping(m);
      setRows(j.sheets[first].sample);
      ;(window as any).__allsheets = j.sheets;
      setMsg(`${j.sheets[first].rows_detected} rows in ${first}. Check the mapping.`);
    } catch (e: any) { setMsg("Error: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  function changeSheet(s: string) {
    setSheet(s); setReport(null); setDoneAt("");
    const sh = preview.sheets[s];
    const m: any = {};
    for (const [c, v] of Object.entries<any>(sh.mapping)) m[c] = v.canon || "";
    setMapping(m);
    setRows(sh.sample);
    setMsg(`${sh.rows_detected} rows in ${s}. Check the mapping.`);
  }

  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [doneAt, setDoneAt] = useState("");

  async function sha256(buf: ArrayBuffer) {
    const h = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function send(dry: boolean) {
    // Carga directa: 1 solo upload al bulk de Postgres (segundos).
    // Sin chunks: el servidor clasifica nuevas/modificadas/idénticas y versiona
    // mismo-nombre-datos-distintos como slug-v2, slug-v3…
    setBusy(true); setReport(null); setProgress({ done: 0, total: 0 });
    setMsg(dry ? "Simulating…" : "Uploading straight to your cloud (seconds)…");
    try {
      const map: any = {};
      for (const [c, v] of Object.entries(mapping)) if (v) map[c] = v;
      const fd = new FormData();
      fd.append("file", file!);
      if (sheet) fd.append("sheet", sheet);
      fd.append("dry_run", String(dry));
      fd.append("mapping", JSON.stringify(map));
      const r = await fetch(`${API}/api/imports/excel/direct`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || r.status);
      setReport(j);
      const vtxt = j.n_versions ? ` · ${j.n_versions} versions (v2, v3…)` : "";
      if (dry) setMsg(`Simulation: ${j.new} new, ${j.updated} would update, ${j.skipped_identical || 0} identical skipped${vtxt}.`);
      else {
        setDoneAt(new Date().toLocaleString());
        setMsg(`Done in ${j.elapsed_s ?? "?"}s: ${j.new} new, ${j.updated} updated, ${j.skipped_identical || 0} identical skipped${vtxt}.`);
      }
    } catch (e: any) { setMsg("Error: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  if (!token) return (<main className="p-6"><p className="text-zinc-500 text-sm">Checking access…</p></main>);

  const canonOpts = ["", ...(preview ? Object.values(preview.canon_groups).flat() as string[] : [])];
  const unmapped = Object.entries(mapping).filter(([, v]) => !v);

  return (<main className="p-6 max-w-6xl mx-auto mb-sharp">
    <a href="/" className="text-zinc-400 text-sm">← Back</a>
    <h1 className="text-2xl font-bold mt-2">Import Excel in bulk</h1>
    <p className="text-xs text-zinc-500 mt-1">Your format maps itself (ES/EN, accents, decimal commas). Empty never erases.</p>

    <div className="flex gap-2 mt-4">
      <input type="file" accept=".xlsx,.xls,.csv" onChange={e => setFile(e.target.files?.[0] || null)}
        className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm" />
      <button onClick={upload} disabled={!file || busy} className="bg-white text-black rounded px-4 py-2 text-sm font-semibold disabled:opacity-40">1. Read file</button>
    </div>
    {msg && <p className="text-xs text-zinc-400 mt-2">{msg}</p>}
    {progress.total > 0 && (
      <div className="mt-2 max-w-md">
        <div className="h-2 bg-zinc-800 rounded">
          <div className="h-2 bg-emerald-400 rounded transition-all" style={{ width: `${Math.round(100 * progress.done / progress.total)}%` }} />
        </div>
        <p className="text-xs text-zinc-500 mt-1">{progress.done}/{progress.total} batches</p>
      </div>)}

    {preview && (
      <div className="mt-4">
        <div className="flex gap-2 items-center">
          <span className="text-xs text-zinc-400">Sheet:</span>
          {Object.keys(preview.sheets).map(s => (
            <button key={s} onClick={() => changeSheet(s)}
              className={`text-xs rounded px-3 py-1 border ${s === sheet ? "bg-white text-black" : "bg-zinc-900 border-zinc-800"}`}>{s} ({preview.sheets[s].rows_detected})</button>))}
        </div>
        <h2 className="font-bold mt-4">2. Check the column → field mapping</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
          {Object.entries<any>(preview.sheets[sheet].mapping).map(([col, v]) => (
            <div key={col} className="flex gap-2 items-center bg-zinc-900 border border-zinc-800 rounded px-3 py-2">
              <span className="text-sm flex-1 truncate">{col}
                <span className="text-xs text-zinc-500 ml-2">({v.group || "no group"})</span></span>
              <select value={mapping[col] || ""} onChange={e => setMapping({ ...mapping, [col]: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs max-w-[180px]">
                {canonOpts.map(o => <option key={o} value={o}>{o || "— ignore —"}</option>)}
              </select>
            </div>))}
        </div>
        {unmapped.length > 0 && <p className="text-xs text-amber-400 mt-2">{unmapped.length} unmapped column(s) will be ignored: {unmapped.map(([c]) => c).join(", ")}</p>}

        <h2 className="font-bold mt-4">3. Confirm (reads the full file, not just the sample)</h2>
        <div className="flex gap-2 mt-2">
          <button onClick={() => send(true)} disabled={busy} className="bg-zinc-800 border border-zinc-700 rounded px-4 py-2 text-sm disabled:opacity-40">Simulate (dry-run)</button>
          <button onClick={() => send(false)} disabled={busy} className="bg-emerald-400 text-black rounded px-4 py-2 text-sm font-semibold disabled:opacity-40">Upload to my cloud</button>
        </div>

        {report && (
          <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded p-4">
            {doneAt && !report.mode?.includes("dry") && (
              <div className="mb-3 bg-emerald-950 border border-emerald-700 rounded p-3">
                <p className="text-emerald-300 font-bold">✓ Upload completed {doneAt}</p>
                <p className="text-sm text-emerald-100 mt-1">
                  {report.new ?? 0} new · {report.updated ?? 0} updated · {report.skipped_identical ?? 0} identical skipped · {report.skipped ?? 0} skipped
                  {typeof report.elapsed_s !== "undefined" && ` · ${report.elapsed_s}s`}
                </p>
              </div>)}
            <p className="text-sm">New: <b className="text-emerald-400">{report.new ?? report.imported}</b> · Updated: <b>{report.updated}</b> · Skipped: {report.skipped} {(report.skipped_identical > 0) && <span className="text-zinc-400">(identical already in cloud: {report.skipped_identical})</span>}</p>
            {report.versions?.length > 0 && <ul className="text-xs text-sky-300 mt-2">{report.versions.slice(0, 10).map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>}
            {report.errors?.length > 0 && <ul className="text-xs text-red-400 mt-2">{report.errors.slice(0, 10).map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>}
            {report.fill_rate && (
              <div className="mt-3"><p className="text-xs text-zinc-400 mb-1">Your format compatibility (% filled per field):</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
                  {Object.entries(report.fill_rate).map(([f, v]: any) => (
                    <div key={f} className="text-xs"><span className={v < 50 ? "text-amber-400" : "text-zinc-300"}>{f}: {v}%</span>
                      <div className="h-1 bg-zinc-800 rounded"><div className="h-1 bg-emerald-400 rounded" style={{ width: `${v}%` }} /></div></div>))}
                </div></div>)}
            {report.missing_by_field && Object.keys(report.missing_by_field).length > 0 && (
              <p className="text-xs text-zinc-500 mt-2">Missing saved for the agent: {Object.entries(report.missing_by_field).map(([f, n]: any) => `${f} (${n})`).join(", ")}</p>)}
          </div>)}
      </div>)}
  </main>);
}
