import type { Page } from '@playwright/test'

import { BACKGROUND_DISCONNECT_MS } from '../../../src/lib/collab/collabResume'
import { expect, test } from '../../fixtures/auth.fixture'
import {
  applyCollabMarkdown,
  changeCollabRole,
  leaveAllCollabPeers,
  readCollabMarkdown,
  setPageVisibility,
  typeAtEnd,
} from '../../fixtures/collab'
import { KIM } from '../../fixtures/presence'
import { mockGatedEvents } from '../../fixtures/gatedEvents'
import { expectStays } from '../../fixtures/wait'
import { mockWikiMentions, mockWikiPageEditor, mockWikiRevisions } from '../../fixtures/wiki-mock'
import {
  CHOI,
  REVISION_DETAILS as DETAILS,
  REVISION_LIST as LIST,
  REVISION_LIVE as LIVE,
  REVISION_NOW as NOW,
  REVISION_PAGE_ID as PAGE_ID,
  REVISION_SPACE_ID as SPACE_ID,
  REVISION_TITLE as TITLE,
  openRevisionHistory as openHistory,
  revisionItem as revItem,
  revisionPagePath as pagePath,
  revisionPreview as preview,
  revisionShot as shot,
} from '../../fixtures/wiki-revisions'

// 노트 버전 기록(WP-282) 데스크톱 — 헤더 ⋯ → 버전 기록 패널, 판 미리보기(변경 표시), 복원, 복귀 토스트 "변경 보기".
// 버전 기록 API 는 route 목(mockWikiRevisions), 본문 동기화는 테스트 모드 동기화 서버(실서버)다. 데이터는 fixtures/wiki-revisions(모바일 spec 과 공용).
// 날짜 묶음("오늘"·"어제")과 HH:mm 이 머신 시간대·실행 시각에 흔들리지 않게 시간대를 고정하고 시계를 NOW 에서 시작한다.
test.use({ timezoneId: 'Asia/Seoul' })

const panel = (p: Page) => p.getByTestId('wiki-revision-panel')
const bar = (p: Page) => p.getByTestId('wiki-revision-bar')

test.afterEach(() => leaveAllCollabPeers())

test.describe('노트 버전 기록', () => {
  test('⋯ → 버전 기록은 날짜로 묶은 목록을 보이고, 맨 위는 현재 버전, AI 적용 직전 판은 ✦ 표식이다', async ({ authenticatedPage: a }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE })
    await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: DETAILS })
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await openHistory(a)

    await expect(a).toHaveURL(/[?&]history=1/)
    await expect(panel(a).locator('h3')).toHaveText(['오늘', '어제', '10월 5일'])
    await expect(revItem(a, 'current')).toContainText('현재 버전')
    await expect(revItem(a, 'current')).toContainText('김철수 외 2명 · 편집 중')
    await expect(revItem(a, 'current')).toHaveAttribute('aria-current', 'true')
    await expect(revItem(a, 6)).toContainText('14:32')
    await expect(revItem(a, 6)).toContainText('이영희 (AI 수정)')
    await expect(revItem(a, 6).locator('svg.lucide-sparkles')).toBeVisible()
    await expect(revItem(a, 5)).toContainText('김철수, 박민수')
    await expect(revItem(a, 3)).toContainText('17:48')
    await expect(revItem(a, 2)).toContainText('09:12')

    // ✕ 로 닫으면 패널·쿼리가 사라진다.
    await a.getByTestId('wiki-revision-panel-close').click()
    await expect(panel(a)).toHaveCount(0)
    await expect(a).not.toHaveURL(/history=/)
  })

  test('목록을 연 채 다른 사람이 고치거나 복원하면(wiki.page.updated) 새 판이 생기고 현재 버전이 바뀐다', async ({ authenticatedPage: a }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE })
    const { setList } = await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: DETAILS })
    const events = await mockGatedEvents(a)
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await openHistory(a)
    await expect(revItem(a, 'current')).toContainText('김철수 외 2명 · 편집 중')
    await expect(revItem(a, 7)).toHaveCount(0)

    // 서버 쪽 새 판을 흉내 낸다 — 다른 사람의 복원으로 지금 판(v7)이 스냅샷이 되고 현재 버전은 최수진의 v8.
    setList({
      current: { version: 8, editedAt: new Date('2026-10-07T14:58:00+09:00').toISOString(), editors: [CHOI] },
      items: [
        { version: 7, title: TITLE, editedAt: LIST.current.editedAt, createdAt: LIST.current.editedAt, reason: 'RESTORE', editors: LIST.current.editors, aiActor: null },
        ...LIST.items,
      ],
    })
    const refetch = a.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/wiki/pages/${PAGE_ID}/revisions` && r.request().method() === 'GET')
    events.deliver(`event: wiki.page.updated\ndata: ${JSON.stringify({ spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, actorId: CHOI.id })}\n\n`)
    await refetch
    // 새로고침·재오픈 없이 열린 목록에 새 판이 생기고 현재 버전(편집자)이 바뀐다.
    await expect(revItem(a, 7)).toContainText('14:50')
    await expect(revItem(a, 'current')).toContainText('최수진')
  })

  test('판을 고르면 읽기 전용 미리보기와 다음 판 대비 변경 표시가 보이고, 토글로 끄고 현재 버전으로 돌아간다', async ({ authenticatedPage: a }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE })
    await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: DETAILS })
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await openHistory(a)

    await revItem(a, 5).click()
    await expect(bar(a)).toContainText('10월 7일 14:05 버전 미리보기 — 읽기 전용')
    await expect(revItem(a, 5)).toHaveAttribute('aria-current', 'true')
    await expect(preview(a).locator('h1')).toHaveText(TITLE)
    await expect(preview(a)).toContainText('모바일 이슈 상세는 다음 사이클로 이월한다.')
    // 편집기는 마운트된 채 가려진다(inert) — 미리보기는 편집할 수 없다.
    await expect(a.getByTestId('wiki-editor-scroll')).toHaveAttribute('inert', '')
    await expect(preview(a).locator('[contenteditable="true"]')).toHaveCount(0)
    // 헤더 AI 작성도 막힌다 — 결과가 가려진 라이브 노트에 보이지 않게 들어가지 않도록.
    const aiButton = a.getByTestId('wiki-ai-header-button')
    await expect(aiButton).toHaveAttribute('aria-disabled', 'true')
    await aiButton.hover()
    // Radix 툴팁은 스크린리더용 사본을 함께 그려 같은 문구가 두 번 들어 있다.
    await expect(a.getByTestId('wiki-ai-header-reason')).toContainText('버전 미리보기 중에는 AI 작성을 사용할 수 없습니다')
    await a.mouse.move(600, 500)
    await a.keyboard.press('Escape')
    await expect(a.getByTestId('wiki-ai-header-reason')).toHaveCount(0)

    // 변경 표시(기본 켬) — v5 에만 있던 글자는 삭제(취소선), v6 에만 있는 글자·문단은 추가.
    const toggle = a.getByTestId('wiki-revision-diff-toggle')
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(preview(a).locator('.wiki-diff-removed').first()).toBeVisible()
    await expect.poll(() => preview(a).locator('.wiki-diff-removed').allTextContents().then((t) => t.join(''))).toContain('CRDT 없이 병합으로')
    await expect.poll(() => preview(a).locator('.wiki-diff-added').allTextContents().then((t) => t.join(''))).toContain('Yjs')
    await expect(preview(a).locator('.wiki-diff-added', { hasText: '배포 체크리스트에 인그레스 타임아웃을 추가한다.' })).toBeVisible()
    await shot(a, 'desktop-preview-diff-light')
    await a.emulateMedia({ colorScheme: 'dark' })
    await shot(a, 'desktop-preview-diff-dark')
    await a.emulateMedia({ colorScheme: 'light' })
    // 데스크톱 최소 폭(1024px) — 노트 칸이 좁아도 바 문구(시각)가 잘리지 않는다.
    await a.setViewportSize({ width: 1024, height: 720 })
    await expect(a.getByTestId('wiki-revision-bar-label')).toBeVisible()
    await expect
      .poll(() => a.getByTestId('wiki-revision-bar-label').evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true)
    await shot(a, 'desktop-preview-diff-1024')
    await a.setViewportSize({ width: 1280, height: 720 })

    // 끄면 표시가 사라지고 그 판 본문만 남는다(다음 판에만 있는 문단도 빠진다).
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(preview(a).locator('.wiki-diff-added, .wiki-diff-removed')).toHaveCount(0)
    await expect(preview(a)).toContainText('노트 동시 편집은 CRDT 없이 병합으로 간다.')
    await expect(preview(a)).not.toContainText('배포 체크리스트')

    // 현재 버전 → 미리보기 해제, 패널은 남는다.
    await revItem(a, 'current').click()
    await expect(bar(a)).toHaveCount(0)
    await expect(preview(a)).toHaveCount(0)
    await expect(panel(a)).toBeVisible()
    await expect(a.getByTestId('wiki-editor-scroll')).not.toHaveAttribute('inert', /.*/)
    await expect(a.getByTestId('wiki-ai-header-button')).toHaveAttribute('aria-disabled', 'false')
    await expect(a.locator('.ProseMirror')).toContainText('배포 체크리스트에 인그레스 타임아웃을 추가한다.')
  })

  test('표 셀 하나만 바뀐 판은 그 셀 안만 강조하고 표 통째 지움·추가는 없다(WP-324)', async ({ authenticatedPage: a }) => {
    // v5 → v6(라이브): 둘째 행 "상태" 칸의 낱말만 바뀌었다. 다른 셀·행·열은 그대로.
    const table = (status: string) =>
      [
        '## 일정',
        '| 단계 | 담당 | 상태 |',
        '| --- | --- | --- |',
        '| 서버 스냅샷 정책 정리 | 박민수 | 완료 |',
        `| 데스크톱 버전 기록 패널 | 이영희 | ${status} |`,
      ].join('\n')
    const live = table('디자이너 리뷰 진행 중')
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: live })
    await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: { ...DETAILS, 6: live, 5: table('디자이너 리뷰 예정') } })
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await openHistory(a)
    await revItem(a, 5).click()

    const p = preview(a)
    await expect(p.locator('table')).toHaveCount(1)
    // 지운 낱말·새 낱말은 그 셀(td) 안에만 있다.
    const cell = p.locator('tr').nth(2).locator('td').nth(2)
    await expect(cell.locator('.wiki-diff-removed')).toHaveText('예정')
    await expect(cell.locator('.wiki-diff-added')).toHaveText('진행 중')
    await expect(p.locator('.wiki-diff-removed, .wiki-diff-added')).toHaveCount(2)
    // 표·행 통째 표시는 없다(예전엔 표 전체 취소선 + 새 표가 나란히 보였다).
    await expect(p.locator('table.wiki-diff-removed, table.wiki-diff-added, tr.wiki-diff-removed, tr.wiki-diff-added')).toHaveCount(0)
    await expect(p.locator('tr').nth(1)).toHaveText('서버 스냅샷 정책 정리박민수완료')
  })

  test('대상만 바뀐 멘션은 새 멘션을 칩과 같은 라벨로 보이고, 모르는 대상은 칩과 같은 대체 라벨이다(WP-324)', async ({
    authenticatedPage: a,
  }) => {
    // v5 → 라이브: 첫 문단 멘션은 라벨을 아는 사람(7)으로, 둘째 문단 멘션은 라벨 목록에 없는 사람(99)으로 바뀌었다.
    const live = '담당 <@7> 이 정리했다.\n\n검토 <@99> 이 확인했다.'
    const v5 = '담당 <@11> 이 정리했다.\n\n검토 <@7> 이 확인했다.'
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: live })
    await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: { ...DETAILS, 6: live, 5: v5 } })
    await mockWikiMentions(a, PAGE_ID, [{ type: 'USER', id: 7, label: '앨리스 (제품기획)', spaceId: null, projectKey: null, number: null }])
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await openHistory(a)
    await revItem(a, 5).click()

    const p = preview(a)
    // 추가 글자 위젯 — 예전엔 멘션이 "@" 한 글자로만 보였다. 라벨 조회가 늦게 와도 실제 라벨로 다시 그린다.
    await expect(p.locator('span.wiki-diff-added')).toHaveText(['@앨리스 (제품기획)', '@사용자 99'])
    // 지운 멘션은 보는 판의 칩 그대로(취소선) — 칩도 같은 라벨 규칙이다.
    await expect(p.locator('[data-mtype].wiki-diff-removed, .wiki-diff-removed [data-mtype]')).toHaveText(['@사용자 11', '@앨리스 (제품기획)'])
  })

  test('복원하면 토스트 후 미리보기가 닫히고, 같은 노트를 연 다른 화면에도 복원 본문이 바로 보인다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const opts = { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE }
    await mockWikiPageEditor(a, opts)
    const { restores } = await mockWikiRevisions(a, {
      pageId: PAGE_ID,
      list: LIST,
      details: DETAILS,
      // 실서버 복원과 같게 동기화 서버에 그 판 본문을 통째로 적용한다(replace).
      onRestore: async (_v, body) => {
        await applyCollabMarkdown(collabNs, PAGE_ID, { body, ai: false })
      },
    })
    const b = await newAuthedPage()
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await b.goto(pagePath)
    await expect(b.locator('.ProseMirror')).toContainText('Yjs 로 간다')

    await openHistory(a)
    await revItem(a, 4).click()
    await expect(preview(a)).toContainText('아직 정하지 않았')
    await a.getByTestId('wiki-revision-restore').click()

    await expect(a.getByText('11:20 버전으로 복원했어요')).toBeVisible()
    await restores.waitFor(1)
    expect(restores.urls()[0].pathname).toBe(`/api/v1/wiki/pages/${PAGE_ID}/revisions/4/restore`)
    // 미리보기는 닫히고 패널은 남아, 새로 받은 목록에 "복원 전" 판이 보인다.
    await expect(bar(a)).toHaveCount(0)
    await expect(panel(a)).toBeVisible()
    await expect(revItem(a, 7)).toContainText('복원 전')
    await expect(revItem(a, 'current')).toHaveAttribute('aria-current', 'true')
    // 접속 중인 다른 화면과 내 에디터 모두 복원 본문.
    await expect(b.locator('.ProseMirror')).toContainText('아직 정하지 않았다.')
    await expect(b.locator('.ProseMirror')).not.toContainText('Yjs 로 간다')
    await expect(a.locator('.ProseMirror')).toContainText('아직 정하지 않았다.')
    expect(await readCollabMarkdown(collabNs, PAGE_ID)).toContain('아직 정하지 않았다.')
  })

  test('뒤로가기는 미리보기 → 목록 → 노트 순으로 닫는다', async ({ authenticatedPage: a }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE })
    await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: DETAILS })
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await openHistory(a)
    await revItem(a, 5).click()
    await expect(bar(a)).toBeVisible()
    await expect(a).toHaveURL(/[?&]rev=5/)

    await a.goBack()
    await expect(bar(a)).toHaveCount(0)
    await expect(panel(a)).toBeVisible()
    await expect(revItem(a, 'current')).toHaveAttribute('aria-current', 'true')
    await expect(a).toHaveURL(/[?&]history=1/)
    await expect(a).not.toHaveURL(/rev=/)

    await a.goBack()
    await expect(panel(a)).toHaveCount(0)
    await expect(a).toHaveURL(new RegExp(`${pagePath}$`))
  })

  test('본문에 커서를 둔 채 미리보기로 들어가도(앞으로 가기) 키 입력이 가려진 노트에 들어가지 않는다', async ({ authenticatedPage: a, collabNs }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE })
    await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: DETAILS })
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    // 미리보기 주소를 한 번 만들고 뒤로 — 다음 진입은 패널 항목을 누르지 않는 히스토리 이동이다(포커스가 본문에 남는 경로).
    await openHistory(a)
    await revItem(a, 5).click()
    await expect(bar(a)).toBeVisible()
    await a.goBack()
    await expect(bar(a)).toHaveCount(0)
    await a.locator('.ProseMirror p', { hasText: '이월한다.' }).click()
    await expect.poll(() => a.evaluate(() => document.activeElement?.closest('.ProseMirror') != null)).toBe(true)

    await a.goForward()
    await expect(bar(a)).toBeVisible()
    // 가려진 에디터에서 포커스가 빠졌다.
    await expect.poll(() => a.evaluate(() => document.activeElement?.closest('.ProseMirror') != null)).toBe(false)
    const before = await readCollabMarkdown(collabNs, PAGE_ID)
    await a.keyboard.type('xyz')
    // 부재 확인 — 입력이 동기화 서버까지 가는 시간(디바운스 없음, 수십 ms) 동안 본문이 그대로인지 지켜본다.
    await expectStays(a, () => readCollabMarkdown(collabNs, PAGE_ID), before, { ms: 800 })
    await expect(a.getByTestId('wiki-editor-scroll').locator('.ProseMirror')).not.toContainText('xyz')
  })

  test('AI 작성 중엔 이전 버전을 고를 수 없고, 현재 버전만 누를 수 있다', async ({ authenticatedPage: a }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE })
    await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: DETAILS })
    // /ai 시작 → correlationId. 결과 스트림(/events)은 끝까지 보내지 않아 생성 중인 채로 둔다.
    await a.route('**/api/v1/wiki/pages/*/ai', (route) =>
      route.request().method() === 'POST' ? route.fulfill({ json: { correlationId: 'corr-rev' } }) : route.fallback(),
    )
    await a.route('**/api/v1/events', () => new Promise<void>(() => {}))
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await typeAtEnd(a, '이월한다.', '/')
    await a.getByTestId('wiki-slash-option-continue').click()
    await expect(a.getByTestId('wiki-ai-busy')).toBeVisible()

    await openHistory(a)
    await expect(a.getByTestId('wiki-revision-blocked')).toHaveText('AI 작성 중에는 이전 버전을 볼 수 없습니다')
    await expect(revItem(a, 5)).toBeDisabled()
    await expect(revItem(a, 5)).toHaveAttribute('aria-description', 'AI 작성 중에는 이전 버전을 볼 수 없습니다')
    await expect(revItem(a, 'current')).toBeEnabled()
    // 비활성 버튼은 눌리지 않는다 — 미리보기·rev 주소가 생기지 않는다.
    await revItem(a, 5).dispatchEvent('click')
    await expect(bar(a)).toHaveCount(0)
    await expect(a).not.toHaveURL(/rev=/)
  })

  test('복원이 거절되면 오류 토스트만 뜨고 미리보기는 그대로 남는다', async ({ authenticatedPage: a }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE })
    const { restores } = await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: DETAILS, status: 403 })
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await openHistory(a)
    await revItem(a, 4).click()
    await a.getByTestId('wiki-revision-restore').click()
    await restores.waitFor(1)
    // 서버 사유(message)를 그대로 보인다(handleApiError).
    await expect(a.getByText('권한이 없습니다')).toBeVisible()
    await expect(a.getByText(/버전으로 복원했어요/)).toHaveCount(0)
    await expect(bar(a)).toBeVisible()
    await expect(revItem(a, 4)).toHaveAttribute('aria-current', 'true')
    await expect(a.getByTestId('wiki-editor-scroll').locator('.ProseMirror')).toContainText('Yjs 로 간다')
  })

  test('미리보기 중 접근을 잃으면 패널·미리보기가 닫히고 ⋯ 에 버전 기록이 없다', async ({ authenticatedPage: a, collabNs }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE })
    await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: DETAILS })
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await openHistory(a)
    await revItem(a, 5).click()
    await expect(bar(a)).toBeVisible()

    await changeCollabRole(collabNs, PAGE_ID, 'NONE')
    await expect(a.getByTestId('wiki-sync-status')).toHaveAttribute('data-status', 'forbidden')
    await expect(panel(a)).toHaveCount(0)
    await expect(bar(a)).toHaveCount(0)
    await expect(a).not.toHaveURL(/history=|rev=/)
    await a.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
    await expect(a.getByTestId('wiki-menu-source')).toBeVisible()
    await expect(a.getByTestId('wiki-menu-history')).toHaveCount(0)
  })

  test('뷰어는 미리보기는 보지만 복원 버튼이 없다', async ({ authenticatedPage: a }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE, role: 'VIEWER' })
    await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: DETAILS })
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await openHistory(a)
    await revItem(a, 5).click()
    await expect(bar(a)).toContainText('14:05 버전 미리보기')
    await expect(preview(a)).toContainText('CRDT 없이 병합으')
    await expect(a.getByTestId('wiki-revision-close')).toBeVisible()
    await expect(a.getByTestId('wiki-revision-restore')).toHaveCount(0)
  })

  test('미리보기 중 다른 사람이 고쳐도 미리보기는 그대로이고, 닫으면 에디터에 그 수정이 보인다(연결 유지)', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE })
    await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: DETAILS })
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await openHistory(a)
    // 맨 위 판 — 비교 대상은 고른 순간의 라이브 문서 스냅샷이라, 지금은 차이가 없다.
    await revItem(a, 6).click()
    await expect(preview(a)).toContainText('Yjs 로 간다')
    await expect(preview(a).locator('.wiki-diff-added, .wiki-diff-removed')).toHaveCount(0)

    await applyCollabMarkdown(collabNs, PAGE_ID, { baseBody: LIVE, body: `${LIVE}\n\n피어가 추가한 문단`, ai: false })
    // 가려진 에디터는 연결된 채 원격 수정을 받는다.
    await expect(a.getByTestId('wiki-editor-scroll').locator('.ProseMirror')).toContainText('피어가 추가한 문단')
    // 미리보기와 그 변경 표시는 스냅샷 기준이라 바뀌지 않는다.
    await expect(preview(a)).not.toContainText('피어가 추가한 문단')
    await expect(preview(a).locator('.wiki-diff-added, .wiki-diff-removed')).toHaveCount(0)

    await a.getByTestId('wiki-revision-close').click()
    await expect(bar(a)).toHaveCount(0)
    await expect(a.locator('.ProseMirror')).toContainText('피어가 추가한 문단')
    await expect(a.getByTestId('wiki-sync-status')).toHaveAttribute('data-status', 'live')
  })

  test('복귀 토스트 "변경 보기"는 패널을 열고 최신 판을 변경 표시로 고른다', async ({ authenticatedPage: a, newAuthedPage, collabNs }) => {
    const opts = { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE }
    await mockWikiPageEditor(a, opts)
    await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: DETAILS })
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await b.goto(pagePath)
    // A 가 B 를 안다(누가 고쳤는지 셀 수 있다).
    await expect(a.getByTestId('wiki-presence')).toBeVisible()

    await setPageVisibility(a, 'hidden')
    await a.clock.fastForward(BACKGROUND_DISCONNECT_MS + 1000)
    await expect(b.getByTestId('wiki-presence')).toHaveCount(0)
    await typeAtEnd(b, '이월한다.', ' 김철수가 고침')
    await expect.poll(() => readCollabMarkdown(collabNs, PAGE_ID)).toContain('김철수가 고침')

    await setPageVisibility(a, 'visible')
    await expect(a.getByText('자리를 비운 동안 1명이 수정했어요')).toBeVisible()
    await a.getByRole('button', { name: '변경 보기' }).click()

    await expect(panel(a)).toBeVisible()
    await expect(revItem(a, 6)).toHaveAttribute('aria-current', 'true')
    await expect(bar(a)).toContainText('14:32 버전 미리보기')
    await expect(a.getByTestId('wiki-revision-diff-toggle')).toHaveAttribute('aria-checked', 'true')
    // 최신 판 대비 지금(돌아와 받은) 문서 — 자리 비운 사이 더해진 글자가 추가로 보인다.
    await expect.poll(() => preview(a).locator('.wiki-diff-added').allTextContents().then((t) => t.join(''))).toContain('김철수가 고침')
  })
})
