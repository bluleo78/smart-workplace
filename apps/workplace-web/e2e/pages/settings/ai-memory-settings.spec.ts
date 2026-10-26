// WP-55 설정 > AI 비서 > 메모리 카드(데스크톱) — 위치·목록·배지·메타, 제자리 편집(카운트·300자 초과), 삭제 토스트 되돌리기, 직접 추가(빈 값·초과 비활성·종류),
// 모두 지우기 확인, 스위치 꺼짐(흐림 + 편집 가능), 빈 상태, 270개 주황·300개 가득 참, 저장 실패 토스트.
// WP-379: 범위 묶음(순서·소제목·묶음 카운트), 편집·추가의 범위, 가득 찬 범위.
// WP-380: 기한 표기, 만료 행(흐림·삭제 예정일·기한 연장·계속 기억), 편집·추가의 기한 고르기.
// WP-383: 고정 토글(맨 위·메타·10개면 막힘 + 툴팁·409 토스트), 20개 초과 검색칸, 행 인피니트 스크롤(처음 30행, 끝에 닿으면 +30).
// 여기엔 화면 배선(@wiring)·인피니트 스크롤·도구 줄 위치(@layout)·막힌 핀 툴팁 호버(@input)만 남는다. 편집·삭제·추가·스위치·빈 상태·가득 참·
// 잠금·범위·기한·고정·검색은 src/pages/settings/aiMemoryCard.test.tsx(화면 컴포넌트 테스트)가 지킨다.
import type { Page } from '@playwright/test'

import { memoryItem, mockAiMemories, openMemorySettings } from '../../fixtures/ai-memory-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { stableBox } from '../../fixtures/wait'

const rows = (page: Page) => page.getByTestId('ai-memory-row')

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
  await mockAiMemories(page, many(270))
  await openMemorySettings(page)
  await expect(page.getByTestId('ai-memory-group-count')).toHaveText('270 / 300')
  await expect(page.getByTestId('ai-memory-group-count')).toHaveClass(/text-warning-text/)
  await expect(page.getByTestId('ai-memory-add')).toBeEnabled()
  await expect(page.getByTestId('ai-memory-group-full')).toHaveCount(0)
  await expect(page.getByTestId('ai-memory-group-more')).toHaveCount(0)

  await expect(rows(page)).toHaveCount(30)
  // 목록 끝 sentinel 을 화면으로 가져오면 다음 30행이 이어진다.
  await page.getByTestId('ai-memory-sentinel').scrollIntoViewIfNeeded()
  await expect.poll(async () => await rows(page).count()).toBeGreaterThan(30)
  // 끝까지 내려가면 전부 그려지고 그 뒤로는 더 늘지 않는다.
  await expect
    .poll(async () => {
      await page.getByTestId('ai-memory-sentinel').scrollIntoViewIfNeeded()
      return await rows(page).count()
    })
    .toBe(270)
  await expect(page.getByTestId('ai-memory-group-more')).toHaveCount(0)
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
    await expect
      .poll(async () => {
        await page.getByTestId('ai-memory-sentinel').scrollIntoViewIfNeeded()
        return await rows(page).count()
      })
      .toBe(100)
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
