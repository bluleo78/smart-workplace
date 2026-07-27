// 노트 에디터 표 조작 UI E2E — 툴바/우클릭/단축키 세 경로와 마크다운 라운드트립.
// 요소 존재만 보는 단언으로는 "눌리는데 저장이 안 되는" 결함을 못 잡으므로,
// 저장 payload 의 GFM 표를 직접 단언한다.
import type { Page } from '@playwright/test'

import type { WikiPageDetail, WikiRole } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const PAGE_ID = 300
const TABLE_MD = [
  '| 항목 | 담당 |',
  '| --- | --- |',
  '| API 설계 | 김 |',
  '| 배포 | 이 |',
].join('\n')

const saved: string[] = []

async function setup(page: Page, body: string, role: WikiRole = 'OWNER') {
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: SPACE_ID, type: 'PERSONAL', name: '내 노트', ownerId: 1, role, createdAt: '2026-06-01T00:00:00Z' }]) })
      : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: PAGE_ID, parentId: null, title: '표', position: 0, aiLastUsedAt: null }]) })
      : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/members`, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/pages/${PAGE_ID}`, (r) => {
    const d: WikiPageDetail = { id: PAGE_ID, spaceId: SPACE_ID, parentId: null, title: '표', body, version: 1, updatedBy: 1, updatedAt: '2026-06-01T00:00:00Z', aiLastUsedAt: null, aiLastAction: null }
    const m = r.request().method()
    if (m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) })
    if (m === 'PUT') {
      saved.push((r.request().postDataJSON() as { body: string }).body)
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...d, version: 2 }) })
    }
    return r.fallback()
  })
}

/** 마지막 저장 payload 에서 파이프로 시작하는 줄만 뽑는다. */
async function savedTableLines(page: Page): Promise<string[]> {
  await expect.poll(() => saved.length, { timeout: 5000 }).toBeGreaterThan(0)
  return saved[saved.length - 1].split('\n').filter((l) => l.trim().startsWith('|'))
}

test('툴바 — 커서가 표 안에 있을 때만 뜨고, 열 추가가 마크다운까지 반영된다', async ({
  authenticatedPage: page,
}) => {
  saved.length = 0
  await setup(page, TABLE_MD)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  // 표 밖(제목 입력 전 본문 끝)에서는 툴바가 없다.
  await expect(page.getByTestId('wiki-table-toolbar')).toHaveCount(0)

  // 본문 셀에 커서를 두면 툴바가 뜬다.
  await page.locator('.ProseMirror td').first().click()
  const toolbar = page.getByTestId('wiki-table-toolbar')
  await expect(toolbar).toBeVisible()

  // 툴바는 셀이 아니라 표 상단에 앵커된다 — 툴바 하단이 표 상단보다 위여야 한다.
  const tableBox = (await page.locator('.ProseMirror table').boundingBox())!
  const barBox = (await toolbar.boundingBox())!
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(tableBox.y + 1)

  // 오른쪽에 열 삽입 → 3열
  await toolbar.getByTestId('wiki-table-cmd-addColumnAfter').click()
  await expect(page.locator('.ProseMirror table th')).toHaveCount(3)

  // 저장 payload 가 3열 GFM 표인가 — 구분 행의 --- 개수로 판정한다.
  await page.locator('.ProseMirror td').first().click()
  await page.keyboard.type('!')
  const lines = await savedTableLines(page)
  const delimiter = lines.find((l) => l.includes('---'))!
  expect(delimiter.split('---')).toHaveLength(4) // 3열 → --- 3개 → split 결과 4조각
  expect(lines).toHaveLength(4) // 헤더 + 구분 + 본문 2
})

test('툴바 — 헤더 행에서는 행 삭제가 비활성, 본문 행에서는 활성', async ({
  authenticatedPage: page,
}) => {
  saved.length = 0
  await setup(page, TABLE_MD)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  await page.locator('.ProseMirror th').first().click()
  await expect(page.getByTestId('wiki-table-cmd-deleteRow')).toBeDisabled()

  await page.locator('.ProseMirror td').first().click()
  await expect(page.getByTestId('wiki-table-cmd-deleteRow')).toBeEnabled()
})

test('툴바 — 행 삭제가 마크다운에서도 사라진다', async ({ authenticatedPage: page }) => {
  saved.length = 0
  await setup(page, TABLE_MD)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  await page.locator('.ProseMirror td').filter({ hasText: 'API 설계' }).click()
  await page.getByTestId('wiki-table-cmd-deleteRow').click()
  await expect(page.locator('.ProseMirror table tr')).toHaveCount(2) // 헤더 + 본문 1

  await page.locator('.ProseMirror td').first().click()
  await page.keyboard.type('!')
  const lines = await savedTableLines(page)
  expect(lines).toHaveLength(3)
  expect(lines.join('\n')).not.toContain('API 설계')
})

test('단축키 — Ctrl+Alt+아래로 행이 추가되고, 표 밖에서는 아무 일도 없다', async ({
  authenticatedPage: page,
}) => {
  saved.length = 0
  await setup(page, `${TABLE_MD}\n\n표 아래 문단.`)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  await page.locator('.ProseMirror td').first().click()
  await page.keyboard.press('Control+Alt+ArrowDown')
  await expect(page.locator('.ProseMirror table tr')).toHaveCount(4)

  await page.keyboard.press('Control+Alt+ArrowRight')
  await expect(page.locator('.ProseMirror table th')).toHaveCount(3)

  // 표 밖에서는 가로채지 않는다 — 행 수가 그대로여야 한다.
  await page.locator('.ProseMirror p').filter({ hasText: '표 아래 문단' }).click()
  await expect(page.getByTestId('wiki-table-toolbar')).toHaveCount(0)
  await page.keyboard.press('Control+Alt+ArrowDown')
  await expect(page.locator('.ProseMirror table tr')).toHaveCount(4)
})

test('우클릭 메뉴 — 셀에서 열리고 표 밖에서는 열리지 않는다', async ({
  authenticatedPage: page,
}) => {
  saved.length = 0
  await setup(page, `${TABLE_MD}\n\n표 아래 문단.`)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  await page.locator('.ProseMirror td').filter({ hasText: '배포' }).click({ button: 'right' })
  const menu = page.getByTestId('wiki-table-context-menu')
  await expect(menu).toBeVisible()

  // 우클릭한 셀 기준으로 동작한다 — 그 행이 지워져야 한다.
  await menu.getByTestId('wiki-table-ctx-deleteRow').click()
  await expect(page.locator('.ProseMirror table tr')).toHaveCount(2)
  await expect(page.locator('.ProseMirror table')).not.toContainText('배포')

  // 표 밖 우클릭은 우리 메뉴를 열지 않는다(브라우저 기본 메뉴 유지).
  await page.locator('.ProseMirror p').filter({ hasText: '표 아래 문단' }).click({ button: 'right' })
  await expect(page.getByTestId('wiki-table-context-menu')).toHaveCount(0)
})

test('삽입 → 열 추가 → 저장 → 저장본으로 재로드까지 표가 보존된다', async ({
  authenticatedPage: page,
}) => {
  saved.length = 0
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // 1) 그리드 피커로 4열 × 2행 삽입
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  await page.getByTestId('wiki-slash-option-table').click()
  await page.getByTestId('wiki-table-size-cell-2-4').click()
  await expect(page.locator('.ProseMirror table th')).toHaveCount(4)

  // 2) 셀에 값을 넣고 툴바로 열 추가 → 5열
  await page.locator('.ProseMirror th').first().click()
  await page.keyboard.type('항목')
  await page.getByTestId('wiki-table-cmd-addColumnAfter').click()
  await expect(page.locator('.ProseMirror table th')).toHaveCount(5)

  // 3) 저장 payload 가 5열 GFM 표인가
  // 타이핑→열추가→클릭→타이핑 사이에 디바운스 자동저장이 여러 번 발화할 수 있어
  // "저장이 1건 이상"만 기다리면 아직 'A' 가 반영되기 전의 중간 payload를 잡을 수
  // 있다(병렬 워커 부하 시 관찰됨). 최종 형태(5열 구분선 + 'A' 포함)로 수렴할
  // 때까지 폴링한다.
  await page.locator('.ProseMirror td').first().click()
  await page.keyboard.type('A')
  await expect
    .poll(() => (saved[saved.length - 1] ?? '').split('\n').filter((l) => l.trim().startsWith('|')))
    .toEqual(expect.arrayContaining([expect.stringContaining('A')]))
  const lines = saved[saved.length - 1].split('\n').filter((l) => l.trim().startsWith('|'))
  const delimiter = lines.find((l) => l.includes('---'))!
  expect(delimiter.split('---')).toHaveLength(6) // 5열
  expect(lines).toHaveLength(3) // 헤더 + 구분 + 본문 1
  expect(lines[0]).toContain('항목')
  // HTML 폴백으로 새지 않았는지 — <table 이 있으면 GFM 직렬화가 깨진 것이다.
  expect(saved[saved.length - 1]).not.toContain('<table')

  // 4) 저장본을 그대로 다시 로드해 셀 단위로 확인
  // page.unrouteAll 은 auth.fixture 가 심어둔 인증 스텁(/users/me 등)까지 제거해
  // 재로드 시 로그인 화면으로 튕긴다 — 새 setup() 을 다시 등록해 페이지 라우트만
  // LIFO 로 덮어쓴다(Playwright route 매칭은 마지막 등록이 우선).
  const persisted = saved[saved.length - 1]
  await setup(page, persisted)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const t = page.locator('.ProseMirror table')
  await expect(t.locator('th')).toHaveCount(5)
  await expect(t.locator('th').first()).toHaveText('항목')
  await expect(t.locator('td')).toHaveCount(5)
  await expect(t.locator('td').first()).toHaveText('A')
})

test('뷰어 권한 — 툴바·우클릭 메뉴·단축키 모두 비활성 (스펙 §5)', async ({
  authenticatedPage: page,
}) => {
  saved.length = 0
  await setup(page, TABLE_MD, 'VIEWER')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  // 셀 클릭해도 표 툴바가 뜨지 않는다.
  await page.locator('.ProseMirror td').first().click()
  await expect(page.getByTestId('wiki-table-toolbar')).toHaveCount(0)

  // 셀 우클릭해도 우리 컨텍스트 메뉴가 뜨지 않는다(브라우저 기본 메뉴 유지).
  await page.locator('.ProseMirror td').first().click({ button: 'right' })
  await expect(page.getByTestId('wiki-table-context-menu')).toHaveCount(0)

  // 단축키도 막힌다 — 행 수가 그대로여야 한다(수정 2 의 회귀 테스트).
  await page.locator('.ProseMirror td').first().click()
  await page.keyboard.press('Control+Alt+ArrowDown')
  await expect(page.locator('.ProseMirror table tr')).toHaveCount(3) // 헤더 + 본문 2, 불변
})

test('셀 안에서는 슬래시 메뉴에 표 항목이 없다 (중첩 표 직렬화 붕괴 회귀)', async ({
  authenticatedPage: page,
}) => {
  // 재현: 셀 안 → '/' → 그리드로 표 삽입 → 타이핑 → 저장 payload 에 <table 이 섞여 바깥 표까지
  // raw HTML 로 새는 걸 확인했다(스키마상 tableCell.content='block+' 라 중첩 표 자체는 유효하지만
  // tiptap-markdown 이 중첩 table 을 GFM 으로 못 씀). 가장 단순한 차단책으로 셀 안에서는 '표'
  // 슬래시 항목 자체를 숨긴다(wikiSlashSuggestion.ts items()). 이 테스트는 그 차단이 유지되는지
  // 지키는 회귀 테스트다.
  saved.length = 0
  await setup(page, `${TABLE_MD}\n\n표 아래 문단.`)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  // 셀 안에 커서 → '/' — 메뉴는 뜨지만 표 항목이 없다.
  await page.locator('.ProseMirror td').first().click()
  await page.keyboard.type('/')
  await expect(page.getByTestId('wiki-slash-popover')).toBeVisible()
  await expect(page.getByTestId('wiki-slash-option-table')).toHaveCount(0)
  // Escape 는 팝업을 숨길 뿐 suggestion 상태를 완전히 종료하지 않는다(그리드 모드 복귀 지원 때문).
  // '/' 를 지워 확실히 트리거를 종료한다.
  await page.keyboard.press('Backspace')

  // 셀 밖(표 아래 문단)에서는 여전히 표 항목이 있다 — 차단이 표 안에서만 적용됨을 확인.
  await page.locator('.ProseMirror p').filter({ hasText: '표 아래 문단' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type('/')
  await expect(page.getByTestId('wiki-slash-option-table')).toBeVisible()
})
