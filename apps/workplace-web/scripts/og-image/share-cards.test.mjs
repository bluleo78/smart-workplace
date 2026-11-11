// 드라이브 공유 카드 그림 8장(public/og/drive-*.png)이 1200×630 이고 Teams 가운데 잘림을 견디는지 지킨다(WP-1473).
// 그 밖(x < 202, x > 998)에는 배경만 있어야 한다 — og-image.test.mjs 와 같은 판정.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng, KEEP_LEFT, KEEP_RIGHT } from './png.mjs'

/** API 의 그림 키와 같은 8가지. */
const KINDS = ['pdf', 'doc', 'sheet', 'slide', 'image', 'file', 'password', 'internal']

describe.each(KINDS)('drive-%s.png', (kind) => {
  const img = decodePng(readFileSync(new URL(`../../public/og/drive-${kind}.png`, import.meta.url)))

  it('1200×630 이다', () => {
    expect([img.width, img.height]).toEqual([1200, 630])
  })

  it('잘려 나가는 좌우에는 배경만 있고 내용은 가운데에 있다', () => {
    const outside = []
    let inside = 0
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const bg = img.isBackground(x, y)
        if (x < KEEP_LEFT || x > KEEP_RIGHT) {
          if (!bg) outside.push([x, y])
        } else if (!bg) inside++
      }
    }
    expect(outside.slice(0, 5)).toEqual([])
    expect(inside).toBeGreaterThan(10000)
  })
})
