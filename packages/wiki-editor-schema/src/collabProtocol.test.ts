import { describe, expect, it } from 'vitest'

import {
  CLOSE_DELETED,
  CLOSE_FORBIDDEN,
  CLOSE_TOKEN_EXPIRED,
  COLLAB_AI_APPLY_ACK_TYPE,
  COLLAB_AI_APPLY_TYPE,
  COLLAB_AI_CANCEL_TYPE,
  COLLAB_CURSOR_FIELD,
  COLLAB_USER_FIELD,
  parseAiMarkers,
  parseCollabAiMessage,
  parseCollabCursor,
  parseCollabUser,
  REVALIDATE_REASON_DELETED,
} from './collabProtocol'

// awareness 는 클라이언트 자기 신고 값이라 모양을 믿지 않는다 — 깨진 항목은 버리고 나머지만 그린다.
describe('parseAiMarkers', () => {
  it('keeps well-formed markers and drops the rest', () => {
    const ok = { id: 'm1', userId: 5, name: '양동희', anchor: { type: null, tname: 'default', item: null, assoc: 0 } }
    expect(parseAiMarkers([ok, { id: 2 }, null, 'x', { ...ok, name: 3 }, { ...ok, anchor: null }])).toEqual([ok])
  })

  it('returns an empty list for non-arrays (cleared field)', () => {
    expect(parseAiMarkers(null)).toEqual([])
    expect(parseAiMarkers(undefined)).toEqual([])
    expect(parseAiMarkers({})).toEqual([])
  })
})

describe('종료 코드', () => {
  // 웹은 코드로 종단을 가른다 — 겹치면 삭제를 권한 회수로(또는 만료로) 오판해 안내·재접속이 어긋난다.
  it('삭제(4404)는 권한 회수·토큰 만료와 다른 앱 전용 코드다', () => {
    const codes = [CLOSE_TOKEN_EXPIRED.code, CLOSE_FORBIDDEN.code, CLOSE_DELETED.code]
    expect(new Set(codes).size).toBe(3)
    for (const c of codes) expect(c >= 4000 && c <= 4999).toBe(true)
    expect(CLOSE_DELETED.reason).toBe(REVALIDATE_REASON_DELETED)
  })
})

describe('presence awareness fields (WP-173)', () => {
  it('uses the y-prosemirror names so other Yjs tools read them the same way', () => {
    expect(COLLAB_USER_FIELD).toBe('user')
    expect(COLLAB_CURSOR_FIELD).toBe('cursor')
  })

  it('parses a user with a numeric id and a string name, and rejects anything else', () => {
    expect(parseCollabUser({ id: 2, name: '김철수' })).toEqual({ id: 2, name: '김철수' })
    // 자기 신고 값이라 색 등 다른 키는 버린다
    expect(parseCollabUser({ id: 2, name: '김철수', color: '#f00' })).toEqual({ id: 2, name: '김철수' })
    expect(parseCollabUser({ id: '2', name: '김철수' })).toBeNull()
    expect(parseCollabUser({ id: Number.NaN, name: 'x' })).toBeNull()
    expect(parseCollabUser({ id: 2 })).toBeNull()
    expect(parseCollabUser(null)).toBeNull()
    expect(parseCollabUser('김철수')).toBeNull()
  })

  it('parses a cursor only when both anchor and head are objects', () => {
    const rel = { type: null, tname: 'default', item: null, assoc: 0 }
    expect(parseCollabCursor({ anchor: rel, head: rel })).toEqual({ anchor: rel, head: rel })
    expect(parseCollabCursor({ anchor: rel })).toBeNull()
    expect(parseCollabCursor({ anchor: rel, head: 3 })).toBeNull()
    expect(parseCollabCursor(null)).toBeNull()
  })

  it('keeps an optional activity counter (seq) and stays compatible with cursors that have none', () => {
    const rel = { type: null, tname: 'default', item: null, assoc: 0 }
    expect(parseCollabCursor({ anchor: rel, head: rel, seq: 7 })).toEqual({ anchor: rel, head: rel, seq: 7 })
    // 옛 클라이언트(seq 없음)·깨진 seq 는 커서는 살리고 seq 만 버린다
    expect(parseCollabCursor({ anchor: rel, head: rel })).toEqual({ anchor: rel, head: rel })
    expect(parseCollabCursor({ anchor: rel, head: rel, seq: '7' })).toEqual({ anchor: rel, head: rel })
    expect(parseCollabCursor({ anchor: rel, head: rel, seq: Number.NaN })).toEqual({ anchor: rel, head: rel })
  })
})

// AI 적용 stateless(WP-323)도 상대가 보낸 값이라 모양을 믿지 않는다 — 서버·웹·E2E 가 같은 판정을 쓴다.
describe('parseCollabAiMessage', () => {
  it('세 type 과 비지 않은 requestId 만 받는다(키 순서·여분 필드 무관)', () => {
    for (const type of [COLLAB_AI_APPLY_TYPE, COLLAB_AI_APPLY_ACK_TYPE, COLLAB_AI_CANCEL_TYPE]) {
      expect(parseCollabAiMessage(JSON.stringify({ type, requestId: 'r1' }))).toEqual({ type, requestId: 'r1' })
    }
    expect(parseCollabAiMessage(JSON.stringify({ requestId: 'r1', x: 1, type: COLLAB_AI_APPLY_TYPE }))).toEqual({
      type: COLLAB_AI_APPLY_TYPE,
      requestId: 'r1',
    })
  })

  it('깨진 JSON·null·모르는 type·빈/긴/문자열 아닌 requestId 는 null', () => {
    expect(parseCollabAiMessage('not json')).toBeNull()
    expect(parseCollabAiMessage('null')).toBeNull()
    expect(parseCollabAiMessage(JSON.stringify({ type: 'collab:role', requestId: 'r1' }))).toBeNull()
    expect(parseCollabAiMessage(JSON.stringify({ type: COLLAB_AI_APPLY_TYPE }))).toBeNull()
    expect(parseCollabAiMessage(JSON.stringify({ type: COLLAB_AI_APPLY_TYPE, requestId: '' }))).toBeNull()
    expect(parseCollabAiMessage(JSON.stringify({ type: COLLAB_AI_APPLY_TYPE, requestId: 7 }))).toBeNull()
    expect(parseCollabAiMessage(JSON.stringify({ type: COLLAB_AI_APPLY_TYPE, requestId: 'x'.repeat(128) }))).not.toBeNull()
    expect(parseCollabAiMessage(JSON.stringify({ type: COLLAB_AI_APPLY_TYPE, requestId: 'x'.repeat(129) }))).toBeNull()
  })
})
