// WP-135 — 모바일 채팅 목록 행: 마지막 메시지 미리보기·시간·미리보기 굵게 강조.
import { expect, test } from '../../fixtures/auth.fixture'
import { createChannel, createDm, createDmParticipant, createLastMessage } from '../../factories/messaging.factory'
import { expectNoHorizontalOverflow, stubChat } from '../../fixtures/mobile.fixture'

const ME = 1 // auth.fixture 의 로그인 사용자 id (createUser 기본 id = 1)

test('미리보기·시간이 보이고 미읽음 행은 굵다', async ({ authenticatedPage: page }) => {
  await stubChat(page, {
    channels: [
      createChannel({ id: 1, name: 'general', unreadCount: 3,
        lastMessage: createLastMessage({ authorId: 2, authorName: '김철수', preview: '점심 같이 드실 분' }) }),
      createChannel({ id: 3, name: 'backend-dev', unreadCount: 0,
        lastMessage: createLastMessage({ authorId: ME, authorName: '나', preview: '배포 확인', createdAt: '2025-12-03T05:00:00Z' }) }),
      createChannel({ id: 4, name: 'random', unreadCount: 0, lastMessage: null }),
    ],
    dms: [
      createDm({ id: 10, unreadCount: 1,
        participants: [createDmParticipant({ userId: ME, name: '나' }), createDmParticipant({ userId: 2, name: '박민수' })],
        lastMessage: createLastMessage({ authorId: 2, authorName: '박민수', preview: 'PR 리뷰 부탁드려요' }) }),
    ],
  })
  await page.goto('/chat')
  const list = page.getByTestId('mobile-module-list')

  await expect(list.getByTestId('conv-preview-1')).toHaveText('김철수: 점심 같이 드실 분')
  await expect(list.getByTestId('conv-time-1')).toHaveText(/^오(전|후) \d{1,2}:\d{2}$/)
  await expect(list.getByTestId('conv-preview-3')).toHaveText('나: 배포 확인')
  await expect(list.getByTestId('conv-time-3')).toHaveText('2025. 12. 3.')
  await expect(list.getByTestId('conv-preview-4')).toHaveText('아직 메시지가 없습니다')
  await expect(list.getByTestId('conv-preview-10')).toHaveText('PR 리뷰 부탁드려요') // 1:1 상대 → 접두 없음

  // 미읽음 행: 이름 굵게 + 배지. 읽은 행: 보통 굵기.
  const weight = (id: string) => list.getByTestId(id).evaluate((el) => Number(getComputedStyle(el).fontWeight))
  expect(await weight('conv-name-1')).toBeGreaterThanOrEqual(600)
  await expect(list.getByTestId('channel-unread-1')).toHaveText('3')
  expect(await weight('conv-name-3')).toBeLessThan(600)
  expect(await weight('conv-name-10')).toBeGreaterThanOrEqual(600)

  // 시간은 배지 유무와 무관하게 이름 줄과 같은 높이(상단 정렬).
  for (const id of ['1', '3']) {
    const t = (await list.getByTestId(`conv-time-${id}`).boundingBox())!
    const n = (await list.getByTestId(`conv-name-${id}`).boundingBox())!
    expect(Math.abs(t.y - n.y), `conv-time-${id}`).toBeLessThanOrEqual(4)
  }

  // 행 높이 56px 이상.
  expect((await list.getByTestId('channel-link-1').boundingBox())!.height).toBeGreaterThanOrEqual(56)
  await expectNoHorizontalOverflow(page)
})

test('긴 데이터 말줄임 — 이름·미리보기는 잘리고 시간·배지는 보인다', async ({ authenticatedPage: page }) => {
  const longName = 'smart-workplace-모바일-개선-태스크포스-2026-하반기-로드맵-정리'
  const longPreview = '가'.repeat(120)
  await stubChat(page, {
    channels: [createChannel({ id: 1, name: longName, unreadCount: 150,
      lastMessage: createLastMessage({ authorName: '아주긴이름의작성자님', preview: longPreview }) })],
  })
  await page.goto('/chat')
  const list = page.getByTestId('mobile-module-list')
  await expect(list.getByTestId('channel-unread-1')).toHaveText('99+')
  const row = (await list.getByTestId('channel-link-1').boundingBox())!
  for (const id of ['conv-time-1', 'channel-unread-1']) {
    const b = (await list.getByTestId(id).boundingBox())!
    expect(b.x + b.width, id).toBeLessThanOrEqual(row.x + row.width) // 행 밖으로 밀려나지 않음
  }
  const overflowed = (id: string) => list.getByTestId(id).evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(await overflowed('conv-name-1')).toBe(true) // 말줄임 적용(잘림)
  expect(await overflowed('conv-preview-1')).toBe(true)
  await expectNoHorizontalOverflow(page)
})

test('셀프 DM 미리보기 — 나뿐인 DM 의 마지막 메시지를 "나: " 로', async ({ authenticatedPage: page }) => {
  await stubChat(page, {
    dms: [createDm({ id: 20, participants: [createDmParticipant({ userId: ME, name: '나' })],
      lastMessage: createLastMessage({ authorId: ME, preview: '메모: 우유 사기' }) })],
  })
  await page.goto('/chat')
  await expect(page.getByTestId('mobile-module-list').getByTestId('conv-preview-self')).toHaveText('나: 메모: 우유 사기')
})
