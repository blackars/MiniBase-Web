"use client";
import { useEffect, useState } from "react";
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function Inbox() {
  const [token, setToken] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [fields, setFields] = useState<string[]>([]);
  const [field, setField] = useState("");
  const [page, setPage] = useState(0);
  const [msg, setMsg] = useState("");
  const [vals, setVals] = useState<any>({});
  const PAGE = 30;

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mb_session");
      const s = raw ? JSON.parse(raw) : null;
      if (!s?.access_token) { location.href = "/"; return; }
      setToken(s.access_token);
      load(s.access_token, "", 0);
    } catch { location.href = "/"; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(tk: string, f: string, p: number) {
    const r = await fetch(
      `${API}/api/agent/missing?limit=${PAGE}&offset=${p * PAGE}${f ? `&field=${f}` : ""}`,
      { headers: { Authorization: `Bearer ${tk}` } });
    const j = await r.json();
    if (r.ok) { setItems(j.items); setTotal(j.total); setFields(j.fields || []); }
  }
  function changeField(f: string) { setField(f); setPage(0); load(token, f, 0); }
  function changePage(p: number) { setPage(p); load(token, field, p); }

  async function save(m: any) {
    const v = vals[m.id];
    if (v === undefined || v === "") { setMsg("Enter a value."); return; }
    const r = await fetch(`${API}/api/agent/missing/${m.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ value: v }),
    });
    const j = await r.json();
    if (!r.ok) { setMsg("Error: " + (j.detail || r.status)); return; }
    setMsg(`✓ ${m.miniature_name} → ${m.field_name} (completeness ${j.mini.completeness_score}%)`);
    const nv = { ...vals }; delete nv[m.id]; setVals(nv);
    load(token, field, page);
  }

  if (!token) return (<main className="p-6"><p className="text-zinc-500 text-sm">Checking access…</p></main>);

  return (<main className="p-6 max-w-4xl mx-auto mb-sharp">
    <a href="/" className="text-zinc-400 text-sm">← Back</a>
    <h1 className="text-2xl font-bold mt-2">Complete little by little</h1>
    <p className="text-xs text-zinc-500 mt-1">{total} empty fields in your collection. Each answer updates the type and its completeness.</p>
    <div className="flex gap-2 mt-3 flex-wrap items-center">
      <span className="text-xs text-zinc-400">Field:</span>
      <button onClick={() => changeField("")}
        className={`text-xs rounded px-3 py-1 border ${!field ? "bg-white text-black" : "bg-zinc-900 border-zinc-800"}`}>all</button>
      {fields.map(f => (
        <button key={f} onClick={() => changeField(f)}
          className={`text-xs rounded px-3 py-1 border ${field === f ? "bg-white text-black" : "bg-zinc-900 border-zinc-800"}`}>{f}</button>))}
    </div>
    {msg && <p className="text-xs text-emerald-400 mt-2">{msg}</p>}
    <div className="mt-3 space-y-2">
      {items.map(m => (
        <div key={m.id} className="bg-zinc-900 border border-zinc-800 rounded p-3">
          <p className="text-sm font-semibold">{m.miniature_name} <span className="text-zinc-500 font-normal">· missing: {m.field_name}</span></p>
          <p className="text-xs text-zinc-500">{m.suggested_question}</p>
          <div className="flex gap-2 mt-2">
            <input value={vals[m.id] ?? ""} onChange={e => setVals({ ...vals, [m.id]: e.target.value })}
              onKeyDown={e => e.key === "Enter" && save(m)}
              placeholder={m.field_name === "tags" ? "Fantasy, D&D" : "value…"}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-1 text-sm outline-none" />
            <button onClick={() => save(m)} className="bg-white text-black rounded px-3 py-1 text-sm font-semibold">Save</button>
          </div>
        </div>))}
    </div>
    {total > PAGE && (
      <div className="flex gap-2 mt-4 items-center text-sm">
        <button disabled={page === 0} onClick={() => changePage(page - 1)} className="bg-zinc-800 rounded px-3 py-1 disabled:opacity-40">←</button>
        <span className="text-xs text-zinc-400">page {page + 1} of {Math.ceil(total / PAGE)}</span>
        <button disabled={(page + 1) * PAGE >= total} onClick={() => changePage(page + 1)} className="bg-zinc-800 rounded px-3 py-1 disabled:opacity-40">→</button>
      </div>)}
  </main>);
}
