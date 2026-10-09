import type { Page } from '@playwright/test'

import { BACKGROUND_DISCONNECT_MS } from '../../../src/lib/collab/collabResume'
import { applyCollabMarkdown, leaveAllCollabPeers, readCollabMarkdown, setPageVisibility, typeAtEnd } from '../../fixtures/collab'
import { expect, expectNoHorizontalOverflow, expectOnTop, test } from '../../fixtures/mobile.fixture'
import { KIM } from '../../fixtures/presence'
import { mockWikiPageEditor, mockWikiRevisions } from '../../fixtures/wiki-mock'
import {
  REVISION_DETAILS as DETAILS,
  REVISION_LIST as LIST,
  REVISION_LIVE as LIVE,
  REVISION_NOW as NOW,
  REVISION_PAGE_ID as PAGE_ID,
  REVISION_SPACE_ID as SPACE_ID,
  REVISION_TITLE as TITLE,
  openRevisionHistory,
  revisionItem as revItem,
  revisionPagePath as pagePath,
  revisionPreview as preview,
  revisionShot as shot,
} from '../../fixtures/wiki-revisions'

// 모바일(390px) 노트 버전 기록(WP-282) — 전체화면 목록 → 전체화면 미리보기(하단 고정 복원), ‹ = 시스템 뒤로가기.
// 데스크톱은 pages/wiki/wiki-revisions.spec.ts(데이터는 fixtures/wiki-revisions 공용). 시간대·시계 고정 이유도 그쪽과 같다.
test.use({ timezoneId: 'Asia/Seoul' })

const layer = (p: Page) => p.getByTestId('wiki-revision-mobile')
const previewLayer = (p: Page) => p.getByTestId('wiki-revision-mobile-preview')
/** 층마다 MobileDetailBar 가 있어 ‹·제목 testid 가 노트 헤더와 겹친다 — 층 안으로 좁힌다. */
const listBack = (p: Page) => layer(p).getByTestId('mobile-back').first()
const previewBack = (p: Page) => previewLayer(p).getByTestId('mobile-back')
const previewTitle = (p: Page) => previewLayer(p).getByTestId('mobile-back-title')
/** 목록 화면(헤더+목록) 묶음 — 미리보기가 덮는 동안 inert. */
const listScreen = (p: Page) => p.getByTestId('wiki-revision-list').locator('xpath=..')

/** 헤더 ⋯ → 버전 기록 → 전체화면 목록. */
const openHistory = (p: Page) => openRevisionHistory(p, { mobile: true })

/** 기본 준비 — 편집기·버전 기록 목, 시계 NOW, 노트 열기. */
async function openNote(p: Page, role: 'OWNER' | 'VIEWER' = 'OWNER') {
  await mockWikiPageEditor(p, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE, role })
  const { restores } = await mockWikiRevisions(p, { pageId: PAGE_ID, list: LIST, details: DETAILS })
  await p.clock.install({ time: NOW })
  await p.goto(pagePath)
  await expect(p.locator('.ProseMirror')).toContainText('Yjs 로 간다')
  return restores
}

test.afterEach(() => leaveAllCollabPeers())

test.describe('모바일 노트 버전 기록', () => {
  test('⋯ → 전체화면 목록 → 판 탭 → 전체화면 미리보기·하단 복원, 뒤로가기는 미리보기 → 목록 → 노트', async ({ authenticatedPage: a }) => {
    await openNote(a)
    await openHistory(a)

    // 목록 — 노트 헤더까지 덮는 전체화면(‹ 가 맨 위에 있다), 날짜로 묶고 맨 위는 현재 버전.
    await expect(a).toHaveURL(/[?&]history=1/)
    await expect(layer(a).getByTestId('mobile-back-title').first()).toHaveText('버전 기록')
    await expectOnTop(a, listBack(a), '[data-testid="wiki-revision-mobile"]')
    await expect(layer(a).locator('h3')).toHaveText(['오늘', '어제', '10월 5일'])
    await expect(revItem(a, 'current')).toHaveAttribute('aria-current', 'true')
    await expect(revItem(a, 6)).toContainText('이영희 (AI 수정)')
    // 긴 이름은 줄 안에서 말줄임 — 가로로 넘치지 않는다. 터치 타깃 44px 이상.
    await expect(revItem(a, 3)).toContainText('17:48')
    await expect.poll(() => revItem(a, 3).evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    await expectNoHorizontalOverflow(a)
    // 가려진 에디터는 inert — 숨은 contenteditable 로 입력이 가지 않는다.
    await expect(a.getByTestId('wiki-editor-scroll')).toHaveAttribute('inert', '')
    await shot(a, 'mobile-list-light')
    await a.emulateMedia({ colorScheme: 'dark' })
    await shot(a, 'mobile-list-dark')
    await a.emulateMedia({ colorScheme: 'light' })

    // 판 탭 → 미리보기 — "‹ 14:05 버전", 변경 표시(기본 켬), 하단 고정 복원.
    await revItem(a, 5).tap()
    await expect(a).toHaveURL(/[?&]rev=5/)
    await expect(previewTitle(a)).toHaveText('14:05 버전')
    await expect(preview(a).locator('h1')).toHaveText(TITLE)
    await expect(preview(a).locator('[contenteditable="true"]')).toHaveCount(0)
    // 덮인 목록은 inert·aria-hidden — 보조기술·포커스 이동이 아래 목록으로 새지 않는다.
    await expect(listScreen(a)).toHaveAttribute('inert', '')
    await expect(listScreen(a)).toHaveAttribute('aria-hidden', 'true')
    const toggle = previewLayer(a).getByTestId('wiki-revision-diff-toggle')
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => preview(a).locator('.wiki-diff-removed').allTextContents().then((t) => t.join(''))).toContain('CRDT 없이 병합으로')
    await expect(preview(a).locator('.wiki-diff-added', { hasText: '배포 체크리스트에 인그레스 타임아웃을 추가한다.' })).toBeVisible()
    const restore = previewLayer(a).getByTestId('wiki-revision-restore')
    await expect(restore).toBeVisible()
    await expectOnTop(a, restore, '[data-testid="wiki-revision-mobile-preview"]')
    // 하단 고정 — 복원 버튼 아래 끝이 화면 아래 끝 근처(본문 스크롤과 무관), 높이 44px 이상.
    const rb = (await restore.boundingBox())!
    expect(rb.height).toBeGreaterThanOrEqual(44)
    expect(rb.y + rb.height).toBeGreaterThan(a.viewportSize()!.height - 40)
    await expectNoHorizontalOverflow(a)
    await shot(a, 'mobile-preview-diff-light')
    await a.emulateMedia({ colorScheme: 'dark' })
    await shot(a, 'mobile-preview-diff-dark')
    await a.emulateMedia({ colorScheme: 'light' })

    // 변경 표시는 글자(라벨)를 눌러도 꺼진다 — 스위치만이 아니라 라벨 전체가 44px 터치 타깃.
    await previewLayer(a).getByText('변경 표시').tap()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(preview(a).locator('.wiki-diff-added, .wiki-diff-removed')).toHaveCount(0)
    await expect(preview(a)).toContainText('노트 동시 편집은 CRDT 없이 병합으로 간다.')

    // 시스템 뒤로가기 — 미리보기 → 목록(rev 지워짐, 현재 버전 선택) → 노트.
    await a.goBack()
    await expect(previewLayer(a)).toHaveCount(0)
    await expect(layer(a)).toBeVisible()
    await expect(revItem(a, 'current')).toHaveAttribute('aria-current', 'true')
    await expect(a).not.toHaveURL(/rev=/)
    await expect(listScreen(a)).not.toHaveAttribute('inert', /.*/)
    await a.goBack()
    await expect(layer(a)).toHaveCount(0)
    await expect(a).toHaveURL(new RegExp(`${pagePath}$`))
    await expect(a.getByTestId('wiki-editor-scroll')).not.toHaveAttribute('inert', /.*/)
  })

  test('‹ 도 시스템 뒤로가기와 같다 — 미리보기 → 목록 → 노트', async ({ authenticatedPage: a }) => {
    await openNote(a)
    await openHistory(a)
    await revItem(a, 4).tap()
    await expect(previewTitle(a)).toHaveText('11:20 버전')

    await previewBack(a).tap()
    await expect(previewLayer(a)).toHaveCount(0)
    await expect(a).toHaveURL(/[?&]history=1/)
    await expect(a).not.toHaveURL(/rev=/)
    await listBack(a).tap()
    await expect(layer(a)).toHaveCount(0)
    await expect(a).toHaveURL(new RegExp(`${pagePath}$`))
    // 노트에 머문다(모듈 루트로 나가지 않는다).
    await expect(a.locator('.ProseMirror')).toContainText('Yjs 로 간다')

    // 제목 입력에 포커스를 둔 채 앞으로 가기로 목록이 다시 덮으면, 가려진 제목에서 포커스가 빠진다(키보드가 내려가고 입력이 새지 않는다).
    const titleInput = a.getByPlaceholder('제목 없음')
    await titleInput.tap()
    await expect(titleInput).toBeFocused()
    await a.goForward()
    await expect(layer(a)).toBeVisible()
    await expect(titleInput).not.toBeFocused()
  })

  test('미리보기 주소로 바로 들어와도 ‹ 는 노트 안에서 목록 → 노트로 닫는다', async ({ authenticatedPage: a }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE })
    await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: DETAILS })
    await a.clock.install({ time: NOW })
    await a.goto(`${pagePath}?history=1&rev=5`)
    await expect(previewTitle(a)).toHaveText('14:05 버전')

    await previewBack(a).tap()
    await expect(previewLayer(a)).toHaveCount(0)
    await expect(layer(a)).toBeVisible()
    await expect(a).toHaveURL(new RegExp(`${pagePath}\\?history=1$`))
    await listBack(a).tap()
    await expect(layer(a)).toHaveCount(0)
    await expect(a).toHaveURL(new RegExp(`${pagePath}$`))
    await expect(a.locator('.ProseMirror')).toContainText('Yjs 로 간다')
  })

  test('복원하면 토스트 후 목록까지 닫혀 노트로 돌아가고, 본문이 그 판으로 바뀐다', async ({ authenticatedPage: a, collabNs }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE })
    const { restores } = await mockWikiRevisions(a, {
      pageId: PAGE_ID,
      list: LIST,
      details: DETAILS,
      // 실서버 복원과 같게 동기화 서버에 그 판 본문을 통째로 적용한다(replace).
      onRestore: async (_v, body) => {
        await applyCollabMarkdown(collabNs, PAGE_ID, { body, ai: false })
      },
    })
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await expect(a.locator('.ProseMirror')).toContainText('Yjs 로 간다')
    await openHistory(a)
    await revItem(a, 4).tap()
    await expect(preview(a)).toContainText('아직 정하지 않았')
    await previewLayer(a).getByTestId('wiki-revision-restore').tap()

    await expect(a.getByText('11:20 버전으로 복원했어요')).toBeVisible()
    await restores.waitFor(1)
    expect(restores.urls()[0].pathname).toBe(`/api/v1/wiki/pages/${PAGE_ID}/revisions/4/restore`)
    await expect(layer(a)).toHaveCount(0)
    await expect(a).toHaveURL(new RegExp(`${pagePath}$`))
    await expect(a.locator('.ProseMirror')).toContainText('아직 정하지 않았다.')
    await expect(a.locator('.ProseMirror')).not.toContainText('Yjs 로 간다')
    expect(await readCollabMarkdown(collabNs, PAGE_ID)).toContain('아직 정하지 않았다.')
  })

  test('뷰어는 미리보기는 보지만 하단 복원 버튼이 없다', async ({ authenticatedPage: a }) => {
    await openNote(a, 'VIEWER')
    await openHistory(a)
    await revItem(a, 5).tap()
    await expect(previewTitle(a)).toHaveText('14:05 버전')
    await expect(preview(a)).toContainText('CRDT 없이 병합으로')
    await expect(previewLayer(a).getByTestId('wiki-revision-restore')).toHaveCount(0)
    await expectNoHorizontalOverflow(a)
  })

  test('복귀 토스트 "변경 보기"는 전체화면 미리보기로 최신 판을 변경 표시로 연다', async ({ authenticatedPage: a, newAuthedPage, collabNs }) => {
    const opts = { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: LIVE }
    await mockWikiPageEditor(a, opts)
    await mockWikiRevisions(a, { pageId: PAGE_ID, list: LIST, details: DETAILS })
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.clock.install({ time: NOW })
    await a.goto(pagePath)
    await b.goto(pagePath)
    await expect(a.getByTestId('wiki-presence')).toBeVisible()

    await setPageVisibility(a, 'hidden')
    await a.clock.fastForward(BACKGROUND_DISCONNECT_MS + 1000)
    await expect(b.getByTestId('wiki-presence')).toHaveCount(0)
    await typeAtEnd(b, '이월한다.', ' 김철수가 고침')
    await expect.poll(() => readCollabMarkdown(collabNs, PAGE_ID)).toContain('김철수가 고침')

    await setPageVisibility(a, 'visible')
    await expect(a.getByText('자리를 비운 동안 1명이 수정했어요')).toBeVisible()
    await a.getByRole('button', { name: '변경 보기' }).tap()

    await expect(previewTitle(a)).toHaveText('14:32 버전')
    await expect(revItem(a, 6)).toHaveAttribute('aria-current', 'true')
    await expect(previewLayer(a).getByTestId('wiki-revision-diff-toggle')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => preview(a).locator('.wiki-diff-added').allTextContents().then((t) => t.join(''))).toContain('김철수가 고침')
    // 뒤로가기 두 번이면 노트로 — 돌아와 받은 수정이 그대로 있다.
    await a.goBack()
    await expect(previewLayer(a)).toHaveCount(0)
    await a.goBack()
    await expect(layer(a)).toHaveCount(0)
    await expect(a.locator('.ProseMirror')).toContainText('김철수가 고침')
  })
})
