// 노트 스페이스 삭제 메뉴 노출 판정(WP-580) — TEAM + OWNER 만.
import { describe, expect, it } from 'vitest'

import { canDeleteWikiSpace } from './wikiSpaces'

describe('canDeleteWikiSpace', () => {
  it('팀 스페이스 OWNER 만 지울 수 있다', () => {
    expect(canDeleteWikiSpace({ type: 'TEAM', role: 'OWNER' })).toBe(true)
  })

  it('팀 스페이스라도 EDITOR·VIEWER 는 지울 수 없다', () => {
    expect(canDeleteWikiSpace({ type: 'TEAM', role: 'EDITOR' })).toBe(false)
    expect(canDeleteWikiSpace({ type: 'TEAM', role: 'VIEWER' })).toBe(false)
  })

  it('개인 스페이스는 OWNER 여도 지울 수 없다 — 다음 접속 때 다시 생긴다', () => {
    expect(canDeleteWikiSpace({ type: 'PERSONAL', role: 'OWNER' })).toBe(false)
  })

  it('스페이스를 아직 모르면(로딩 중·없는 주소) 지울 수 없다', () => {
    expect(canDeleteWikiSpace(null)).toBe(false)
    expect(canDeleteWikiSpace(undefined)).toBe(false)
  })
})
