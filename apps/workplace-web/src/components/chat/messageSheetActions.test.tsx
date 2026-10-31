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

// 링크 미리보기 지우기(WP-874) — 작성자 본인·미리보기가 있을 때만, 삭제 바로 위.
describe('messageSheetActions 미리보기 지우기', () => {
  const preview = { position: 0 }
  const own = { id: 10, authorId: 1, deleted: false, body: 'https://a.com', mentions: [], linkPreviews: [preview] }
  const handlers = { currentUserId: 1, onEdit: vi.fn(), onDelete: vi.fn(), onDismissPreviews: vi.fn() }

  it('본인 메시지에 미리보기가 있으면 수정과 삭제 사이에 둔다', () => {
    const keys = buildMessageSheetActions(own, handlers).map((a) => a.key)
    expect(keys).toEqual(['copy', 'edit', 'dismiss-previews', 'delete'])
  })

  it('누르면 그 메시지로 onDismissPreviews 를 부른다', () => {
    const onDismissPreviews = vi.fn()
    buildMessageSheetActions(own, { ...handlers, onDismissPreviews }).find((a) => a.key === 'dismiss-previews')!.onSelect()
    expect(onDismissPreviews).toHaveBeenCalledWith(own)
  })

  it('미리보기가 없거나·타인 메시지·읽기 전용·핸들러 없음이면 두지 않는다', () => {
    const has = (m: typeof own, h: typeof handlers & { readOnly?: boolean }) =>
      buildMessageSheetActions(m, h).some((a) => a.key === 'dismiss-previews')
    expect(has({ ...own, linkPreviews: [] }, handlers)).toBe(false)
    expect(has({ ...own, authorId: 2 }, handlers)).toBe(false)
    expect(has(own, { ...handlers, readOnly: true })).toBe(false)
    expect(has(own, { ...handlers, onDismissPreviews: undefined as never })).toBe(false)
  })
})

// 메시지 링크(WP-1236) — 팀 채팅이 대상을 넘기면 복사 다음에 「링크 복사」·「채팅·이슈로 보내기」. 확정·미삭제 메시지만.
describe('messageSheetActions 링크', () => {
  const own = { id: 10, authorId: 1, deleted: false, body: '본문', mentions: [] }
  const target = { kind: 'message' as const, url: 'http://x/chat/channels/5?message=10', title: '본문' }
  const linkTarget = vi.fn(() => target)
  const handlers = { currentUserId: 1, onThread: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), linkTarget }

  it('복사 다음, 수정 앞에 링크 행을 둔다', () => {
    const keys = buildMessageSheetActions(own, handlers).map((a) => a.key)
    expect(keys).toEqual(['thread', 'copy', 'copy-link', 'send-to-chat', 'edit', 'delete'])
    expect(linkTarget).toHaveBeenCalledWith(own)
  })

  it('「채팅·이슈로 보내기」는 그 메시지 대상으로 보내기 대화상자를 연다', async () => {
    vi.useFakeTimers()
    const { sendToChatTarget, closeSendToChat } = await import('@/lib/sendToChat')
    buildMessageSheetActions(own, handlers).find((a) => a.key === 'send-to-chat')!.onSelect()
    // 시트가 닫힌 다음 틱에 연다(openSendToChat).
    vi.runAllTimers()
    expect(sendToChatTarget()).toEqual(target)
    closeSendToChat()
    vi.useRealTimers()
  })

  it('지운 메시지·전송 중 메시지·대상 없음(이슈 채팅)이면 두지 않는다', () => {
    const keysOf = (m: typeof own, h: Partial<typeof handlers> = {}) =>
      buildMessageSheetActions(m, { ...handlers, ...h }).map((a) => a.key)
    expect(keysOf({ ...own, deleted: true })).not.toContain('copy-link')
    expect(keysOf({ ...own, id: -1 })).not.toContain('copy-link')
    expect(keysOf(own, { linkTarget: undefined })).not.toContain('copy-link')
    // 본문이 없고 스레드·수정이 없어도 링크만으로 시트를 열 수 있다.
    expect(hasMessageSheetActions({ ...own, body: ' ', authorId: 2 }, { ...handlers, onThread: undefined })).toBe(true)
  })
})
