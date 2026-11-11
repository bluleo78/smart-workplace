// 공유 이미지(public/og-image.png)가 Teams 의 가운데 잘림을 견디는지 지킨다(WP-1224).
// Teams 는 1200×630 이미지를 썸네일 칸(약 1.26:1)에 가운데 기준으로 잘라 x 202~998 만 남긴다 — 그 밖에는 배경만 있어야 한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng, KEEP_LEFT, KEEP_RIGHT } from './png.mjs'

describe('og-image.png', () => {
  const img = decodePng(readFileSync(new URL('../../public/og-image.png', import.meta.url)))

  it('1200×630 이다', () => {
    expect([img.width, img.height]).toEqual([1200, 630])
  })

  it('Teams 가 잘라 내는 좌우(x < 202, x > 998)에는 배경만 있고 내용은 남는 가운데에 있다', () => {
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
