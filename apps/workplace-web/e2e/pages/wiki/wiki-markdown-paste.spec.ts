// 노트 에디터 마크다운 붙여넣기 E2E (#753) — transformPastedText 미설정으로 '## 제목' 이
// 평문으로 들어가던 결함을 막는다. text/plain 만 실어야 변환 경로를 탄다(text/html 이 함께
// 있으면 ProseMirror 가 HTML 파싱으로 분기한다 — parseFromClipboard 의 asText 조건).
import type { Page } from '@playwright/test'

import type { WikiPageDetail } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const PAGE_ID = 310

const saved: string[] = []

async function setup(page: Page, body: string) {
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: SPACE_ID, type: 'PERSONAL', name: '내 노트', ownerId: 1, role: 'OWNER', createdAt: '2026-06-01T00:00:00Z' }]) })
      : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: PAGE_ID, parentId: null, title: '붙여넣기', position: 0, aiLastUsedAt: null }]) })
      : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/members`, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/pages/${PAGE_ID}`, (r) => {
    const d: WikiPageDetail = { id: PAGE_ID, spaceId: SPACE_ID, parentId: null, title: '붙여넣기', body, version: 1, updatedBy: 1, updatedAt: '2026-06-01T00:00:00Z', aiLastUsedAt: null, aiLastAction: null }
    const m = r.request().method()
    if (m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) })
    if (m === 'PUT') {
      saved.push((r.request().postDataJSON() as { body: string }).body)
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...d, version: 2 }) })
    }
    return r.fallback()
  })
}

/**
 * text/plain 만 담은 paste 이벤트를 에디터에 디스패치한다.
 * ProseMirror 는 DOM 이벤트를 직접 듣기 때문에 contenteditable 에서 bubbles:true 로 쏴야 하고,
 * 선택(selection)이 잡혀 있어야 삽입 위치가 정해진다 → 호출 전 반드시 클릭으로 포커스를 준다.
 */
async function pastePlainText(page: Page, text: string) {
  await page.locator('.ProseMirror').evaluate((el, t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

test('스파이크 — 합성 paste 가 마크다운으로 변환된다', async ({ authenticatedPage: page }) => {
  saved.length = 0
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await pastePlainText(page, '## 붙여넣은 제목')

  await expect(page.locator('.ProseMirror h2')).toHaveText('붙여넣은 제목')
})

test('마크다운 블록이 서식으로 변환되고 저장 payload 로 왕복한다', async ({ authenticatedPage: page }) => {
  saved.length = 0
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await pastePlainText(page, [
    '## 분기 지표',
    '',
    '- 첫째',
    '- 둘째',
    '',
    '| 항목 | 값 |',
    '| --- | --- |',
    '| 활성 사용자 | 1,850 |',
  ].join('\n'))

  // 1) 블록 요소로 렌더되는가
  const ed = page.locator('.ProseMirror')
  await expect(ed.locator('h2')).toHaveText('분기 지표')
  await expect(ed.locator('ul > li')).toHaveCount(2)
  await expect(ed.locator('ul > li').first()).toHaveText('첫째')
  await expect(ed.locator('table th')).toHaveCount(2)
  await expect(ed.locator('table td').first()).toHaveText('활성 사용자')

  // 2) 자동저장(800ms 디바운스) payload 가 마크다운으로 되돌아가는가 — 라운드트립 무손실.
  await expect.poll(() => saved.length, { timeout: 5000 }).toBeGreaterThan(0)
  const body = saved[saved.length - 1]
  expect(body).toContain('## 분기 지표')
  expect(body).toContain('- 첫째')
  expect(body).toContain('| 활성 사용자 |')
})

// 주의: 이 테스트는 `transformPastedText` 스위치를 꺼도(되돌려도) 그대로 통과한다 — 그 기능
// 자체의 회귀는 잡지 못한다는 뜻이다. 이 테스트가 실제로 지키는 것은 ProseMirror 의 "코드블록
// 예외 분기"(selection 이 codeBlock 안이면 clipboardTextParser/변환 훅 호출 전에 평문으로
// 단락시키는 동작)다. 즉 코드블록 안까지 마크다운 변환이 침범하는 회귀를 잡는 테스트이며,
// 메인 스위치(마크다운 붙여넣기 변환 자체)를 지키는 것은 나머지 3건이다.
test('코드블록 예외 — 코드블록 안에서는 평문으로 남는다', async ({ authenticatedPage: page }) => {
  saved.length = 0
  // 코드블록이 이미 있는 본문에서 시작 — ProseMirror 가 inCode 를 clipboardTextParser 호출
  // 전에 단락시키는지 확인한다(별도 handlePaste 를 짜지 않은 근거).
  await setup(page, '```\n기존 코드\n```')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror pre code')).toBeVisible()

  // 코드블록 안을 클릭하면 selection 의 parent 가 codeBlock 이 되고, 그것만으로 inCode 가 성립한다.
  await page.locator('.ProseMirror pre code').click()
  await pastePlainText(page, '\n## 제목은 아니다')

  await expect(page.locator('.ProseMirror pre code')).toContainText('## 제목은 아니다')
  await expect(page.locator('.ProseMirror h2')).toHaveCount(0)
})

test('평문 HTML 은 렌더된다 (수용된 동작 고정)', async ({ authenticatedPage: page }) => {
  // 의도적으로 이 동작을 고정한다. markdown-it 의 html:true 때문에 평문 HTML 이 렌더되는데,
  // 이를 Markdown.configure({html:false}) 로 "고치면" 기존 페이지에 raw HTML 로 저장된 표(#742
  // 폴백 경로)의 로드가 깨진다. 즉 버그가 아니라 감수한 트레이드오프다 — 이 테스트가 깨지면
  // 스펙 §3.4 를 먼저 읽을 것.
  saved.length = 0
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await pastePlainText(page, '<b>굵게</b>')

  await expect(page.locator('.ProseMirror strong')).toHaveText('굵게')
})
