import { describe, expect, it } from 'vitest'

import { firstUnreadMessageId, unreadFromOthersCount } from './unreadBoundary'

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

  // #491: 진입-고정 watermark 보다 큰 메시지라도 내가 작성한 것은 미읽음이 아니다.
  it('watermark 초과 메시지가 내가 보낸 것뿐이면 null (유령 구분선 방지)', () => {
    // 진입 시 1,2 읽음(watermark=2). 진입 후 내가 3번 메시지 전송.
    const messages = [
      { id: 1, authorId: 7 },
      { id: 2, authorId: 7 },
      { id: 3, authorId: 5 }, // 내가(5) 보낸 메시지
    ]
    expect(firstUnreadMessageId(messages, 2, 5)).toBeNull()
  })

  it('내 메시지와 남의 메시지가 섞이면 남의 첫 미읽음 id', () => {
    const messages = [
      { id: 1, authorId: 7 },
      { id: 2, authorId: 7 },
      { id: 3, authorId: 5 }, // 내 메시지 → 제외
      { id: 4, authorId: 7 }, // 남의 미읽음 → 경계
    ]
    expect(firstUnreadMessageId(messages, 2, 5)).toBe(4)
  })

  it('currentUserId 미지정 시 author 필터를 건너뛴다(하위호환)', () => {
    expect(firstUnreadMessageId(msgs(1, 2, 3), 2)).toBe(3)
  })
})

describe('unreadFromOthersCount', () => {
  it('watermark 초과 + 미삭제 + 남이 보낸 메시지 개수', () => {
    const messages = [
      { id: 1, authorId: 7 },
      { id: 2, authorId: 7 },
      { id: 3, authorId: 5 }, // 내 메시지 → 제외
      { id: 4, authorId: 7 }, // 남 → 카운트
      { id: 5, authorId: 7, deleted: true }, // 삭제 → 제외
    ]
    expect(unreadFromOthersCount(messages, 2, 5)).toBe(1)
  })

  it('내가 보낸 메시지뿐이면 0 (유령 캐치업 방지, #491)', () => {
    const messages = [
      { id: 1, authorId: 7 },
      { id: 2, authorId: 5, deleted: false },
    ]
    expect(unreadFromOthersCount(messages, 1, 5)).toBe(0)
  })

  it('watermark 가 null 이면 0', () => {
    expect(unreadFromOthersCount([{ id: 1, authorId: 7 }], null, 5)).toBe(0)
  })
})
