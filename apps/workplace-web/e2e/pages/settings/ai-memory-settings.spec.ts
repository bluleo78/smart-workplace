// WP-55 설정 > AI 비서 > 메모리 카드(데스크톱) — 위치·목록·배지·메타, 제자리 편집(카운트·300자 초과), 삭제 토스트 되돌리기, 직접 추가(빈 값·초과 비활성·종류),
// 모두 지우기 확인, 스위치 꺼짐(흐림 + 편집 가능), 빈 상태, 270개 주황·300개 가득 참, 저장 실패 토스트.
// WP-379: 범위 묶음(순서·소제목·묶음 카운트), 편집·추가의 범위, 가득 찬 범위.
// WP-380: 기한 표기, 만료 행(흐림·삭제 예정일·기한 연장·계속 기억), 편집·추가의 기한 고르기.
// WP-383: 고정 토글(맨 위·메타·10개면 막힘 + 툴팁·409 토스트), 20개 초과 검색칸, 행 인피니트 스크롤(처음 30행, 끝에 닿으면 +30).
// 여기엔 화면 배선(@wiring)·인피니트 스크롤·도구 줄 위치(@layout)·막힌 핀 툴팁 호버(@input)만 남는다. 편집·삭제·추가·스위치·빈 상태·가득 참·
// 잠금·범위·기한·고정·검색은 src/pages/settings/aiMemoryCard.test.tsx(화면 컴포넌트 테스트)가 지킨다.
// WP-1696: 행의 content-visibility:auto — 화면 안 행은 실제 높이, 휠로 내려 30행이 더 붙어도 이미 본 행의 자리가 그대로(@layout).
import type { Page } from '@playwright/test'

import { memoryItem, mockAiMemories, openMemorySettings } from '../../fixtures/ai-memory-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { stableBox } from '../../fixtures/wait'

const rows = (page: Page) => page.getByTestId('ai-memory-row')

/**
 * 인피니트 스크롤을 끝까지 내린다 — 한 poll 에 여러 묶음을 몰면 부하에서 10초를 넘기므로 30행 묶음마다 따로 기다린다(WP-1813).
 * 한 번에 두 묶음이 붙을 수 있어 이상(>=)으로 기다린다.
 */
async function scrollRowsTo(page: Page, total: number) {
  for (let target = 60; target < total + 30; target += 30) {
    const goal = Math.min(target, total)
    await expect
      .poll(async () => {
        await page.getByTestId('ai-memory-sentinel').scrollIntoViewIfNeeded()
        return await rows(page).count()
      })
      .toBeGreaterThanOrEqual(goal)
  }
  await expect(rows(page)).toHaveCount(total)
}

test('개인 비서·추천 질문 카드 아래에 최신순 목록과 배지·메타·카운트가 보인다', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [
    memoryItem(3, { kind: 'CONTEXT', content: '백엔드 팀이고 주로 WP 프로젝트를 본다', source: 'USER', updatedAt: '2026-10-13T12:00:00Z' }),
    memoryItem(2, { content: '이슈 목록은 짧은 목록으로 보여 준다', updatedAt: '2026-10-12T12:00:00Z' }),
  ])
  await openMemorySettings(page)
  const card = page.getByTestId('ai-memory-card')
  await expect(card).toContainText('대화에서 알려 준 선호·교정과 업무 맥락을 기억해 다음 대화에 반영해요. 나만 볼 수 있어요.')
  const suggestion = await stableBox(page.getByTestId('ai-suggestions-card'))
  const memory = await stableBox(card)
  const personal = await stableBox(page.getByText('개인 비서', { exact: true }))
  expect(suggestion.y).toBeGreaterThan(personal.y)
  expect(memory.y).toBeGreaterThan(suggestion.y + suggestion.height - 1)

  await expect(rows(page).getByTestId('ai-memory-content')).toHaveText([
    '백엔드 팀이고 주로 WP 프로젝트를 본다',
    '이슈 목록은 짧은 목록으로 보여 준다',
  ])
  await expect(rows(page).getByTestId('ai-memory-kind')).toHaveText(['맥락', '선호'])
  // 시안 배지 색 — 선호는 AI 보라(ai), 맥락은 info.
  await expect(rows(page).nth(0).getByTestId('ai-memory-kind')).toHaveAttribute('data-variant', 'info')
  await expect(rows(page).nth(1).getByTestId('ai-memory-kind')).toHaveAttribute('data-variant', 'ai')
  await expect(rows(page).nth(0).getByTestId('ai-memory-meta')).toHaveText('직접 추가 · 2026-10-13')
  await expect(rows(page).nth(1).getByTestId('ai-memory-meta')).toHaveText('AI가 저장 · 2026-10-12')
  await expect(page.getByTestId('ai-memory-group-count')).toHaveText('2 / 300')
  await expect(page.getByTestId('ai-memory-group-title')).toHaveText('공통 · 모든 AI 대화에 반영돼요')
  await expect(page.getByTestId('ai-memory-toggle')).toHaveAttribute('aria-checked', 'true')
})

const many = (n: number) => Array.from({ length: n }, (_, i) => memoryItem(n - i))

test('270개면 묶음 카운트가 주황이고 추가는 된다 — 행은 처음 30개만 그리고 끝에 닿으면 30개씩 더 그린다(더 보기 버튼 없음)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // 묶음 8개를 끝까지 내리느라 부하에서 기본 테스트 시간(30초)이 빠듯하다(WP-1813).
  test.slow()
  await mockAiMemories(page, many(270))
  await openMemorySettings(page)
  await expect(page.getByTestId('ai-memory-group-count')).toHaveText('270 / 300')
  await expect(page.getByTestId('ai-memory-group-count')).toHaveClass(/text-warning-text/)
  await expect(page.getByTestId('ai-memory-add')).toBeEnabled()
  await expect(page.getByTestId('ai-memory-group-full')).toHaveCount(0)
  await expect(page.getByTestId('ai-memory-group-more')).toHaveCount(0)

  await expect(rows(page)).toHaveCount(30)
  await scrollRowsTo(page, 270)
  await expect(page.getByTestId('ai-memory-group-more')).toHaveCount(0)
})

test('행은 화면 밖이면 배치를 건너뛰되(content-visibility) 화면 안에선 실제 높이이고, 스크롤해 30행이 더 붙어도 이미 본 행의 자리가 그대로다 (WP-1696)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // 세 행마다 여러 줄로 접히는 긴 내용 — 자리값(56px)과 실제 높이가 달라야 「한 번 그린 높이 기억(auto)」이 깨진 것을 가릴 수 있다.
  const items = Array.from({ length: 300 }, (_, i) =>
    memoryItem(300 - i, i % 3 === 0 ? { content: `긴 메모리 ${300 - i} ` + '여러 줄로 접히는 아주 긴 내용입니다. '.repeat(12) } : {}),
  )
  await mockAiMemories(page, items)
  await openMemorySettings(page)
  await expect(rows(page)).toHaveCount(30)
  // 행마다 content-visibility:auto — 화면 밖 행은 배치·그리기를 건너뛴다(1,800행에서 지운 뒤 멈춤을 줄이는 핵심).
  expect(await rows(page).first().evaluate((el) => getComputedStyle(el).contentVisibility)).toBe('auto')

  // 화면 안의 긴 행은 자리값(56px)이 아니라 내용대로 커진다 — 메타 줄까지 행 안에 들어간다.
  const fits = await rows(page).first().evaluate((li) => {
    const r = li.getBoundingClientRect()
    const meta = li.querySelector('[data-testid="ai-memory-meta"]')!.getBoundingClientRect()
    return { height: r.height, metaInside: meta.bottom <= r.bottom + 0.5 }
  })
  expect(fits.height).toBeGreaterThan(56)
  expect(fits.metaInside).toBe(true)

  // 목록 안에서의 행 위치(목록 위 끝 기준 — 스크롤과 무관). 보이는지는 설정 본문 스크롤 컨테이너(SettingsPage 의 page-body,
  // useSettingsScrollRoot 가 sentinel root 로 쓰는 요소)의 사각형으로 가린다 — 창(window)은 스크롤하지 않는다.
  const list = page.getByTestId('ai-memory-group-list')
  const visibleOffsets = () =>
    list.evaluate((ul) => {
      const view = ul.closest('[data-testid="page-body"]')!.getBoundingClientRect()
      const top = ul.getBoundingClientRect().top
      const out: Record<string, number> = {}
      ul.querySelectorAll('[data-testid="ai-memory-row"]').forEach((li, i) => {
        const r = li.getBoundingClientRect()
        if (r.bottom > view.top && r.top < view.bottom) out[i] = r.top - top
      })
      return out
    })
  // 휠 뒤 스크롤 컨테이너의 scrollTop 이 연달아 3프레임 그대로일 때까지 기다린다(휠 스크롤·스크롤 앵커링이 끝난 뒤 잰다).
  const settle = () =>
    list.evaluate(
      (ul) =>
        new Promise<void>((resolve) => {
          const sc = ul.closest('[data-testid="page-body"]')!
          let last = -1
          let same = 0
          const tick = () => {
            same = sc.scrollTop === last ? same + 1 : 0
            last = sc.scrollTop
            if (same >= 3) resolve()
            else requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        }),
    )
  // sentinel 이 observer 의 선행 여유(rootMargin 200px) 안에 들어왔는가 — 들어왔으면 30행이 더 붙을 차례다.
  const sentinelNear = () =>
    page.getByTestId('ai-memory-sentinel').evaluate((s) => {
      const view = s.closest('[data-testid="page-body"]')!.getBoundingClientRect()
      return s.getBoundingClientRect().top < view.bottom + 200
    })
  // 휠 한 번 → 스크롤이 멈출 때까지 → (sentinel 이 닿았으면) 행이 늘 때까지 → 다시 멈출 때까지 기다린 뒤 보인 행의 자리를 처음 본 값으로 적는다.
  const seen: Record<string, number> = {}
  const wheelAndRecord = async () => {
    const before = await rows(page).count()
    await page.mouse.wheel(0, 300)
    await settle()
    if (before < 60 && (await sentinelNear())) {
      await expect.poll(async () => await rows(page).count()).toBeGreaterThan(before)
      await settle()
    }
    Object.assign(seen, { ...(await visibleOffsets()), ...seen })
  }

  // 사람처럼 휠로 조금씩 내린다 — sentinel 이 보여 30행이 더 붙을 때까지, 그 뒤로도 조금 더.
  const body = await stableBox(page.getByTestId('page-body').filter({ has: list }))
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2)
  for (let step = 0; step < 60 && (await rows(page).count()) < 60; step++) await wheelAndRecord()
  await expect(rows(page)).toHaveCount(60)
  for (let step = 0; step < 4; step++) await wheelAndRecord()
  // 이미 본 행(지금은 대부분 화면 위로 나갔다)의 자리가 처음 본 그대로다 — 화면 밖으로 나간 행이 자리값으로 줄면 아래 행이 모두 끌려 올라간다.
  const now = await list.evaluate((ul) => {
    const top = ul.getBoundingClientRect().top
    return Array.from(ul.querySelectorAll('[data-testid="ai-memory-row"]'), (li) => li.getBoundingClientRect().top - top)
  })
  expect(Object.keys(seen).length).toBeGreaterThan(30)
  const moved = Object.entries(seen).filter(([i, offset]) => Math.abs(now[Number(i)] - offset) >= 1)
  expect(moved).toEqual([])
})

test.describe('고정·검색 (WP-383)', () => {
  test('범위 고정이 10개면 고정 안 된 행의 핀이 막히고 툴팁으로 이유를 알린다 — 고정 풀기는 된다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const pinnedTen = Array.from({ length: 10 }, (_, i) => memoryItem(20 - i, { pinned: true, content: `고정 ${i}` }))
    const mock = await mockAiMemories(page, [...pinnedTen, memoryItem(5, { content: '보통' })])
    await openMemorySettings(page)
    const plain = rows(page).filter({ hasText: '보통' })
    const blocked = plain.getByTestId('ai-memory-pin')
    // 막힌 핀도 이름 있는 버튼(aria-disabled)이라 읽기 도구가 이유(툴팁 설명)를 듣는다. 흐림(opacity)은 겹치지 않는다.
    await expect(blocked).toHaveAttribute('aria-disabled', 'true')
    await expect(blocked).toHaveAccessibleName('고정')
    expect(await blocked.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    await blocked.hover()
    await expect(page.getByRole('tooltip')).toHaveText('이 범위는 고정이 10개까지예요')
    // 눌러도 요청하지 않는다 — aria-disabled 라 Playwright click 은 기다리기만 하므로 그 자리를 마우스로 직접 누른다.
    await blocked.scrollIntoViewIfNeeded()
    const box = await stableBox(blocked)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    expect(mock.pins.count()).toBe(0)
    await expect(rows(page).nth(0).getByTestId('ai-memory-pin')).toBeEnabled()
    await expect(rows(page).nth(0).getByTestId('ai-memory-pin')).toHaveAccessibleName('고정')
  })

  test('질의를 바꾸면 인피니트 스크롤이 처음 30행으로 돌아간다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockAiMemories(page, many(100))
    await openMemorySettings(page)
    await expect(rows(page)).toHaveCount(30)
    await scrollRowsTo(page, 100)
    // "메모리" 는 모든 행에 맞는다 — 질의가 바뀌면 다시 30행부터.
    await page.getByTestId('ai-memory-search').fill('메모리')
    await expect(rows(page)).toHaveCount(30)
  })

  test('키 큰 화면에서는 스크롤하지 않아도 sentinel 이 보이는 동안 계속 30행씩 더 그린다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    // 100행(약 5,000px)이 한 화면에 다 들어가는 높이 — 교차 이벤트가 다시 오지 않아도 observer 가 다시 붙어 이어서 늘어야 한다.
    await page.setViewportSize({ width: 1280, height: 7000 })
    await mockAiMemories(page, many(100))
    await openMemorySettings(page)
    await expect(rows(page)).toHaveCount(100)
  })

  test('직접 추가·모두 지우기는 목록 위 도구 줄에 있어 행이 늘어도 밀려나지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockAiMemories(page, many(100))
    await openMemorySettings(page)
    const add = await page.getByTestId('ai-memory-add').boundingBox()
    const clear = await page.getByTestId('ai-memory-clear').boundingBox()
    const firstRow = await rows(page).first().boundingBox()
    expect(add!.y).toBeLessThan(firstRow!.y)
    expect(clear!.y).toBeLessThan(firstRow!.y)
    // 검색칸과 같은 줄이다.
    const search = await page.getByTestId('ai-memory-search').boundingBox()
    expect(Math.abs(add!.y + add!.height / 2 - (search!.y + search!.height / 2))).toBeLessThan(4)
  })
})
