// WP-385 「AI가 정리한 기록」 — 메모리 카드의 안내 줄(지난 30일 횟수, 0이면 숨김), 기록 대화상자(날짜 묶음·문구·출처 링크·인피니트 스크롤),
// 항목 되돌리기(경로·목록 반영·409 토스트), 정리된 메모리 행의 메타 「AI가 정리」.
// 여기엔 시안 비교용 대화상자 캡처·취소선 계산 스타일·인피니트 스크롤(@layout)만 남는다. 안내 줄·묶음·문구·출처 링크·되돌리기(경로·포커스·409)·
// 기록 다시 읽기·행 메타·로딩/실패/다시 시도는 src/pages/settings/aiMemoryCard.test.tsx(화면 컴포넌트 테스트)가 지킨다.
import { memoryChange, memorySnap, mockMemoryChanges, openMemorySettings } from '../../fixtures/ai-memory-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

const SESSION = '11111111-2222-4333-8444-555555555555'

test.use({ timezoneId: 'Asia/Seoul' })
test.beforeEach(async ({ authenticatedPage: page }) => {
  // 2026-10-15(목) 12:00 KST — 오늘·어제·날짜 묶음을 고정한다.
  await page.clock.setFixedTime(new Date('2026-10-15T03:00:00Z'))
})

/** 시안과 같은 다섯 기록(최신순). */
const FIVE = [
  memoryChange(5, {
    memory: memorySnap(51, 'WP 프로젝트 배포 일을 맡고 있다'),
    source: { id: SESSION, title: '배포 순서 정리하고 체크리스트 만들기' },
  }),
  memoryChange(4, {
    action: 'MERGED',
    memory: memorySnap(41, '보고서·요약은 표로 정리한다'),
    before: [memorySnap(41, '주간 보고서는 표로'), memorySnap(42, '요약은 표 형식 선호')],
  }),
  memoryChange(3, {
    action: 'UPDATED',
    createdAt: '2026-10-14T09:10:00Z', // 어제 오후 6:10
    memory: memorySnap(31, '아침 회의는 10시'),
    before: [memorySnap(31, '아침 회의는 9시')],
  }),
  memoryChange(2, {
    action: 'DECAYED',
    createdAt: '2026-10-13T18:00:00Z', // 어제 오전 3:00
    memory: null,
    before: [memorySnap(21, '출장 중엔 메일 요약만 보여 준다')],
  }),
  memoryChange(1, {
    action: 'FORGOTTEN',
    createdAt: '2026-10-09T07:25:00Z', // 10월 9일 오후 4:25
    memory: null,
    before: [memorySnap(11, '회의록은 영어로 쓴다')],
    reason: '회의록은 한국어로 써 달라고 함',
    undoneAt: '2026-10-09T08:02:00Z', // 오후 5:02
  }),
]

test('기록 대화상자 — 지운 기록은 취소선으로 그리고 시안 비교용으로 캡처한다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockMemoryChanges(page, [FIVE])
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-cleanup-open').click()
  const dialog = page.getByTestId('ai-memory-cleanup-dialog')
  const items = dialog.getByTestId('memory-log-item')
  await expect(items).toHaveCount(5)
  // 계산된 스타일 — 클래스가 실제 취소선으로 그려지는지(vitest 는 클래스만 본다).
  await expect(items.nth(3).getByTestId('memory-log-content')).toHaveCSS('text-decoration-line', 'line-through')
  // 시안(wp385-*) 비교용 TC 캡처.
  await page.screenshot({ path: 'test-results/tc/ai-memory-cleanup/dialog.png' })
})

test('끝에 닿으면 다음 묶음을 cursor 로 받아 이어 그린다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const first = Array.from({ length: 30 }, (_, i) => memoryChange(100 - i))
  const second = Array.from({ length: 5 }, (_, i) => memoryChange(50 - i))
  const m = await mockMemoryChanges(page, [first, second])
  // 다음 묶음 요청(cursor 있음)만 센다 — 목록 tracker 에는 안내 줄의 횟수 요청(size=1)도 섞인다.
  const nextPages = trackRequests(
    page,
    'GET',
    (u) => u.pathname === '/api/v1/users/me/ai-memories/changes' && u.searchParams.get('cursor') != null,
  )
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-cleanup-open').click()
  const items = page.getByTestId('ai-memory-cleanup-dialog').getByTestId('memory-log-item')
  await expect(items).toHaveCount(30)
  expect(m.lists.lastUrl()?.searchParams.get('cursor')).toBeNull()

  await page.getByTestId('ai-memory-cleanup-sentinel').scrollIntoViewIfNeeded()
  await nextPages.waitFor()
  expect(nextPages.lastUrl()?.searchParams.get('cursor')).toBe('c1')
  expect(nextPages.lastUrl()?.searchParams.get('size')).toBe('30')
  await expect(items).toHaveCount(35)
})

test('기록 대화상자 로딩·실패 상태를 시안 비교용으로 캡처한다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockMemoryChanges(page, [FIVE])
  // 기록 목록(size=30) 요청만 붙들었다가 실패시킨다 — 안내 줄 횟수(size=1)는 목에 맡긴다.
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => (release = r))
  await page.route(
    (u) => u.pathname === '/api/v1/users/me/ai-memories/changes' && u.searchParams.get('size') !== '1',
    async (route) => {
      await gate
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'INTERNAL', message: '오류' }) })
    },
  )
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-cleanup-open').click()
  const dialog = page.getByTestId('ai-memory-cleanup-dialog')
  await expect(dialog.getByTestId('ai-memory-cleanup-loading')).toBeVisible()
  await page.screenshot({ path: 'test-results/tc/ai-memory-cleanup/dialog-loading.png' })
  release()
  await expect(dialog.getByTestId('ai-memory-cleanup-error')).toBeVisible()
  await page.screenshot({ path: 'test-results/tc/ai-memory-cleanup/dialog-error.png' })
})
