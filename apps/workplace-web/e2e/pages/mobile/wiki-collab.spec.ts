import type { Page } from '@playwright/test'
import { REVALIDATE_REASON_DELETED, WIKI_SCHEMA_VERSION } from '@smart-workplace/wiki-editor-schema/collab-protocol'

import {
  applyCollabMarkdown,
  changeCollabRole,
  controlCollabSocket,
  readCollabMarkdown,
  setCollabSchemaVersion,
  typeAtEnd,
} from '../../fixtures/collab'
import { mockGatedEvents } from '../../fixtures/gatedEvents'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { mockNoteInTeamSpace, mockWikiPageEditor } from '../../fixtures/wiki-mock'

// 모바일 셸(390px)의 노트 동시 편집(WP-172) — 테스트 모드 동기화 서버에 실제로 붙는다.
// 정상(live)은 헤더 폭을 지키려 점 하나만, 문제 상태는 짧은 글자 칩. 데스크톱 시나리오는 pages/wiki/wiki-collab.spec.ts.

const SPACE_ID = 1
const pagePath = (pageId: number, spaceId = SPACE_ID) => `/wiki/spaces/${spaceId}/pages/${pageId}`
// 첫 스페이스(개인)가 아닌 팀 스페이스 — 종료 안내의 "노트 목록으로"가 노트의 스페이스 목록으로 가는지 가른다.
const TEAM_SPACE_ID = 2
// 삭제 시나리오 본문 — 스크롤할 수 있을 만큼 길어야 띠의 스크롤 보정(제목 가림)이 실제로 일어난다.
const DELETED_BODY = ['지울 본문', ...Array.from({ length: 40 }, (_, i) => `문단 ${i + 1}`)].join('\n\n')

/** 종료 상태의 페이지 메뉴 — 없는 노트를 지우는 항목은 없고, 마크다운 소스는 남는다. */
async function expectNoDeleteInPageMenu(page: Page) {
  await page.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
  await expect(page.getByTestId('wiki-menu-source')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '페이지 삭제' })).toHaveCount(0)
  await page.keyboard.press('Escape')
}

test.describe('모바일 노트 동시 편집', () => {
  test('정상 연결은 점 하나 칩이고, 다른 사람 입력이 실시간으로 들어온다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const opts = { spaceId: SPACE_ID, pageId: 21, title: '회의록', body: '첫 문단' }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage()
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.goto(pagePath(21))
    await b.goto(pagePath(21))

    const chip = a.getByTestId('wiki-sync-status')
    await expect(chip).toHaveAttribute('data-status', 'live')
    // 보이는 글자 없이 점만(스크린리더용 문구는 sr-only).
    await expect(chip).toHaveText('실시간 동기화 중')
    await expect(chip.getByText('실시간 동기화 중')).toHaveClass(/sr-only/)
    await expect(a.locator('.ProseMirror')).toHaveText('첫 문단')

    await typeAtEnd(b, '첫 문단', ' 모바일 B')
    await expect(a.locator('.ProseMirror')).toHaveText('첫 문단 모바일 B')
    await expect.poll(() => readCollabMarkdown(collabNs, 21)).toBe('첫 문단 모바일 B')
    await expectNoHorizontalOverflow(a)
  })

  test('처음부터 동기화 서버에 못 붙으면 연결 못 함 안내를 보이고, 붙으면 본문이 나온다', async ({
    authenticatedPage: a,
  }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 24, title: '노트', body: '서버 본문' })
    const socket = await controlCollabSocket(a)
    await socket.drop()
    await a.goto(pagePath(24))
    await expect(a.getByTestId('wiki-sync-unreachable')).toBeVisible()
    await expect(a.getByTestId('wiki-body-skeleton')).toHaveCount(0)
    await expect(a.locator('.ProseMirror')).toHaveCount(0)
    await expectNoHorizontalOverflow(a)
    await a.screenshot({ path: 'test-results/tc/wiki-collab/unreachable-mobile.png' })

    socket.restore()
    await expect(a.locator('.ProseMirror')).toHaveText('서버 본문', { timeout: 30_000 })
    await expect(a.getByTestId('wiki-sync-unreachable')).toHaveCount(0)
  })

  test('보기 권한은 읽기 전용 칩이고 본문을 고칠 수 없다', async ({ authenticatedPage: a }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 22, title: '노트', body: '본문', role: 'VIEWER' })
    await a.goto(pagePath(22))
    await expect(a.getByTestId('wiki-sync-status')).toHaveAttribute('data-status', 'readonly')
    await expect(a.getByTestId('wiki-sync-status')).toHaveText('읽기 전용')
    await expect(a.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
    await expectNoHorizontalOverflow(a)
  })

  test('편집 중 서버가 보기 권한으로 낮추면 잠기고, 접근이 사라지면 안내를 보인다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    await mockWikiPageEditor(a, { spaceId: TEAM_SPACE_ID, pageId: 23, title: '노트', body: '본문' })
    await mockNoteInTeamSpace(a, { spaceId: TEAM_SPACE_ID, name: '제품팀' })
    await a.goto(pagePath(23, TEAM_SPACE_ID))
    const chip = a.getByTestId('wiki-sync-status')
    const editor = a.locator('.ProseMirror')
    await expect(chip).toHaveAttribute('data-status', 'live')
    await expect(editor).toHaveAttribute('contenteditable', 'true')

    await changeCollabRole(collabNs, 23, 'VIEWER')
    await expect(chip).toHaveAttribute('data-status', 'readonly')
    await expect(editor).toHaveAttribute('contenteditable', 'false')

    await changeCollabRole(collabNs, 23, 'NONE')
    await expect(a.getByTestId('wiki-forbidden-notice')).toContainText('삭제되었거나 접근 권한이 없습니다')
    await expect(chip).toHaveAttribute('data-status', 'forbidden')
    await expect(chip).toHaveText('접근 불가')
    await expect(a.getByRole('alert')).toHaveText('삭제되었거나 접근 권한이 없습니다')
    await expectNoHorizontalOverflow(a)
    await expectNoDeleteInPageMenu(a)

    // 나갈 길 — 이 노트의 스페이스 목록으로. 글줄 링크라도 터치 영역은 24px 이상.
    const toList = a.getByTestId('wiki-forbidden-to-list')
    await expect(toList).toHaveAttribute('href', `/wiki/spaces/${TEAM_SPACE_ID}`)
    expect((await toList.boundingBox())!.height).toBeGreaterThanOrEqual(24)
    await toList.click()
    await expect(a).toHaveURL(new RegExp(`/wiki/spaces/${TEAM_SPACE_ID}$`))
  })

  // WP-296 — 모바일도 삭제됨은 짧은 칩 + 안내 띠(목록으로 가는 링크)로 알리고, 띠가 접혀도 화면 폭을 넘지 않는다.
  // 실제 순서대로 삭제 SSE 의 재조회(404)·트리 갱신이 동기화 서버 종료(4404)보다 먼저 온다.
  test('편집 중 노트가 삭제되면 짧은 삭제됨 칩과 안내를 보이고 화면 폭을 넘지 않는다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    await mockWikiPageEditor(a, { spaceId: TEAM_SPACE_ID, pageId: 28, title: '지울 회의록', body: DELETED_BODY })
    await mockNoteInTeamSpace(a, { spaceId: TEAM_SPACE_ID, name: '제품팀' })
    const events = await mockGatedEvents(a)
    await a.goto(pagePath(28, TEAM_SPACE_ID))
    const chip = a.getByTestId('wiki-sync-status')
    await expect(chip).toHaveAttribute('data-status', 'live')

    await a.route(
      (u) => u.pathname === '/api/v1/wiki/pages/28',
      (r) =>
        r.request().method() === 'GET'
          ? r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: '페이지를 찾을 수 없습니다' }) })
          : r.fallback(),
    )
    await a.route(
      (u) => u.pathname === `/api/v1/wiki/spaces/${TEAM_SPACE_ID}/pages`,
      (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback()),
    )
    const refetch = a.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/wiki/pages/28' && r.status() === 404,
    )
    events.deliver(`event: wiki.page.deleted\ndata: ${JSON.stringify({ spaceId: TEAM_SPACE_ID, pageId: 28, actorId: 2 })}\n\n`)
    await refetch

    await changeCollabRole(collabNs, 28, 'NONE', REVALIDATE_REASON_DELETED)
    await expect(a.getByTestId('wiki-deleted-notice')).toContainText('이 노트가 삭제되었습니다')
    await expect(chip).toHaveAttribute('data-status', 'deleted')
    await expect(chip).toHaveText('삭제됨')
    await expect(a.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
    await expect(a.locator('.ProseMirror')).toContainText('지울 본문')
    // 트리에서 빠져도 헤더 제목은 일반 "노트"가 아니라 지운 노트의 제목, 띠는 본문 제목을 가리지 않는다.
    await expect(a.getByTestId('mobile-back-title')).toHaveText('지울 회의록')
    const notice = await a.getByTestId('wiki-deleted-notice').boundingBox()
    const title = await a.getByPlaceholder('제목 없음').boundingBox()
    expect(notice && title && title.y >= notice.y + notice.height).toBe(true)
    await expectNoHorizontalOverflow(a)
    await expectNoDeleteInPageMenu(a)

    // 목록으로 → 이 노트의 스페이스 목록(모바일도 /wiki/spaces/:id 가 목록) — /wiki 면 첫 스페이스(개인 노트)로 간다.
    const toList = a.getByTestId('wiki-deleted-to-list')
    await expect(toList).toHaveAttribute('href', `/wiki/spaces/${TEAM_SPACE_ID}`)
    // 띠 안의 글줄 링크라도 터치 영역은 24px 이상(10-accessibility 최소 기준) — 글줄 높이(17px)만으론 미달이었다.
    expect((await toList.boundingBox())!.height).toBeGreaterThanOrEqual(24)
    await toList.click()
    await expect(a).toHaveURL(new RegExp(`/wiki/spaces/${TEAM_SPACE_ID}$`))
  })

  // WP-313 — 모바일은 칩 title(툴팁)이 안 보이므로 안내 띠가 미전송 입력 손실을 알리고, 칩을 탭하면 새로고침한다.
  test('동기화 서버의 스키마 판이 다르면 짧은 새로고침 칩과 안내를 보이고, 칩을 탭하면 다시 붙는다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 42, title: '노트', body: '서버 본문' })
    await setCollabSchemaVersion(collabNs, 42, WIKI_SCHEMA_VERSION + 1)
    await a.goto(pagePath(42))
    const chip = a.getByTestId('wiki-sync-status')
    await expect(chip).toHaveAttribute('data-status', 'outdated')
    await expect(chip).toHaveText('새로고침')
    await expect(a.getByTestId('wiki-outdated-notice')).toContainText('아직 저장되지 않은 입력은 저장되지 않습니다')
    await expect(a.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
    await expectNoHorizontalOverflow(a)

    await setCollabSchemaVersion(collabNs, 42)
    await Promise.all([a.waitForEvent('load'), chip.tap()])
    await expect(chip).toHaveAttribute('data-status', 'live')
    await expect(a.locator('.ProseMirror')).toHaveText('서버 본문')
  })

  // WP-289 — 모바일에서도 편집 중 도착한 AI 본문 병합이 내 입력을 지우지 않는다(데스크톱 시나리오는 pages/wiki/wiki-collab.spec.ts).
  test('편집 중 AI 가 다른 문단을 고친 병합이 도착해도 내 입력과 AI 수정이 함께 남는다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    const body = '첫 문단\n\n둘째 문단'
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 25, title: '회의록', body })
    await a.goto(pagePath(25))
    await expect(a.getByTestId('wiki-sync-status')).toHaveAttribute('data-status', 'live')
    await typeAtEnd(a, '둘째 문단', ' 내입력')
    await expect.poll(() => readCollabMarkdown(collabNs, 25)).toBe('첫 문단\n\n둘째 문단 내입력')
    await applyCollabMarkdown(collabNs, 25, { baseBody: body, body: '첫 문단 AI수정\n\n둘째 문단' })
    await expect.poll(() => readCollabMarkdown(collabNs, 25)).toBe('첫 문단 AI수정\n\n둘째 문단 내입력')
    // 서버 ✦ 표식(약 3초)이 사라진 뒤 본문을 본다 — 위젯 글자가 섞이지 않게.
    await expect(a.getByTestId('wiki-ai-marker')).toHaveCount(0, { timeout: 8000 })
    await expect(a.locator('.ProseMirror p')).toHaveText(['첫 문단 AI수정', '둘째 문단 내입력'])
    // 내 커서는 그대로 — 이어 치면 내 문단 끝에 들어간다.
    await a.keyboard.type('!')
    await expect.poll(() => readCollabMarkdown(collabNs, 25)).toBe('첫 문단 AI수정\n\n둘째 문단 내입력!')
  })

  // WP-291 — 서버 표식은 약 3초만 보이므로 표식이 있는 동안 폭부터 재고 캡처한다.
  test('AI 가 고친 자리의 ✦ 이름표는 긴 이름도 말줄임으로 화면 폭을 넘지 않는다', async ({ authenticatedPage: a, collabNs }) => {
    const body = '첫 문단\n\n둘째 문단'
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 26, title: '회의록', body })
    await a.goto(pagePath(26))
    await expect(a.getByTestId('wiki-sync-status')).toHaveAttribute('data-status', 'live')
    const longName = '아주아주긴이름을가진에이아이비서요청자홍길동입니다'
    await applyCollabMarkdown(collabNs, 26, {
      baseBody: body,
      body: '첫 문단\n\n둘째 문단을 AI 가 길게 다듬었습니다',
      actor: { userId: 9, name: longName },
    })
    const marker = a.getByTestId('wiki-ai-marker')
    await expect(marker).toHaveText(longName)
    const tag = marker.locator('.wiki-ai-marker__tag')
    const viewport = a.viewportSize()!
    // 태그 폭 맞춤은 그린 뒤에 자리 잡을 수 있어 조건이 될 때까지 다시 잰다 — 양쪽 어디로도 넘치지 않아야 한다.
    // 표식은 약 3초 뒤 사라지므로 그보다 짧게 기다린다(사라져서 실패하는 게 아니라 넘쳐서 실패하게).
    await expect
      .poll(
        async () => {
          const box = await tag.boundingBox()
          return box != null && box.x >= 0 && box.x + box.width <= viewport.width
        },
        { timeout: 2000 },
      )
      .toBe(true)
    await expectNoHorizontalOverflow(a)
    await a.screenshot({ path: 'test-results/tc/wiki-collab/ai-marker-mobile.png' })
  })

  // WP-291 디자이너 리뷰 I-2 — 좁은 화면의 표 첫 행 표식도 표 감싸개에 잘리지 않게 캐럿 아래로, 화면 폭 안에 펼친다.
  test('표 첫 행에 붙은 AI 표식의 이름표는 표 감싸개·화면 폭 안에 보인다', async ({ authenticatedPage: a, collabNs }) => {
    const body = '표 위 문단\n\n| 이름 | 역할 |\n| --- | --- |\n| 홍길동 | 개발 |'
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 27, title: '회의록', body })
    await a.goto(pagePath(27))
    await expect(a.getByTestId('wiki-sync-status')).toHaveAttribute('data-status', 'live')
    await applyCollabMarkdown(collabNs, 27, { baseBody: body, body: body.replace('| 이름 |', '| 성명 |') })
    const marker = a.locator('.tableWrapper th').first().getByTestId('wiki-ai-marker')
    await expect(marker).toHaveClass(/wiki-ai-marker--below/, { timeout: 2000 })
    const inside = await marker.evaluate((el) => {
      const tag = el.querySelector('.wiki-ai-marker__tag')!.getBoundingClientRect()
      const wrap = el.closest('.tableWrapper')!.getBoundingClientRect()
      return tag.top >= wrap.top && tag.left >= 0 && tag.right <= window.innerWidth
    })
    expect(inside).toBe(true)
    await expectNoHorizontalOverflow(a)
  })
})
