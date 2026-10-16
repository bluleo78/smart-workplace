// 이슈 입력 미저장 판정 — 새로고침 경고(beforeunload)가 켜지는 조건. 이전엔 E2E 8건이 화면에서 확인하던 분기(WP-413).
import { describe, expect, it } from 'vitest'

import { hasIssueDraftContent, isBodyDraftDirty } from './issueDraft'

describe('hasIssueDraftContent — 이슈 생성 폼 (#620)', () => {
  it('제목·본문이 모두 비었으면 false', () => {
    expect(hasIssueDraftContent('', '')).toBe(false)
    expect(hasIssueDraftContent(undefined, null)).toBe(false)
  })

  it('공백뿐인 입력은 내용으로 치지 않는다', () => {
    expect(hasIssueDraftContent('   ', '\n\t')).toBe(false)
  })

  it('제목만 입력해도 true', () => {
    expect(hasIssueDraftContent('작성 중인 제목', '')).toBe(true)
  })

  it('본문만 입력해도 true', () => {
    expect(hasIssueDraftContent('', '작성 중인 본문')).toBe(true)
  })
})

describe('isBodyDraftDirty — 이슈 본문 인라인 편집 (#823)', () => {
  it('편집 중이 아니면 draft 가 달라도 false (편집 진입 전·취소 후)', () => {
    expect(isBodyDraftDirty(false, '다른 내용', '원본')).toBe(false)
  })

  it('편집에 들어가기만 하고 고치지 않았으면 false', () => {
    expect(isBodyDraftDirty(true, '원본', '원본')).toBe(false)
  })

  it('편집 중 draft 가 원본과 다르면 true', () => {
    expect(isBodyDraftDirty(true, '저장하지 않은 본문 변경', '원본')).toBe(true)
  })

  it('원본이 없으면(null) 빈 문자열과 비교한다', () => {
    expect(isBodyDraftDirty(true, '', null)).toBe(false)
    expect(isBodyDraftDirty(true, '새 본문', null)).toBe(true)
  })
})
