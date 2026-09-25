// Placeholder media for seeded attachments: an SVG "photo" and a quiet WAV of the right length.

const PHOTO_TONES = ['#C9D6D1', '#D8CDBF', '#C7D3E0', '#D6CCD9']

export function placeholderPhoto(label: string, seed = 0, width = 800, height = 600): Blob {
  const bg = PHOTO_TONES[seed % PHOTO_TONES.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="${bg}"/>
<g fill="none" stroke="#4E5D5A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" transform="translate(${width / 2 - width / 10} ${height / 2 - width / 8}) scale(${width / 120})">
<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></g>
<text x="50%" y="${height / 2 + width / 7}" text-anchor="middle" font-family="sans-serif" font-size="${width / 22}" fill="#4E5D5A">${label}</text>
</svg>`
  return new Blob([svg], { type: 'image/svg+xml' })
}

/** 8 kHz mono 8-bit WAV with a faint tone, so the player has something to play. */
export function placeholderAudio(durationMs: number): Blob {
  const rate = 8000
  const samples = Math.max(1, Math.round((durationMs / 1000) * rate))
  const buf = new ArrayBuffer(44 + samples)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate, true)
  v.setUint16(32, 1, true)
  v.setUint16(34, 8, true)
  str(36, 'data')
  v.setUint32(40, samples, true)
  for (let i = 0; i < samples; i++) {
    const envelope = 0.5 + 0.5 * Math.sin((i / rate) * Math.PI * 1.3)
    v.setUint8(44 + i, 128 + Math.round(10 * envelope * Math.sin((i / rate) * 2 * Math.PI * 330)))
  }
  return new Blob([buf], { type: 'audio/wav' })
}

/** A one-page PDF saying this is a mock export. */
export function placeholderPdf(title: string): Blob {
  const text = `Mock export: ${title.replace(/[()\\]/g, '')}`
  const stream = `BT /F1 18 Tf 72 760 Td (${text}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Blob([out], { type: 'application/pdf' })
}
