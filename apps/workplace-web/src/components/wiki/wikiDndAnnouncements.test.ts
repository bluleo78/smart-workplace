// 노트 사이드바 끌어 놓기 스크린리더 안내(WP-838) — 제목·자리·들어갈 부모를 한국어로 읽는지.
import type { Active, Over } from '@dnd-kit/core'
import { describe, expect, it } from 'vitest'

import { WIKI_DND_SCREEN_READER_INSTRUCTIONS, wikiDndAnnouncements, type WikiDropSpot } from './wikiDndAnnouncements'

const titles: Record<number, string> = { 1: '회의록', 2: '설계', 3: '부모' }
const spots: Record<string, WikiDropSpot | null> = {
  '1>2': { overTitle: '설계', parentTitle: null },
  '1>3': { overTitle: '부모', parentTitle: '부모' },
  '1>9': null,
}
const a = wikiDndAnnouncements(
  (id) => titles[Number(id)],
  (activeId, overId) => spots[`${activeId}>${overId}`] ?? null,
)
const active = { id: 1 } as Active
const over = (id: number) => ({ id }) as Over

describe('wikiDndAnnouncements', () => {
  it('집기·취소는 페이지 제목으로 읽는다', () => {
    expect(a.onDragStart({ active })).toBe('「회의록」 페이지를 집었습니다.')
    expect(a.onDragCancel({ active, over: null })).toBe('「회의록」 페이지 이동을 취소했습니다.')
  })

  it('자리 위에서는 그 행 제목과 들어갈 곳(최상위·부모 하위)을 읽는다', () => {
    expect(a.onDragOver({ active, over: over(2) })).toBe('「회의록」 페이지가 「설계」 자리 위에 있습니다. 놓으면 최상위에 들어갑니다.')
    expect(a.onDragOver({ active, over: over(3) })).toBe('「회의록」 페이지가 「부모」 자리 위에 있습니다. 놓으면 「부모」 하위에 들어갑니다.')
  })

  it('집은 직후 자기 자리 위는 읽지 않고, 자리를 못 구하면 자리 밖으로 읽는다', () => {
    expect(a.onDragOver({ active, over: over(1) })).toBeUndefined()
    expect(a.onDragOver({ active, over: over(9) })).toBe('「회의록」 페이지가 놓을 자리 밖에 있습니다.')
    expect(a.onDragOver({ active, over: null })).toBe('「회의록」 페이지가 놓을 자리 밖에 있습니다.')
  })

  it('놓으면 자리와 들어간 곳을, 제자리·대상 없음이면 그대로라고 읽는다', () => {
    expect(a.onDragEnd({ active, over: over(3) })).toBe('「회의록」 페이지를 「부모」 자리에 놓았습니다(「부모」 하위).')
    expect(a.onDragEnd({ active, over: over(1) })).toBe('「회의록」 페이지를 놓았습니다. 위치는 그대로입니다.')
    expect(a.onDragEnd({ active, over: null })).toBe('「회의록」 페이지를 놓았습니다. 위치는 그대로입니다.')
  })

  it('사용법은 한국어로 위·아래 방향키만 안내한다', () => {
    expect(WIKI_DND_SCREEN_READER_INSTRUCTIONS.draggable).toContain('위·아래 방향키')
  })
})
