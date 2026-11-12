// 드라이브 공유 링크 나누기(WP-1528) — 공유 창이 살아 있는 링크를 먼저 보이고, 폐기·만료 링크는 「지난 링크」로 접는다.
// 살아 있는지는 서버가 자기 시계로 판정한 active 를 따른다 — 브라우저 시계가 틀려도 나눔이 바뀌지 않는다(코드 리뷰).
import { describe, expect, it } from 'vitest'

import type { ShareLink } from '@/types/drive'

import { splitShareLinks } from './driveShareLinks'

const link = (over: Partial<ShareLink> = {}): ShareLink => ({
  id: 1,
  audience: 'EXTERNAL',
  hasPassword: false,
  expiresAt: null,
  revoked: false,
  active: true,
  createdAt: '2026-11-01T00:00:00Z',
  createdBy: 1,
  token: 'sl_a',
  createdByName: '양동희',
  ...over,
})

describe('splitShareLinks', () => {
  it('살아 있는 링크와 지난 링크로 나누고 각자 입력 순서를 지킨다', () => {
    const a = link({ id: 1 })
    const b = link({ id: 2, revoked: true, active: false })
    const c = link({ id: 3, expiresAt: '2099-01-01T00:00:00Z' })
    const d = link({ id: 4, expiresAt: '2020-01-01T00:00:00Z', active: false })
    const e = link({ id: 5 })
    const { live, past } = splitShareLinks([a, b, c, d, e])
    expect(live.map((l) => l.id)).toEqual([1, 3, 5])
    expect(past.map((l) => l.id)).toEqual([2, 4])
  })

  it('서버의 active 만 따른다 — 브라우저 시계로는 만료가 지났어도 살아 있고, 아직 남았어도 지난 링크다(시계가 틀린 PC)', () => {
    const fastClock = link({ id: 1, active: true, expiresAt: '2000-01-01T00:00:00Z' })
    const slowClock = link({ id: 2, active: false, expiresAt: '2099-01-01T00:00:00Z' })
    const { live, past } = splitShareLinks([fastClock, slowClock])
    expect(live.map((l) => l.id)).toEqual([1])
    expect(past.map((l) => l.id)).toEqual([2])
  })

  it('빈 목록은 둘 다 비어 있다', () => {
    expect(splitShareLinks([])).toEqual({ live: [], past: [] })
  })
})
