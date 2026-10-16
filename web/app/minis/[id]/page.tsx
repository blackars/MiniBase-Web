"use client";
export default function MiniDetail({ params }: { params: { id: string } }) {
  return (<main className="p-6 max-w-4xl mx-auto mb-sharp">
    <a href="/" className="text-zinc-400 text-sm">← Volver</a>
    <h1 className="text-2xl font-bold mt-2">Tipo {params.id}</h1>
    <p className="text-zinc-500 text-sm mt-1">Galería Cloudinary 13 vistas + lore + completeness + dataset JSON para CV/DM.</p>
    <div className="grid grid-cols-3 gap-2 mt-4">
      {["frontal","lateral_1","top_view"].map(v=>(<div key={v} className="aspect-square bg-zinc-900 border border-zinc-800 rounded flex items-center justify-center text-xs text-zinc-500">{v}</div>))}
    </div>
  </main>);
}
