// @vitest-environment jsdom
// 메시지 링크(WP-1236) — 주소 모양과 「그 메시지까지 거슬러 올라가기」의 다음 걸음.
import { describe, expect, it } from 'vitest'

import { chatMessagePath } from './appUrl'
import { MAX_JUMP_PAGES, messageJumpStep, messageShareTarget } from './messageLinkJump'

const base = { found: false, waitForThread: false, loaded: true, hasOlder: true, fetching: false, pages: 1 }

describe('chatMessagePath · messageShareTarget', () => {
  it('채널·DM 메시지 주소 — 스레드 답글은 루트(?thread)를 함께 단다', () => {
    expect(chatMessagePath({ channelId: 5, dm: false, messageId: 77 })).toBe('/chat/channels/5?message=77')
    expect(chatMessagePath({ channelId: 5, dm: true, messageId: 77, threadRootId: 70 })).toBe('/chat/dms/5?thread=70&message=77')
    // 루트 자신은 본 목록에 있으므로 ?thread 를 달지 않는다.
    expect(chatMessagePath({ channelId: 5, dm: false, messageId: 70, threadRootId: 70 })).toBe('/chat/channels/5?message=70')
  })

  it('대상 이름은 본문 앞부분(공백 정리·60자), 본문이 없으면 「메시지」', () => {
    const t = messageShareTarget({ channelId: 5, dm: false }, { id: 77, parentMessageId: null, plainText: '  배포\n  끝났어요 ' })
    expect(t).toEqual({ kind: 'message', url: `${window.location.origin}/chat/channels/5?message=77`, title: '배포 끝났어요' })
    expect(messageShareTarget({ channelId: 5, dm: true }, { id: 1, parentMessageId: null, plainText: '' }).title).toBe('메시지')
    expect(messageShareTarget({ channelId: 5, dm: true }, { id: 1, parentMessageId: null, plainText: 'ㄱ'.repeat(61) }).title).toBe(`${'ㄱ'.repeat(60)}…`)
  })
})

describe('messageJumpStep', () => {
  it('화면에 있으면 스크롤한다', () => {
    expect(messageJumpStep({ ...base, found: true })).toBe('scroll')
  })

  it('없으면 앞 페이지를 받고, 받는 중·첫 조회 전에는 기다린다', () => {
    expect(messageJumpStep(base)).toBe('fetch-older')
    expect(messageJumpStep({ ...base, fetching: true })).toBe('wait')
    expect(messageJumpStep({ ...base, loaded: false })).toBe('wait')
  })

  it('더 받을 페이지가 없거나 상한까지 거슬러 올라갔으면 찾을 수 없다', () => {
    expect(messageJumpStep({ ...base, hasOlder: false })).toBe('missing')
    expect(messageJumpStep({ ...base, pages: MAX_JUMP_PAGES })).toBe('missing')
    expect(messageJumpStep({ ...base, pages: MAX_JUMP_PAGES - 1 })).toBe('fetch-older')
  })

  it('스레드 칸이 답글을 받는 중이면 본 목록을 거슬러 올라가지 않고 기다린다', () => {
    expect(messageJumpStep({ ...base, waitForThread: true })).toBe('wait')
    expect(messageJumpStep({ ...base, waitForThread: true, found: true })).toBe('scroll')
  })
})
