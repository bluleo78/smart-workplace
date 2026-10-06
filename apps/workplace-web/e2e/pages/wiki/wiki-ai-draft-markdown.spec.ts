// 노트 AI 생성 결과의 마크다운 렌더 회귀(WP-255).
//
// 배경: 생성 계열 액션(초안·요약·이어쓰기)이 토큰마다 insertContent 를 호출해, tiptap-markdown 이 조각마다
// 따로 파싱했다 — `**목` / `적**` 처럼 쪼개진 굵게는 기호가 그대로 남고, 표 행은 `|` 텍스트로 깨지고,
// `- ` 가 목록 안 커서에서 다시 파싱돼 목록이 계단식으로 중첩됐다. 또 모델이 페이지 제목을 H1 으로 반복했다.
// 지금은 완료 시 한 번에 삽입하므로, 토큰 경계에서 일부러 쪼갠 델타로 스텁해 최종 렌더를 단언한다.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'
import { buildWikiAiSse, lastSaved, mockWikiPageEditor } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 310
const TITLE = 'AI 대상 페이지'

// 모델이 실제로 내놓는 모양의 초안 — 제목 H1 반복 + 굵게 + 표 + 2단 목록 + 여러 섹션.
const DRAFT_MARKDOWN = [
  `# ${TITLE}`,
  '',
  '## 개요',
  '',
  '이 문서의 **목적**은 4분기 출시 계획과 담당자를 한눈에 정리하는 것이다.',
  '',
  '## 일정',
  '',
  '| 단계 | 담당 | 기한 |',
  '|---|---|---|',
  '| 설계 | 김민수 | 10/12 |',
  '| 구현 | 이지은 | 10/26 |',
  '',
  '## 예시 코드',
  '',
  '```ts',
  'if (ready) {',
  '  launch()',
  '',
  '  notify()',
  '}',
  '```',
  '',
  '## 할 일',
  '',
  '- 상위 항목 하나',
  '  - 하위 항목',
  '- 상위 항목 둘',
  '- 상위 항목 셋',
  '',
].join('\n')

// LLM 토큰처럼 3글자씩 쪼갠다 — `**목`/`적**`, 표 행 중간, `- 상위\n` 직후 등 문제 경계를 모두 지난다.
function splitIntoTokens(text: string, size = 3): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

/**
 * AI 시작 POST(correlationId) + /events(SSE) 를 모킹한다. /events 는 앱 마운트 시 1회 연결되므로
 * 시작 POST 가 올 때까지 보류했다가 그 correlationId 로 델타를 흘린다(wiki-ai.spec 과 같은 패턴).
 * done=false 면 생성 중인 채로 끝낸다(진행 표시 검증용).
 */
async function mockAiStream(page: Page, deltas: string[], done = true) {
  const starts = trackRequests(page, 'POST', /^\/api\/v1\/wiki\/pages\/[^/]+\/ai$/)
  let resolveStarted: (id: string) => void
  const started = new Promise<string>((r) => {
    resolveStarted = r
  })
  await page.route('**/api/v1/wiki/pages/*/ai', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const correlationId = 'corr-draft'
    resolveStarted(correlationId)
    return route.fulfill({ json: { correlationId } })
  })
  await page.route('**/api/v1/wiki/pages/*/ai/*', (route) =>
    route.request().method() === 'DELETE' ? route.fulfill({ json: {} }) : route.fallback(),
  )
  await page.route('**/api/v1/events', async (route) => {
    const correlationId = await started
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: buildWikiAiSse(deltas, correlationId, done),
    })
  })
  return starts
}

/** 빈 페이지 CTA → 토픽 입력 → 초안 생성 시작. */
async function startDraft(page: Page) {
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await page.getByTestId('wiki-ai-empty-draft').click()
  await page.getByRole('dialog').getByRole('textbox').fill('4분기 출시 계획')
  await page.getByTestId('rename-dialog-confirm').click()
}

test('노트 AI 초안 — 토큰 경계로 쪼개진 표·굵게·2단 목록이 실제 서식으로 렌더되고 제목 H1 은 빠진다 (WP-255)', async ({
  authenticatedPage: page,
}) => {
  const puts = await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: '' })
  const starts = await mockAiStream(page, splitIntoTokens(DRAFT_MARKDOWN))

  await startDraft(page)
  await expect.poll(() => starts.lastBody<{ action: string }>()?.action).toBe('draft')

  const editor = page.locator('.ProseMirror')
  // 표 — 1개, 셀 텍스트가 칸별로 들어간다.
  await expect(editor.locator('table')).toHaveCount(1)
  await expect(editor.locator('table tr')).toHaveCount(3)
  await expect(editor.locator('table tr').nth(1).locator('td').first()).toHaveText('설계')
  await expect(editor.locator('table tr').nth(2).locator('td').nth(1)).toHaveText('이지은')
  // 굵게 — strong 노드로 적용되고 기호는 남지 않는다.
  await expect(editor.locator('strong')).toHaveText('목적')
  const text = (await editor.textContent()) ?? ''
  expect(text).not.toContain('**')
  expect(text).not.toContain('|')
  expect(text).not.toContain('---')
  // 목록 — 최상위 3개 + 하위 1개(계단식 중첩이면 하위 깊이가 늘어난다).
  await expect(editor.locator(':scope > ul > li')).toHaveCount(3)
  await expect(editor.locator(':scope > ul > li > ul > li')).toHaveCount(1)
  await expect(editor.locator('ul ul ul')).toHaveCount(0)
  // 하위 목록을 가진 항목 문단에 줄바꿈 글자가 남지 않는다(남으면 하위 목록 위에 빈 줄이 보인다).
  // toHaveText 는 공백을 정규화하므로 textContent 원문으로 비교한다.
  expect(await editor.locator(':scope > ul > li').first().locator(':scope > p').evaluate((p) => p.textContent)).toBe(
    '상위 항목 하나',
  )
  // 제목 — 페이지 제목과 같은 H1 은 제거되고 섹션 H2 는 남는다.
  await expect(editor.locator('h1')).toHaveCount(0)
  await expect(editor.locator('h2')).toHaveText(['개요', '일정', '예시 코드', '할 일'])
  // 코드 블록 — 공백 정규화 파싱(preserveWhitespace=false)에서도 줄바꿈·빈 줄·들여쓰기가 보존된다.
  expect(await editor.locator('pre').evaluate((el) => el.textContent)).toBe('if (ready) {\n  launch()\n\n  notify()\n}')

  // 저장 파이프라인 — 자동저장된 마크다운에도 서식이 보존된다.
  await expect.poll(() => lastSaved(puts)).toContain('**목적**')
  const saved = lastSaved(puts)
  expect(saved).toMatch(/^\|\s*설계\s*\|\s*김민수\s*\|/m)
  expect(saved).not.toContain(`# ${TITLE}`)
})

test('노트 AI 초안 — 생성 중엔 진행 표시만 보이고 본문엔 부분 결과가 들어가지 않으며, 취소하면 버려진다 (WP-255)', async ({
  authenticatedPage: page,
}) => {
  await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: '' })
  // done 없이 델타만 — 생성이 진행 중인 상태로 멈춘다.
  await mockAiStream(page, splitIntoTokens(DRAFT_MARKDOWN), false)

  await startDraft(page)
  await expect(page.getByTestId('wiki-ai-busy')).toBeVisible()
  // 데스크톱 헤더 AI 버튼도 '생성 중…' 으로 바뀐다(모바일은 헤더 스피너 wiki-ai-header-busy).
  await expect(page.getByTestId('wiki-ai-header-button')).toContainText('생성 중')
  const editor = page.locator('.ProseMirror')
  await expectStays(page, async () => ((await editor.textContent()) ?? '').trim(), '')

  // 취소 — 진행 표시가 사라지고 받은 부분 결과는 삽입되지 않는다(변형 액션과 같은 정책).
  await page.getByTestId('wiki-ai-cancel').click()
  await expect(page.getByTestId('wiki-ai-busy')).toHaveCount(0)
  await expectStays(page, async () => ((await editor.textContent()) ?? '').trim(), '')
})
