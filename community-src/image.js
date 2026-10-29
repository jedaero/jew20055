// 사진을 브라우저에서 줄인 뒤 Realtime Database에 문자열(data URL)로 저장합니다.
// base64 문자열은 원본 바이트보다 약 33% 커지므로, 한도는 문자열 길이로 잡습니다.
export const FULL = { maxSide: 1024, maxChars: 120_000 } // 큰 사진: 약 90KB
export const THUMB = { maxSide: 320, maxChars: 20_000 } // 목록용 썸네일: 약 15KB
const MAX_SOURCE_BYTES = 25 * 1024 * 1024
const QUALITIES = [0.7, 0.6, 0.5, 0.42, 0.35]

async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { /* 아래 방식으로 다시 시도 */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('압축한 사진을 읽지 못했습니다.'))
    reader.readAsDataURL(blob)
  })
}

const toBlob = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality))

// WebP를 우선 쓰고, WebP로 저장하지 못하는 브라우저(일부 Safari)는 JPEG로 저장합니다.
async function encode(canvas, quality) {
  const webp = await toBlob(canvas, 'image/webp', quality)
  if (webp && webp.type === 'image/webp') return webp
  return toBlob(canvas, 'image/jpeg', quality)
}

async function shrink(source, { maxSide, maxChars }) {
  const width0 = source.width || source.naturalWidth
  const height0 = source.height || source.naturalHeight
  let side = Math.min(maxSide, Math.max(width0, height0))
  while (side >= 160) {
    const scale = side / Math.max(width0, height0)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width0 * scale))
    canvas.height = Math.max(1, Math.round(height0 * scale))
    const context = canvas.getContext('2d', { alpha: false })
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    for (const quality of QUALITIES) {
      const blob = await encode(canvas, quality)
      if (!blob) continue
      const dataUrl = await blobToDataUrl(blob)
      if (dataUrl.length <= maxChars) return { dataUrl, width: canvas.width, height: canvas.height }
    }
    side = Math.floor(side * 0.8)
  }
  throw new Error('사진을 충분히 줄이지 못했습니다. 다른 사진을 선택해 주세요.')
}

export async function compressPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 올릴 수 있습니다.')
  if (file.size > MAX_SOURCE_BYTES) throw new Error('원본 사진은 25MB 이하만 선택할 수 있습니다.')
  let source
  try { source = await loadImage(file) } catch { throw new Error('이 사진 형식은 브라우저에서 열 수 없습니다. JPG나 PNG로 바꿔 올려 주세요.') }
  try {
    const full = await shrink(source, FULL)
    const thumb = await shrink(source, THUMB)
    return { full, thumb, bytes: full.dataUrl.length + thumb.dataUrl.length, originalBytes: file.size }
  } finally {
    source.close?.()
  }
}

export const formatKB = chars => `${Math.round(chars / 1024)}KB`
