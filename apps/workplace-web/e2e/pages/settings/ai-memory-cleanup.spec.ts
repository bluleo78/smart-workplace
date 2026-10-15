// WP-385 「AI가 정리한 기록」 — 메모리 카드의 안내 줄(지난 30일 횟수, 0이면 숨김), 기록 대화상자(날짜 묶음·문구·출처 링크·인피니트 스크롤),
// 항목 되돌리기(경로·목록 반영·409 토스트), 정리된 메모리 행의 메타 「AI가 정리」.
import {
  memoryChange,
  memoryItem,
  memorySnap,
  mockAiMemories,
  mockMemoryChanges,
  openMemorySettings,
} from '../../fixtures/ai-memory-mock'
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

test('지난 30일 정리가 0번이면 안내 줄이 없다', async ({ authenticatedPage: page }) => {
  const lists = trackRequests(page, 'GET', '/api/v1/users/me/ai-memories/changes')
  await openMemorySettings(page)
  await lists.waitFor()
  await expect(page.getByTestId('ai-memory-toggle')).toBeVisible()
  await expect(page.getByTestId('ai-memory-cleanup-notice')).toHaveCount(0)
})

test('안내 줄의 기록 보기로 날짜 묶음·동작 문구·이전 내용·출처 링크를 본다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const m = await mockMemoryChanges(page, [FIVE])
  await openMemorySettings(page)
  const notice = page.getByTestId('ai-memory-cleanup-notice')
  await expect(notice).toContainText('지난 30일 동안 AI가 메모리를 5번 정리했어요')
  // 안내 줄은 한 건짜리 묶음(size=1)으로 횟수만 읽고, 기록 목록은 열기 전에는 받지 않는다.
  expect(m.lists.urls().map((u) => u.searchParams.get('size'))).toEqual(['1'])
  await page.getByTestId('ai-memory-cleanup-open').click()
  const dialog = page.getByTestId('ai-memory-cleanup-dialog')
  await expect(dialog.getByRole('heading', { name: 'AI가 정리한 기록' })).toBeVisible()
  await expect(dialog).toContainText('직접 추가했거나 고정한 메모리는 바꾸지 않아요')

  const groups = dialog.getByRole('region')
  await expect(groups).toHaveCount(3)
  // 묶음 이름은 제목(h3)을 가리켜 한 번만 읽힌다(aria-label 로 같은 말을 두 번 싣지 않는다).
  await expect(groups.first()).not.toHaveAttribute('aria-label')
  await expect(groups.first()).toHaveAttribute('aria-labelledby', /.+/)
  await expect(dialog.getByRole('region', { name: '오늘' }).getByTestId('memory-log-item')).toHaveCount(2)
  await expect(dialog.getByRole('region', { name: '어제' }).getByTestId('memory-log-item')).toHaveCount(2)
  await expect(dialog.getByRole('region', { name: '10월 9일 금요일' }).getByTestId('memory-log-item')).toHaveCount(1)

  const items = dialog.getByTestId('memory-log-item')
  await expect(items.nth(0).getByTestId('memory-log-label')).toHaveText('새로 기억함')
  await expect(items.nth(0)).toContainText('오전 11:40')
  await expect(items.nth(0).getByTestId('memory-log-source')).toHaveAttribute('href', `/?aiChat=${SESSION}`)
  await expect(items.nth(1).getByTestId('memory-log-label')).toHaveText('2개를 합침')
  await expect(items.nth(1).getByTestId('memory-log-details')).toContainText('합치기 전: 주간 보고서는 표로 · 요약은 표 형식 선호')
  await expect(items.nth(2).getByTestId('memory-log-label')).toHaveText('고침')
  await expect(items.nth(2).getByTestId('memory-log-details')).toContainText('이전: 아침 회의는 9시')
  await expect(items.nth(3).getByTestId('memory-log-label')).toHaveText('90일 동안 쓰지 않아 지움')
  await expect(items.nth(3).getByTestId('memory-log-content')).toHaveCSS('text-decoration-line', 'line-through')
  await expect(items.nth(4).getByTestId('memory-log-label')).toHaveText('대화와 맞지 않아 지움')
  await expect(items.nth(4).getByTestId('memory-log-details')).toContainText('회의록은 한국어로 써 달라고 함')
  // 되돌린 기록은 시각만 보이고 버튼이 없다. 처음부터 되돌린 기록에는 포커스를 옮기지 않는다.
  await expect(items.nth(4).getByTestId('memory-log-undone')).toHaveText('되돌림 · 오후 5:02')
  await expect(items.nth(4).getByTestId('memory-log-undone')).not.toBeFocused()
  await expect(items.nth(4).getByTestId('memory-log-undo')).toHaveCount(0)
  await expect(items.nth(0).getByTestId('memory-log-undo')).toBeVisible()
  // 「되돌리기」 버튼마다 무엇을 되돌리는지(동작 문구·내용)를 설명으로 잇는다 — 버튼 이름만으로는 항목을 가를 수 없다.
  await expect(items.nth(0).getByTestId('memory-log-undo')).toHaveAccessibleName('되돌리기')
  await expect(items.nth(0).getByTestId('memory-log-undo')).toHaveAccessibleDescription(
    '새로 기억함 WP 프로젝트 배포 일을 맡고 있다',
  )
  await expect(items.nth(2).getByTestId('memory-log-undo')).toHaveAccessibleDescription('고침 아침 회의는 10시')
  // 시안(wp385-*) 비교용 TC 캡처.
  await page.screenshot({ path: 'test-results/tc/ai-memory-cleanup/dialog.png' })
})

test('끝에 닿으면 다음 묶음을 cursor 로 받아 이어 그린다', async ({ authenticatedPage: page }) => {
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

test('되돌리면 그 기록의 경로로 요청하고 되돌림으로 바뀌며 메모리 목록을 다시 읽는다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [memoryItem(51, { content: 'WP 프로젝트 배포 일을 맡고 있다' })])
  const m = await mockMemoryChanges(page, [FIVE])
  const memoryLists = trackRequests(page, 'GET', '/api/v1/users/me/ai-memories')
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-cleanup-open').click()
  const first = page.getByTestId('ai-memory-cleanup-dialog').getByTestId('memory-log-item').first()
  const listsBefore = memoryLists.count()

  await first.getByTestId('memory-log-undo').click()
  await m.undos.waitFor()
  expect(m.undos.lastUrl()?.pathname).toBe('/api/v1/users/me/ai-memories/changes/5/undo')
  await expect(first.getByTestId('memory-log-undone')).toHaveText('되돌림 · 오후 12:00')
  await expect(first.getByTestId('memory-log-undo')).toHaveCount(0)
  // 버튼이 사라져도 포커스를 잃지 않는다 — 되돌림 표시로 옮겨 키보드·화면 낭독기 사용자가 결과를 듣고 이어 간다.
  await expect(first.getByTestId('memory-log-undone')).toBeFocused()
  await expect(page.getByText('되돌렸어요')).toBeVisible()
  await memoryLists.waitFor(listsBefore + 1)
})

test('그 뒤 바뀐 메모리면 409 를 토스트로 알리고 기록은 그대로다', async ({ authenticatedPage: page }) => {
  const m = await mockMemoryChanges(page, [FIVE])
  m.refuseNext(409, 'AI_MEMORY_CHANGED')
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-cleanup-open').click()
  const third = page.getByTestId('ai-memory-cleanup-dialog').getByTestId('memory-log-item').nth(2)
  const listsBefore = m.lists.count()
  await third.getByTestId('memory-log-undo').click()
  await expect(page.getByText('그 뒤에 메모리가 바뀌어 되돌릴 수 없어요')).toBeVisible()
  await expect(third.getByTestId('memory-log-undo')).toBeEnabled()
  await expect(third.getByTestId('memory-log-undone')).toHaveCount(0)
  // 거절은 기록이 서버와 어긋났다는 뜻이다 — 기록을 다시 읽어 맞춘다.
  await m.lists.waitFor(listsBefore + 1)
})

test('되돌리기가 거절된 항목이 다시 읽은 기록에서 되돌림으로 바뀌어도 포커스를 그리로 옮기지 않는다', async ({ authenticatedPage: page }) => {
  const m = await mockMemoryChanges(page, [FIVE])
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-cleanup-open').click()
  const third = page.getByTestId('ai-memory-cleanup-dialog').getByTestId('memory-log-item').nth(2)
  // 이 화면의 되돌리기는 거절되고, 그사이 다른 탭에서 같은 기록을 되돌렸다.
  m.refuseNext(409, 'AI_MEMORY_CHANGED')
  m.markUndone(3)
  const listsBefore = m.lists.count()
  await third.getByTestId('memory-log-undo').click()
  await expect(page.getByText('그 뒤에 메모리가 바뀌어 되돌릴 수 없어요')).toBeVisible()
  await m.lists.waitFor(listsBefore + 1)
  await expect(third.getByTestId('memory-log-undone')).toHaveText('되돌림 · 오후 12:00')
  // 이 화면의 되돌리기는 실패했다 — 성공했을 때만 옮기는 포커스를 다른 곳의 되돌림 때문에 빼앗지 않는다.
  await expect(third.getByTestId('memory-log-undone')).not.toBeFocused()
})

test('설정에서 메모리를 고정하거나 지우면 「AI가 정리한 기록」도 다시 읽는다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, [memoryItem(2, { content: '답은 존댓말로 한다' }), memoryItem(1, { content: '보고서는 표로' })])
  const m = await mockMemoryChanges(page, [FIVE])
  await openMemorySettings(page)
  await m.lists.waitFor()
  const listsBefore = m.lists.count()
  const row = (text: string) => page.getByTestId('ai-memory-row').filter({ hasText: text })

  await row('답은 존댓말로').getByTestId('ai-memory-pin').click()
  await mock.pins.waitFor()
  // 고정·지우기·고치기는 기록의 되돌리기 가능 여부와 안내 줄 숫자를 바꿀 수 있다 — 기록도 다시 읽는다.
  await m.lists.waitFor(listsBefore + 1)

  await row('보고서는 표로').getByTestId('ai-memory-delete').click()
  await mock.deletes.waitFor()
  await m.lists.waitFor(listsBefore + 2)
})

test('정리 뒤 그대로인 메모리 행은 메타가 「AI가 정리 · 날짜」, 아니면 그대로다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [
    memoryItem(2, { content: '보고서·요약은 표로 정리한다', cleanedAt: '2026-10-15T02:40:00Z', updatedAt: '2026-10-15T02:40:00Z' }),
    memoryItem(1, { content: '답은 존댓말로 한다', source: 'USER' }),
    memoryItem(3, { content: '이슈 목록은 표로 보여 준다' }),
  ])
  await openMemorySettings(page)
  const meta = (text: string) => page.getByTestId('ai-memory-row').filter({ hasText: text }).getByTestId('ai-memory-meta')
  await expect(meta('보고서·요약')).toContainText('AI가 정리 · 2026-10-15')
  await expect(meta('존댓말')).toContainText('직접 추가')
  await expect(meta('이슈 목록')).toContainText('AI가 저장')
})

test('첫 묶음을 받는 동안은 스켈레톤을, 실패하면 이유 문구와 다시 시도를 보이고 다시 시도하면 처음부터 다시 받는다', async ({ authenticatedPage: page }) => {
  const m = await mockMemoryChanges(page, [FIVE])
  // 기록 목록(size=30) 요청만 실패시키고 안내 줄 횟수(size=1)는 목에 맡긴다. 실패 뒤엔 풀고, 풀기 전엔 응답을 붙들어 로딩 상태를 본다.
  let failing = true
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => (release = r))
  await page.route(
    (u) => u.pathname === '/api/v1/users/me/ai-memories/changes' && u.searchParams.get('size') !== '1',
    async (route) => {
      if (!failing) return route.fallback()
      await gate
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'INTERNAL', message: '오류' }) })
    },
  )
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-cleanup-open').click()
  const dialog = page.getByTestId('ai-memory-cleanup-dialog')
  // 받는 중: 글자 대신 항목 모양 스켈레톤(스크린리더에는 상태 한 줄).
  await expect(dialog.getByTestId('ai-memory-cleanup-loading')).toBeVisible()
  await expect(dialog.getByTestId('ai-memory-cleanup-loading')).toHaveAccessibleName('기록을 불러오는 중')
  await expect(dialog).not.toContainText('불러오는 중…')
  await page.screenshot({ path: 'test-results/tc/ai-memory-cleanup/dialog-loading.png' })
  release()
  // 실패: 이유 문구 + 다시 시도.
  const error = dialog.getByTestId('ai-memory-cleanup-error')
  await expect(error).toContainText('기록을 불러오지 못했어요')
  await expect(error.getByRole('button', { name: '다시 시도' })).toBeVisible()
  await expect(dialog.getByTestId('ai-memory-cleanup-loading')).toHaveCount(0)
  await expect(dialog.getByTestId('memory-log-item')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/tc/ai-memory-cleanup/dialog-error.png' })

  // 다시 시도: 첫 묶음(cursor 없음)을 다시 받아 목록으로 바뀐다.
  failing = false
  const before = m.lists.count()
  await error.getByRole('button', { name: '다시 시도' }).click()
  await m.lists.waitFor(before + 1)
  expect(m.lists.lastUrl()?.searchParams.get('cursor')).toBeNull()
  await expect(dialog.getByTestId('memory-log-item')).toHaveCount(5)
  await expect(dialog.getByTestId('ai-memory-cleanup-error')).toHaveCount(0)
})
