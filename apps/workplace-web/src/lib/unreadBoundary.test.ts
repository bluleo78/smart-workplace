import { describe, expect, it } from 'vitest'

import { firstUnreadMessageId } from './unreadBoundary'

describe('firstUnreadMessageId', () => {
  const msgs = (...ids: number[]) => ids.map((id) => ({ id }))

  it('워터마크 아래 첫 미읽음 id 를 반환', () => {
    expect(firstUnreadMessageId(msgs(1, 2, 3, 4, 5), 2)).toBe(3)
  })

  it('워터마크가 null 이면 null', () => {
    expect(firstUnreadMessageId(msgs(1, 2, 3), null)).toBeNull()
  })

  it('전부 미읽음(위에 읽은 메시지 없음)이면 null', () => {
    expect(firstUnreadMessageId(msgs(5, 6, 7), 0)).toBeNull()
  })

  it('미읽음이 없으면 null', () => {
    expect(firstUnreadMessageId(msgs(1, 2, 3), 3)).toBeNull()
  })

  it('순서가 섞여 있어도 가장 작은 미읽음 id', () => {
    expect(firstUnreadMessageId(msgs(5, 1, 3, 2, 4), 2)).toBe(3)
  })
})
