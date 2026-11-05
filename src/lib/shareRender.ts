/**
 * Draws share-kit slides on a canvas in the organiser's browser: social-media sized images made from a
 * guest's own words, their stars and a photo. Nothing is uploaded; the result is a JPEG file.
 */

export type ShareFormat = 'post' | 'story'
export const FORMAT_SIZE: Record<ShareFormat, { w: number; h: number; label: string }> = {
  post: { w: 1080, h: 1350, label: 'Post (4:5) for Instagram and Facebook' },
  story: { w: 1080, h: 1920, label: 'Story or reel (9:16) for Instagram, Facebook and TikTok' },
}

const FOREST = '#183D3B'
const CREAM = '#F8F5EF'
const GOLD = '#E0A73A'
const SERIF = "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif"
const SANS = "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"

export type Slide =
  | { kind: 'cover'; photoUrl: string | null; heading: string; title: string; rating: { average: number; count: number } | null; brand: string }
  | { kind: 'review'; photoUrl: string | null; quote: string; title: string | null; name: string | null; rating: number | null; retreatTitle: string; brand: string }
  | { kind: 'closing'; photoUrl: string | null; title: string; link: string; brand: string }

const images = new Map<string, Promise<HTMLImageElement>>()
function loadImage(url: string) {
  if (!images.has(url)) {
    images.set(
      url,
      new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Could not load a photo'))
        img.src = url
      }),
    )
  }
  return images.get(url)!
}

/** Draws an image to fill the box, cropping the overflow (like CSS object-fit: cover). */
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const dw = img.naturalWidth * scale
  const dh = img.naturalHeight * scale
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

/** Greedy word wrap; returns the lines that fit within maxWidth. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

/** The largest font size (down to a floor) at which the text fits the given number of lines. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number, start: number, min: number, family: string, style = '') {
  for (let size = start; size >= min; size -= 2) {
    ctx.font = `${style} ${size}px ${family}`.trim()
    const lines = wrap(ctx, text, maxWidth)
    if (lines.length <= maxLines) return { size, lines }
  }
  ctx.font = `${style} ${min}px ${family}`.trim()
  const lines = wrap(ctx, text, maxWidth)
  // Still too long at the smallest size: cut at a word and mark it.
  const kept = lines.slice(0, maxLines)
  if (lines.length > maxLines) kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[,.;:!?]?$/, '')}…`
  return { size: min, lines: kept }
}

/** A web address has no spaces: break it after "/" (or anywhere, if a piece is still too long). */
function fitLink(ctx: CanvasRenderingContext2D, link: string, maxWidth: number) {
  for (let size = 38; size >= 24; size -= 2) {
    ctx.font = `600 ${size}px ${SANS}`
    const lines: string[] = []
    let line = ''
    for (const piece of link.split(/(?<=\/)/)) {
      if (ctx.measureText(line + piece).width <= maxWidth) {
        line += piece
        continue
      }
      if (line) lines.push(line)
      line = piece
      while (ctx.measureText(line).width > maxWidth) {
        let cut = line.length - 1
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--
        lines.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    if (line) lines.push(line)
    if (lines.length <= 2 || size === 24) return { size, lines }
  }
  return { size: 24, lines: [link] }
}

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45
    const a = (Math.PI / 5) * i - Math.PI / 2
    ctx.lineTo(cx + radius * Math.cos(a), cy + radius * Math.sin(a))
  }
  ctx.closePath()
}

/** Five stars, filled up to `value` (fractions shown as part-filled). Returns the width drawn. */
function drawStars(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, value: number) {
  const gap = size * 0.18
  for (let i = 0; i < 5; i++) {
    const cx = x + i * (size + gap) + size / 2
    starPath(ctx, cx, y, size / 2)
    ctx.fillStyle = 'rgba(255,255,255,0.28)'
    ctx.fill()
    const fill = Math.max(0, Math.min(1, value - i))
    if (fill > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(cx - size / 2, y - size / 2, size * fill, size)
      ctx.clip()
      starPath(ctx, cx, y, size / 2)
      ctx.fillStyle = GOLD
      ctx.fill()
      ctx.restore()
    }
  }
  return 5 * size + 4 * gap
}

function brandChip(ctx: CanvasRenderingContext2D, brand: string, w: number) {
  ctx.font = `600 34px ${SANS}`
  const tw = ctx.measureText(brand).width
  const padX = 30
  const bw = Math.min(tw + padX * 2, w - 160)
  ctx.fillStyle = 'rgba(248,245,239,0.92)'
  roundRect(ctx, 72, 72, bw, 68, 34)
  ctx.fill()
  ctx.fillStyle = FOREST
  ctx.textBaseline = 'middle'
  ctx.fillText(brand, 72 + padX, 72 + 35, bw - padX * 2)
  ctx.textBaseline = 'alphabetic'
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

async function background(ctx: CanvasRenderingContext2D, url: string | null, w: number, h: number, shade: 'bottom' | 'full') {
  ctx.fillStyle = FOREST
  ctx.fillRect(0, 0, w, h)
  if (url) {
    try {
      cover(ctx, await loadImage(url), w, h)
    } catch {
      /* keep the plain background */
    }
  }
  const g = ctx.createLinearGradient(0, 0, 0, h)
  if (shade === 'bottom') {
    g.addColorStop(0, 'rgba(10,26,25,0.35)')
    g.addColorStop(0.35, 'rgba(10,26,25,0.15)')
    g.addColorStop(0.6, 'rgba(10,26,25,0.7)')
    g.addColorStop(1, 'rgba(10,26,25,0.95)')
  } else {
    g.addColorStop(0, 'rgba(10,26,25,0.55)')
    g.addColorStop(1, 'rgba(10,26,25,0.85)')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

export async function renderSlide(slide: Slide, format: ShareFormat): Promise<Blob> {
  await document.fonts?.ready
  const { w, h } = FORMAT_SIZE[format]
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const margin = 84
  const textWidth = w - margin * 2

  if (slide.kind === 'review') {
    await background(ctx, slide.photoUrl, w, h, 'bottom')
    brandChip(ctx, slide.brand, w)
    const maxLines = format === 'story' ? 9 : 7
    const quote = fitText(ctx, `“${slide.quote}”`, textWidth, maxLines, format === 'story' ? 66 : 60, 38, SERIF)
    const lineH = quote.size * 1.28
    const nameBlock = 150
    const titleH = slide.title ? 70 : 0
    let y = h - margin - nameBlock - quote.lines.length * lineH - titleH
    if (slide.title) {
      ctx.font = `700 40px ${SANS}`
      ctx.fillStyle = '#DBE8D6'
      ctx.fillText(slide.title.toUpperCase(), margin, y, textWidth)
      y += titleH
    }
    ctx.font = `${quote.size}px ${SERIF}`
    ctx.fillStyle = '#FFFFFF'
    for (const line of quote.lines) {
      y += lineH
      ctx.fillText(line, margin, y)
    }
    y += 70
    if (slide.rating) {
      drawStars(ctx, margin, y, 46, slide.rating)
      y += 64
    }
    ctx.font = `600 38px ${SANS}`
    ctx.fillStyle = CREAM
    ctx.fillText(`— ${slide.name ?? 'A retreat guest'}`, margin, y, textWidth)
    ctx.font = `30px ${SANS}`
    ctx.fillStyle = 'rgba(248,245,239,0.75)'
    ctx.fillText(slide.retreatTitle, margin, y + 46, textWidth)
  } else if (slide.kind === 'cover') {
    await background(ctx, slide.photoUrl, w, h, 'bottom')
    brandChip(ctx, slide.brand, w)
    const t = fitText(ctx, slide.title, textWidth, 4, 92, 56, SERIF)
    const lineH = t.size * 1.15
    let y = h - margin - (slide.rating ? 150 : 40) - t.lines.length * lineH
    ctx.font = `700 40px ${SANS}`
    ctx.fillStyle = '#DBE8D6'
    ctx.fillText(slide.heading.toUpperCase(), margin, y - 20, textWidth)
    ctx.font = `${t.size}px ${SERIF}`
    ctx.fillStyle = '#FFFFFF'
    for (const line of t.lines) {
      y += lineH
      ctx.fillText(line, margin, y)
    }
    if (slide.rating) {
      y += 90
      const sw = drawStars(ctx, margin, y, 56, slide.rating.average)
      ctx.font = `600 42px ${SANS}`
      ctx.fillStyle = CREAM
      ctx.textBaseline = 'middle'
      ctx.fillText(`${slide.rating.average.toFixed(1)} · ${slide.rating.count} review${slide.rating.count === 1 ? '' : 's'}`, margin + sw + 28, y)
      ctx.textBaseline = 'alphabetic'
    }
  } else {
    await background(ctx, slide.photoUrl, w, h, 'full')
    brandChip(ctx, slide.brand, w)
    ctx.textAlign = 'center'
    const t = fitText(ctx, 'Read more guest stories', textWidth, 3, 84, 56, SERIF)
    let y = h / 2 - (t.lines.length * t.size * 1.15) / 2
    ctx.font = `${t.size}px ${SERIF}`
    ctx.fillStyle = '#FFFFFF'
    for (const line of t.lines) {
      y += t.size * 1.15
      ctx.fillText(line, w / 2, y)
    }
    ctx.font = `600 40px ${SANS}`
    ctx.fillStyle = CREAM
    ctx.fillText(slide.title, w / 2, y + 90, textWidth)
    const link = fitLink(ctx, slide.link, textWidth - 80)
    const boxH = link.lines.length * link.size * 1.3 + 56
    ctx.fillStyle = CREAM
    roundRect(ctx, margin, y + 150, textWidth, boxH, 30)
    ctx.fill()
    ctx.fillStyle = FOREST
    ctx.font = `600 ${link.size}px ${SANS}`
    let ly = y + 150 + 28
    for (const line of link.lines) {
      ly += link.size * 1.3
      ctx.fillText(line, w / 2, ly - 8)
    }
    ctx.textAlign = 'left'
  }

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/jpeg', 0.9))
}
