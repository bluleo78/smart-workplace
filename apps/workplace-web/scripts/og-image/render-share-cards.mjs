// 드라이브 공유 카드 원본(share-card.html)을 종류별 1200×630 PNG(public/og/drive-<kind>.png) 8장으로 찍는다(WP-1473).
// 실행: apps/workplace-web 에서 `node scripts/og-image/render-share-cards.mjs` — 플랫폼은 가리지 않는다(macOS 의 Apple SD Gothic Neo 또는
// 리눅스의 Noto Sans CJK KR 둘 중 하나가 있으면 된다). 둘 다 없으면 한글이 두부로 찍히므로 실패한다.
// 내용이 Teams 잘림 범위(x 202~998)를 벗어나도 실패하고, 찍은 뒤 장마다 내용의 가로 범위를 알린다.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { KEEP_LEFT, KEEP_RIGHT } from './png.mjs'

/** API 의 그림 키와 같은 8가지 — public/og/drive-<kind>.png 로 나간다. */
const KINDS = ['pdf', 'doc', 'sheet', 'slide', 'image', 'file', 'password', 'internal']

const source = new URL('./share-card.html', import.meta.url)
const outDir = fileURLToPath(new URL('../../public/og/', import.meta.url))
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  // 글꼴은 장마다 달라지지 않는다 — 첫 장을 열 때 한 번만 확인한다.
  let fontChecked = false
  for (const kind of KINDS) {
    await page.goto(`${source.href}?kind=${kind}`)
    await page.evaluate(() => document.fonts.ready)
    if (!fontChecked) {
      // 한글 글꼴이 없으면 대체 글꼴(두부)로 찍힌다 — 둘 중 하나가 있는지 본다.
      const hasFont = await page.evaluate(
        () => document.fonts.check('16px "Noto Sans CJK KR"') || document.fonts.check('16px "Apple SD Gothic Neo"'),
      )
      if (!hasFont) throw new Error('한글 글꼴(Noto Sans CJK KR 또는 Apple SD Gothic Neo)이 없다')
      fontChecked = true
    }
    // 내용(로고·그림·글) 가로 범위 — 잘리는 장식(.deco)은 뺀다.
    const { left, right } = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.brand, .doc, .lock, .text > *')]
      const rects = els.map((el) => {
        // 글 칸(.text 안)은 칸 폭이 아니라 글자가 차지한 폭으로 잰다.
        if (el.parentElement.classList.contains('text')) {
          const r = document.createRange()
          r.selectNodeContents(el)
          return r.getBoundingClientRect()
        }
        return el.getBoundingClientRect()
      })
      return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) }
    })
    if (left < KEEP_LEFT || right > KEEP_RIGHT) {
      throw new Error(`${kind}: 내용 x ${Math.round(left)}~${Math.round(right)} 이 Teams 가 남기는 x ${KEEP_LEFT}~${KEEP_RIGHT} 를 벗어난다`)
    }
    await page.screenshot({ path: `${outDir}drive-${kind}.png` })
    console.log(`drive-${kind}.png 1200×630 — 내용 x ${Math.round(left)}~${Math.round(right)}`)
  }
} finally {
  await browser.close()
}
