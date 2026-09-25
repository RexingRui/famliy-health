// Photos are shrunk on the phone before upload: long edge 2000 px, JPEG 0.85. Redrawing
// through a canvas also drops EXIF, including GPS location. Safari decodes HEIC natively, so
// iPhone photos go through the same path.

export type Compressed = { blob: Blob; width: number; height: number }

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // fall back to <img>, which some browsers decode more formats with
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/jpeg', quality),
  )
}

/** Compresses a photo to JPEG. `square` center-crops (avatars). */
export async function compressImage(
  file: Blob,
  { maxEdge = 2000, quality = 0.85, square = false }: { maxEdge?: number; quality?: number; square?: boolean } = {},
): Promise<Compressed> {
  let source: ImageBitmap | HTMLImageElement
  try {
    source = await decode(file)
  } catch {
    throw new Error('无法读取这张图片，请换一张，或在相册里转成 JPEG 后再试')
  }
  const sw = 'naturalWidth' in source ? source.naturalWidth : source.width
  const sh = 'naturalHeight' in source ? source.naturalHeight : source.height
  const side = Math.min(sw, sh)
  const crop = square ? { x: (sw - side) / 2, y: (sh - side) / 2, w: side, h: side } : { x: 0, y: 0, w: sw, h: sh }
  const out = fitWithin(crop.w, crop.h, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = out.width
  canvas.height = out.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('图片压缩失败')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height)
  if ('close' in source) source.close()
  return { blob: await toJpeg(canvas, quality), ...out }
}
