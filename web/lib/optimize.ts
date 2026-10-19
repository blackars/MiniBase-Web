// Paso previo a la subida a Cloudinary: convierte cualquier imagen a WebP
// (calidad 0.9 => perdida < 10%) en el navegador, para que el cloud guarde
// menos bytes a largo plazo. Garantiza SIEMPRE devolver un File usable:
// si no se puede convertir (HEIC, navegador sin soporte WebP) o si el WebP
// resultante pesa igual/mas que el original, devuelve el archivo intacto.

const WEBP_QUALITY = 0.9;

export function baseName(name: string) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image" respeta la rotacion EXIF de las fotos de camara
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img; // ya cargado en memoria; revocar el URL tras decode() es seguro
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function toWebP(file: File, quality: number = WEBP_QUALITY): Promise<File> {
  try {
    // Ya es WebP: no re-encodear (evitaria perdida acumulada sin ahorro real)
    if (file.type === "image/webp") return file;
    // GIF animado u archivos que Canvas no procesa bien: tal cual
    if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

    const bmp = await decode(file);
    const canvas = document.createElement("canvas");
    canvas.width = (bmp as any).width ?? (bmp as any).naturalWidth;
    canvas.height = (bmp as any).height ?? (bmp as any).naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp as any, 0, 0); // conserva la transparencia (PNG con alpha)
    if (typeof (bmp as any).close === "function") (bmp as any).close();
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/webp", quality));
    if (!blob || blob.type !== "image/webp") return file; // navegador sin encoder WebP
    // Si la version WebP pesa igual o mas (fotos ya muy comprimidas), sube el original
    if (blob.size >= file.size) return file;
    return new File([blob], `${baseName(file.name) || "image"}.webp`, { type: "image/webp" });
  } catch {
    return file; // formato indescodificable: sube el original
  }
}
