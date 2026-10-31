// @vitest-environment jsdom
// 「채팅·이슈로 보내기」 순수 규칙(WP-1235) — 본문 모양·키 검색어·최근 대상(localStorage)·열림 스토어.
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildSendBody,
  closeSendToChat,
  destinationLabel,
  forgetDestination,
  MAX_RECENT_DESTINATIONS,
  openSendToChat,
  parseIssueKeyQuery,
  readRecentDestinations,
  rememberDestination,
  type SendDestination,
  sendToChatSession,
  sendToChatTarget,
  subscribeSendToChat,
  validRecentDestinations,
} from './sendToChat'
import type { ShareTarget } from './shareTarget'

const owner = { userId: 1, tenantId: 7 }
const general: SendDestination = { kind: 'channel', channelId: 10, name: '일반' }
const bob: SendDestination = { kind: 'person', userId: 2, name: '밥' }
const issue: SendDestination = { kind: 'issue', issueId: 900, projectKey: 'WP', number: 12, title: '로그인 오류' }

afterEach(() => {
  localStorage.clear()
  closeSendToChat()
  vi.restoreAllMocks()
})

describe('buildSendBody', () => {
  it('함께 보낼 말이 있으면 말 다음 줄에 링크, 없으면 링크만', () => {
    expect(buildSendBody('http://h/x', '  봐 주세요\n급해요  ')).toBe('봐 주세요\n급해요\nhttp://h/x')
    expect(buildSendBody('http://h/x', '   ')).toBe('http://h/x')
  })
})

describe('parseIssueKeyQuery', () => {
  it('키 모양만 읽고 프로젝트 키는 대문자로', () => {
    expect(parseIssueKeyQuery(' wp-12 ')).toEqual({ projectKey: 'WP', number: 12 })
    expect(parseIssueKeyQuery('WP-0')).toBeNull()
    expect(parseIssueKeyQuery('로그인')).toBeNull()
    expect(parseIssueKeyQuery('W-1')).toBeNull()
  })
})

describe('destinationLabel', () => {
  it('채널은 #, 이슈는 키와 제목', () => {
    expect(destinationLabel(general)).toBe('#일반')
    expect(destinationLabel(bob)).toBe('밥')
    expect(destinationLabel(issue)).toBe('WP-12 로그인 오류')
  })
})

describe('최근 대상', () => {
  it('보낸 곳을 맨 앞에 두고 같은 곳은 하나만, 최대 5개', () => {
    rememberDestination(owner, general)
    rememberDestination(owner, bob)
    rememberDestination(owner, general)
    expect(readRecentDestinations(owner)).toEqual([general, bob])
    for (let i = 0; i < 10; i++) rememberDestination(owner, { kind: 'channel', channelId: 100 + i, name: `c${i}` })
    expect(readRecentDestinations(owner)).toHaveLength(MAX_RECENT_DESTINATIONS)
  })

  it('다른 사용자·워크스페이스와 섞이지 않는다', () => {
    rememberDestination(owner, issue)
    expect(readRecentDestinations({ userId: 2, tenantId: 7 })).toEqual([])
    expect(readRecentDestinations({ userId: 1, tenantId: 8 })).toEqual([])
  })

  it('손상된 값·모양이 다른 항목은 버리고, 저장소를 못 쓰면 빈 목록', () => {
    localStorage.setItem('send-to-chat.recent:1:7', JSON.stringify([general, { kind: 'channel', channelId: 'x' }, { kind: 'mail' }]))
    expect(readRecentDestinations(owner)).toEqual([general])
    localStorage.setItem('send-to-chat.recent:1:7', '{깨짐')
    expect(readRecentDestinations(owner)).toEqual([])
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readRecentDestinations(owner)).toEqual([])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => rememberDestination(owner, general)).not.toThrow()
  })
})

describe('최근 대상 다시 맞추기', () => {
  it('forgetDestination 은 그 곳만 뺀다', () => {
    rememberDestination(owner, general)
    rememberDestination(owner, bob)
    forgetDestination(owner, general)
    expect(readRecentDestinations(owner)).toEqual([bob])
  })

  it('나갔거나 보관된 채널은 빼고 이름은 지금 이름으로, 사람·이슈는 그대로', () => {
    const left: SendDestination = { kind: 'channel', channelId: 11, name: '나간 곳' }
    const archived: SendDestination = { kind: 'channel', channelId: 12, name: '옛날' }
    const channels = [{ id: 10, name: '전체', archived: false }, { id: 12, name: '옛날', archived: true }]
    expect(validRecentDestinations([general, left, bob, archived, issue], channels)).toEqual([
      { ...general, name: '전체' },
      bob,
      issue,
    ])
  })

  it('채널 목록을 받기 전에는 채널을 잠시 뺀다', () => {
    expect(validRecentDestinations([general, bob], undefined)).toEqual([bob])
  })
})

describe('열림 스토어', () => {
  const target: ShareTarget = { kind: 'page', url: 'http://h/wiki/open/3', title: '노트' }

  it('다음 틱에 열고 구독자에게 알리며, 닫으면 비운다', () => {
    vi.useFakeTimers()
    try {
      const listener = vi.fn()
      const unsubscribe = subscribeSendToChat(listener)
      openSendToChat(target)
      // 메뉴·시트가 닫힌 다음 틱에 연다 — 부른 틱에는 아직 닫혀 있다.
      expect(sendToChatTarget()).toBeNull()
      vi.runAllTimers()
      expect(sendToChatTarget()).toBe(target)
      closeSendToChat()
      expect(sendToChatTarget()).toBeNull()
      expect(listener).toHaveBeenCalledTimes(2)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('미룬 사이 다시 부르면 마지막 것만 열고, 인자 없는 닫기는 미룬 열기도 취소한다', () => {
    vi.useFakeTimers()
    try {
      const other: ShareTarget = { ...target, url: 'http://h/wiki/open/4' }
      openSendToChat(target)
      openSendToChat(other)
      vi.runAllTimers()
      expect(sendToChatTarget()).toBe(other)
      closeSendToChat()
      openSendToChat(target)
      closeSendToChat()
      vi.runAllTimers()
      expect(sendToChatTarget()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('세션 id 로 닫으면 그 세션이 열려 있을 때만 닫는다 — 그 사이 새로 연 창은 그대로', () => {
    vi.useFakeTimers()
    try {
      openSendToChat(target)
      vi.runAllTimers()
      const first = sendToChatSession()!.id
      openSendToChat({ ...target, url: 'http://h/wiki/open/4' })
      vi.runAllTimers()
      const second = sendToChatSession()!.id
      expect(second).not.toBe(first)
      closeSendToChat(first)
      expect(sendToChatSession()?.id).toBe(second)
      closeSendToChat(second)
      expect(sendToChatSession()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
