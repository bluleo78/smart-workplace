import { describe, expect, it } from 'vitest'

import { wikiListPath } from './wikiListPath'

// 종료 안내(삭제됨·접근 불가)의 "노트 목록으로" 목적지 — 아직 열 수 있는 스페이스면 그 목록, 아니면 /wiki(첫 스페이스로 리다이렉트).
describe('wikiListPath', () => {
  it('스페이스 목록에 남아 있으면 그 스페이스 목록', () =>
    expect(wikiListPath(2, [{ id: 1 }, { id: 2 }])).toBe('/wiki/spaces/2'))
  // 스페이스에서 빠져(멤버 제거) 접근 불가가 되면 그 스페이스로 보내 봐야 다시 막힌다.
  it('스페이스 목록에서 빠졌으면 /wiki', () => expect(wikiListPath(2, [{ id: 1 }])).toBe('/wiki'))
  it('스페이스 목록을 아직 모르면 /wiki', () => expect(wikiListPath(2, undefined)).toBe('/wiki'))
})
