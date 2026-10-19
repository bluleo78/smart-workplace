import { describe, expect, it, vi } from 'vitest'

import { buildMessageSheetActions, hasMessageSheetActions } from './messageSheetActions'

// 시트 작업 권한 — 보관된 채널(readOnly)에선 본인 메시지라도 수정·삭제를 두지 않는다(WP-508).
describe('messageSheetActions readOnly', () => {
  const own = { id: 10, authorId: 1, deleted: false, body: '본문', mentions: [] }
  const handlers = { currentUserId: 1, onThread: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() }

  it('평소엔 본인 메시지에 수정·삭제가 있다', () => {
    const keys = buildMessageSheetActions(own, handlers).map((a) => a.key)
    expect(keys).toEqual(['thread', 'copy', 'edit', 'delete'])
  })

  it('읽기 전용이면 수정·삭제를 빼고 스레드 보기·복사는 남긴다', () => {
    const keys = buildMessageSheetActions(own, { ...handlers, readOnly: true }).map((a) => a.key)
    expect(keys).toEqual(['thread', 'copy'])
  })

  it('읽기 전용·본문 없는 메시지·스레드 없음이면 작업이 없다', () => {
    const empty = { ...own, body: ' ' }
    expect(hasMessageSheetActions(empty, { ...handlers, onThread: undefined, readOnly: true })).toBe(false)
  })
})
