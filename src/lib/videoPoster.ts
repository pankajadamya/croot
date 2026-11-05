/**
 * Grabs a poster frame and the size and length of a video file in the browser, so the server needs no
 * video tools. Resolves with no poster if the browser can't decode the video (it still uploads).
 */
export async function videoPoster(file: File): Promise<{ poster: Blob | null; width?: number; height?: number; duration?: number }> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  try {
    await withTimeout(once(video, 'loadedmetadata'), 15000)
    const duration = Number.isFinite(video.duration) ? video.duration : undefined
    const width = video.videoWidth || undefined
    const height = video.videoHeight || undefined
    // A frame a little way in usually beats a black first frame.
    video.currentTime = Math.min(1, (duration ?? 2) / 4)
    await withTimeout(once(video, 'seeked'), 15000)
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight, 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    const poster = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    return { poster, width, height, duration }
  } catch {
    return { poster: null }
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

function once(el: HTMLElement, event: string) {
  return new Promise<void>((resolve, reject) => {
    el.addEventListener(event, () => resolve(), { once: true })
    el.addEventListener('error', () => reject(new Error('Could not read the video')), { once: true })
  })
}

function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])
}
