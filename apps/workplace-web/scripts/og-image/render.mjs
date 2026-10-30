// 공유 이미지 원본(og-image.html)을 1200×630 PNG(public/og-image.png)로 찍는다(WP-1224).
// 실행: apps/workplace-web 에서 macOS 로 `node scripts/og-image/render.mjs` — 내용이 Teams 잘림 범위를 벗어나면 실패하고, 찍은 뒤 가로 범위를 알린다.
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// 시안의 글꼴(Apple SD Gothic Neo)은 macOS 시스템 글꼴이다 — 다른 OS 에서 찍으면 대체 글꼴로 폭이 달라진 PNG 가 덮어써진다.
if (process.platform !== 'darwin') {
  console.error('og-image 는 macOS 에서 찍는다(시스템 글꼴 Apple SD Gothic Neo 필요)')
  process.exit(1)
}

/** Teams 가 가운데 잘림으로 남기는 가로 범위 — 내용이 이 밖으로 나가면 찍지 않는다. */
const KEEP_LEFT = 202
const KEEP_RIGHT = 998

const source = new URL('./og-image.html', import.meta.url)
const output = fileURLToPath(new URL('../../public/og-image.png', import.meta.url))

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.goto(source.href)
  await page.evaluate(() => document.fonts.ready)
  // 내용 가로 범위 — Teams 가 남기는 x 202~998 안에 넉넉히 들어오는지 찍을 때마다 본다.
  const { left, right } = await page.evaluate(() => {
    const rects = [...document.body.children].map((el) => el.getBoundingClientRect())
    return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) }
  })
  if (left < KEEP_LEFT || right > KEEP_RIGHT) {
    throw new Error(`내용 x ${Math.round(left)}~${Math.round(right)} 이 Teams 가 남기는 x ${KEEP_LEFT}~${KEEP_RIGHT} 를 벗어난다`)
  }
  await page.screenshot({ path: output })
  console.log(`og-image.png 1200×630 — 내용 x ${Math.round(left)}~${Math.round(right)}`)
} finally {
  await browser.close()
}
