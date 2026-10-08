import type { Page } from '@playwright/test'
import { WIKI_SCHEMA_VERSION } from '@smart-workplace/wiki-editor-schema/collab-protocol'

import { expect, test } from '../../fixtures/auth.fixture'
import {
  applyCollabMarkdown,
  changeCollabRole,
  controlCollabSocket,
  readCollabMarkdown,
  seedCollabDoc,
  setCollabSchemaVersion,
  typeAtEnd,
} from '../../fixtures/collab'
import { expectStays, resizeAndSettle } from '../../fixtures/wait'
import { solidPng } from '../../fixtures/png'
import { buildWikiAiSse, mockWikiPageEditor, pasteImageFile } from '../../fixtures/wiki-mock'

// 노트 실시간 동시 편집(WP-172) — 테스트 모드 동기화 서버(playwright.config webServer)에 실제로 붙는다.
// 문서는 테스트마다 네임스페이스(collabNs)로 격리되고, 서버 문서 결과는 /__test/markdown 으로 읽는다.
// 모바일 셸(점 하나 칩·읽기 전용·접근 불가)은 pages/mobile/wiki-collab.spec.ts 가 다룬다.

const SPACE_ID = 1
const pagePath = (pageId: number) => `/wiki/spaces/${SPACE_ID}/pages/${pageId}`

const syncStatus = (page: Page) => page.getByTestId('wiki-sync-status')

/** ✦ 이름표들의 배치 — 개수, 서로 겹치지 않는지(1px 허용), 말줄임으로 잘린 이름 수. */
async function tagLayout(page: Page): Promise<{ count: number; disjoint: boolean; truncated: number }> {
  return page.evaluate(() => {
    const tags = [...document.querySelectorAll('.wiki-ai-marker__tag')]
    const rects = tags.map((t) => t.getBoundingClientRect())
    const hit = (p: DOMRect, q: DOMRect) =>
      p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1
    const disjoint = rects.every((r, i) => rects.every((q, j) => j <= i || !hit(r, q)))
    const truncated = tags.filter((t) => {
      const name = t.querySelector<HTMLElement>('.wiki-ai-marker__name')!
      return name.scrollWidth > name.clientWidth
    }).length
    return { count: tags.length, disjoint, truncated }
  })
}

/**
 * 입력이 새지 않는다 — 화면 본문과 서버 문서가 일정 시간 동안 expected 그대로인지 함께 지켜본다.
 * 입력은 비동기로 동기화되므로 즉시 한 번만 읽으면 뒤늦게 새는 편집을 놓친다.
 */
async function expectContentStays(page: Page, ns: string, pageId: number, expected: string) {
  await expectStays(
    page,
    async () => [((await page.locator('.ProseMirror').textContent()) ?? '').trim(), await readCollabMarkdown(ns, pageId)],
    [expected, expected],
    { ms: 500 },
  )
}

// 1x1 PNG — 업로드한 이미지의 content 응답(이미지 노드뷰가 blob 으로 읽는다).
const PNG = solidPng(1, 1)

/** 업로드 응답을 release() 전까지 붙잡는 목 — 업로드 중(자리표시자) 상태를 테스트가 원하는 만큼 유지한다. 반환: release. */
async function holdUpload(page: Page, pageId: number, fileId: number): Promise<() => void> {
  let release!: () => void
  const released = new Promise<void>((r) => (release = r))
  const url = `/api/v1/wiki/pages/${pageId}/attachments/${fileId}/content`
  await page.route(
    (u) => u.pathname === `/api/v1/wiki/pages/${pageId}/attachments`,
    async (r) => {
      if (r.request().method() !== 'POST') return r.fallback()
      await released
      return r.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ fileId, url, originalName: `${fileId}.png`, mimeType: 'image/png', sizeBytes: PNG.length }),
      })
    },
  )
  await page.route((u) => u.pathname === url, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  return release
}

/** 에디터 화면에 보이는 업로드 자리표시자 수(문구 등장 횟수). */
const placeholdersOn = (page: Page) =>
  page.locator('.ProseMirror').evaluate((el) => (el.textContent ?? '').split('이미지 업로드 중').length - 1)

test.describe('노트 동시 편집', () => {
  test('두 사람이 동시에 입력하면 양쪽에 모두 반영된다', async ({ authenticatedPage: a, newAuthedPage, collabNs }) => {
    // 첫 문단은 일부러 줄바꿈될 만큼 길게 — 문단 가운데를 누르는 입력 도우미가 끝이 아닌 중간에 치는 실수를 잡는다.
    const first = `첫 문단 ${'오늘 회의에서 정한 일정과 담당자를 정리한 긴 문장입니다. '.repeat(4).trim()}`
    const opts = { spaceId: SPACE_ID, pageId: 11, title: '회의록', body: `${first}\n\n둘째 문단` }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage()
    // 두 번째 컨텍스트는 같은 문서에 붙기만 한다 — 다시 시드하면 서버가 문서를 닫아 a 가 끊긴다.
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.goto(pagePath(11))
    await b.goto(pagePath(11))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await expect(syncStatus(b)).toHaveAttribute('data-status', 'live')

    await typeAtEnd(a, '첫 문단', ' A입력')
    await typeAtEnd(b, '둘째 문단', ' B입력')

    for (const p of [a, b]) {
      await expect(p.locator('.ProseMirror')).toContainText(`${first} A입력`)
      await expect(p.locator('.ProseMirror')).toContainText('둘째 문단 B입력')
    }
    await expect.poll(() => readCollabMarkdown(collabNs, 11)).toBe(`${first} A입력\n\n둘째 문단 B입력`)
  })

  test('오프라인 중 입력은 미전송 칩·안내를 보이고 다시 연결되면 다른 사람 편집과 합쳐진다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const opts = { spaceId: SPACE_ID, pageId: 12, title: '노트', body: '첫 문단\n\n둘째 문단' }
    await mockWikiPageEditor(a, opts)
    const socket = await controlCollabSocket(a)
    const b = await newAuthedPage()
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.goto(pagePath(12))
    await b.goto(pagePath(12))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await expect(syncStatus(b)).toHaveAttribute('data-status', 'live')

    await socket.drop()
    await expect(syncStatus(a)).not.toHaveAttribute('data-status', 'live')
    await typeAtEnd(a, '첫 문단', ' 오프라인 입력')
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'unsent')
    await expect(a.getByTestId('wiki-unsent-notice')).toBeVisible()
    // 잃을 수 있는 조건은 굵게 강조한다(시안 ④).
    await expect(a.getByTestId('wiki-unsent-notice').locator('strong')).toHaveText('이 화면을 닫지 않는 동안')
    // 끊긴 동안 다른 사람이 고친 내용은 서버에만 있다.
    await typeAtEnd(b, '둘째 문단', ' 온라인 입력')
    await expect.poll(() => readCollabMarkdown(collabNs, 12)).toBe('첫 문단\n\n둘째 문단 온라인 입력')

    socket.restore()
    // provider 재접속 백오프(최대 수 초)를 넘길 만큼 기다린다 — 조건이 되는 즉시 통과한다.
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live', { timeout: 30_000 })
    await expect(a.getByTestId('wiki-unsent-notice')).toHaveCount(0)
    await expect.poll(() => readCollabMarkdown(collabNs, 12)).toBe('첫 문단 오프라인 입력\n\n둘째 문단 온라인 입력')
    for (const p of [a, b]) {
      await expect(p.locator('.ProseMirror')).toContainText('첫 문단 오프라인 입력')
      await expect(p.locator('.ProseMirror')).toContainText('둘째 문단 온라인 입력')
    }
  })

  test('처음부터 동기화 서버에 못 붙으면 skeleton 대신 연결 못 함 안내를 보이고, 붙으면 본문이 나온다', async ({
    authenticatedPage: a,
  }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 18, title: '노트', body: '서버 본문' })
    const socket = await controlCollabSocket(a)
    // 열기 전부터 막는다 — 첫 동기화가 한 번도 일어나지 않는 상황(동기화 서버 장애).
    await socket.drop()
    await a.goto(pagePath(18))
    await expect(a.getByTestId('wiki-body-skeleton')).toBeVisible()
    // 첫 연결이 오프라인(5초)이 되면 skeleton 대신 안내 — 동기화 안 된 빈 문서에 입력하지 못하게 에디터는 여전히 없다.
    await expect(a.getByTestId('wiki-sync-unreachable')).toHaveText(
      '동기화 서버에 연결하지 못했어요. 연결되면 자동으로 불러옵니다',
    )
    await expect(a.getByTestId('wiki-body-skeleton')).toHaveCount(0)
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'offline')
    await expect(a.locator('.ProseMirror')).toHaveCount(0)
    await a.screenshot({ path: 'test-results/tc/wiki-collab/unreachable-desktop.png' })

    socket.restore()
    // 재시도는 계속된다 — provider 재접속 백오프를 넘길 만큼 기다린다(조건이 되는 즉시 통과).
    await expect(a.locator('.ProseMirror')).toHaveText('서버 본문', { timeout: 30_000 })
    await expect(a.getByTestId('wiki-sync-unreachable')).toHaveCount(0)
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
  })

  test('보기 권한은 읽기 전용 칩이고 입력이 반영되지 않는다', async ({ authenticatedPage: a, collabNs }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 13, title: '노트', body: '본문', role: 'VIEWER' })
    await a.goto(pagePath(13))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'readonly')
    await expect(syncStatus(a)).toHaveText('읽기 전용')
    const editor = a.locator('.ProseMirror')
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await editor.getByText('본문').click()
    await a.keyboard.type('입력 시도')
    await expectContentStays(a, collabNs, 13, '본문')
  })

  test('편집 중 서버가 보기 권한으로 낮추면 그 자리에서 에디터가 잠긴다', async ({ authenticatedPage: a, collabNs }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 14, title: '노트', body: '본문' })
    await a.goto(pagePath(14))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await typeAtEnd(a, '본문', ' 강등 전')
    await expect.poll(() => readCollabMarkdown(collabNs, 14)).toBe('본문 강등 전')

    // 화면의 스페이스 역할(OWNER)은 그대로 — 서버의 collab:role 알림만으로 잠겨야 한다.
    await changeCollabRole(collabNs, 14, 'VIEWER')
    const editor = a.locator('.ProseMirror')
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'readonly')
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    // 연결은 유지된다(끊고 다시 붙는 게 아니다) — 본문도 그대로.
    await expect(editor).toHaveText('본문 강등 전')

    // 잠긴 뒤 실제로 입력을 시도해도 화면·서버 어느 쪽에도 들어가지 않는다.
    await editor.getByText('본문 강등 전').click()
    await a.keyboard.press('End')
    await a.keyboard.type(' 강등 후')
    await expectContentStays(a, collabNs, 14, '본문 강등 전')
  })

  test('편집 중 접근 권한이 사라지면 삭제·권한 없음 안내를 보이고 편집을 막는다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 15, title: '노트', body: '본문' })
    await a.goto(pagePath(15))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')

    await changeCollabRole(collabNs, 15, 'NONE')
    await expect(a.getByTestId('wiki-forbidden-notice')).toHaveText('삭제되었거나 접근 권한이 없습니다')
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'forbidden')
    await expect(a.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
  })

  // WP-313 — 동기화 서버가 다른 스키마 판이면(배포) 옛 탭이 붙어 모르는 서식 글자를 지우지 않도록 문서를 주기 전에 거부된다.
  test('동기화 서버의 스키마 판이 다르면 새 버전 칩·안내를 보이고 편집을 막으며, 새로고침하면 다시 붙는다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 40, title: '노트', body: '서버 본문' })
    await setCollabSchemaVersion(collabNs, 40, WIKI_SCHEMA_VERSION + 1)
    await a.goto(pagePath(40))

    const chip = syncStatus(a)
    await expect(chip).toHaveAttribute('data-status', 'outdated')
    await expect(chip).toHaveText('새 버전 — 새로고침')
    await expect(chip).toHaveAttribute('title', /아직 저장되지 않은 입력은 저장되지 않습니다/)
    await expect(a.getByTestId('wiki-outdated-notice')).toContainText('새 버전이 배포되었어요')
    // 문서를 받지 못했다 — 빈 에디터는 읽기 전용이고, 거부된 뒤 다시 붙지 않는다(서버 본문이 끝내 들어오지 않는다).
    const editor = a.locator('.ProseMirror')
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await expectStays(a, async () => [await chip.getAttribute('data-status'), (await editor.textContent())?.trim()], ['outdated', ''], {
      ms: 1500,
    })
    await expect.poll(() => readCollabMarkdown(collabNs, 40)).toBe('서버 본문')

    // 새 웹이 배포된 상황 — 서버 판을 웹과 맞춘 뒤 칩(새로고침)을 누르면 다시 불러와 붙는다.
    await setCollabSchemaVersion(collabNs, 40)
    await Promise.all([a.waitForEvent('load'), chip.click()])
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await expect(editor).toHaveText('서버 본문')
    await expect(editor).toHaveAttribute('contenteditable', 'true')
  })

  test('편집 중 동기화 서버가 새 스키마 판으로 재시작하면 재접속이 거부되어 새 버전 칩을 보이고 편집을 막는다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 41, title: '노트', body: '본문' })
    const socket = await controlCollabSocket(a)
    await a.goto(pagePath(41))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await typeAtEnd(a, '본문', ' 배포 전')
    await expect.poll(() => readCollabMarkdown(collabNs, 41)).toBe('본문 배포 전')

    // 서버 재시작(새 판) — 소켓이 끊기고 provider 의 재접속이 schema-mismatch 로 거절된다.
    await setCollabSchemaVersion(collabNs, 41, WIKI_SCHEMA_VERSION + 1)
    await socket.drop()
    socket.restore()
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'outdated', { timeout: 30_000 })
    await expect(a.getByTestId('wiki-outdated-notice')).toBeVisible()
    const editor = a.locator('.ProseMirror')
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    // 끊기기 전 내용은 화면과 서버에 그대로 남는다.
    await expect(editor).toHaveText('본문 배포 전')
    await expect.poll(() => readCollabMarkdown(collabNs, 41)).toBe('본문 배포 전')

    // 안내 띠의 새로고침도 같은 동작이다.
    await setCollabSchemaVersion(collabNs, 41)
    await Promise.all([a.waitForEvent('load'), a.getByTestId('wiki-outdated-reload').click()])
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
  })

  test('문서 이름에 테스트 네임스페이스가 붙어 같은 페이지 번호의 다른 문서와 섞이지 않는다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    // 같은 페이지 번호로 네임스페이스 없는 문서·다른 네임스페이스 문서를 먼저 심어 둔다.
    await seedCollabDoc('', 16, '네임스페이스 없는 문서')
    await seedCollabDoc(`${collabNs}-other`, 16, '다른 네임스페이스 문서')
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 16, title: '노트', body: '내 문서' })
    await a.goto(pagePath(16))
    const editor = a.locator('.ProseMirror')
    await expect(editor).toHaveText('내 문서')
    await typeAtEnd(a, '내 문서', ' 수정')
    await expect.poll(() => readCollabMarkdown(collabNs, 16)).toBe('내 문서 수정')
    expect(await readCollabMarkdown('', 16)).toBe('네임스페이스 없는 문서')
    expect(await readCollabMarkdown(`${collabNs}-other`, 16)).toBe('다른 네임스페이스 문서')
  })

  test('오프라인 입력은 lg 경계 리마운트(데스크톱↔모바일 셸)를 지나도 남고, 연결되면 서버에 합쳐진다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 17, title: '노트', body: '본문' })
    const socket = await controlCollabSocket(a)
    await a.goto(pagePath(17))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')

    await socket.drop()
    await expect(syncStatus(a)).not.toHaveAttribute('data-status', 'live')
    await typeAtEnd(a, '본문', ' 리마운트 전 입력')
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'unsent')

    // 모바일 셸로 리마운트 — 미전송 세션은 붙잡혀 있어 새 에디터도 같은 문서(방금 친 글자)를 보인다.
    await resizeAndSettle(a, { width: 800, height: 900 })
    await expect(a.locator('.ProseMirror')).toContainText('본문 리마운트 전 입력')
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'unsent')
    await resizeAndSettle(a, { width: 1280, height: 720 })
    await expect(a.locator('.ProseMirror')).toContainText('본문 리마운트 전 입력')

    socket.restore()
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live', { timeout: 30_000 })
    await expect.poll(() => readCollabMarkdown(collabNs, 17)).toBe('본문 리마운트 전 입력')
  })

  // 옛 모델의 "AI 생성 중 다른 곳의 수정"(wiki-remote-sync, 최신 내용 불러오기 시 생성 취소)을 대신한다 — 이제는 취소하지 않고
  // 둘 다 남긴다. AI 결과는 done 때 시작 위치에 삽입되는데, 그 사이 다른 사람이 위쪽에 글을 넣으면 시작 때 잡은 숫자 위치가
  // 밀린다. Yjs 상대 위치(wikiCollabPosition)로 붙잡아 두므로 AI 글은 원래 자리(둘째 문단 뒤)에, 상대 편집은 그대로 남아야 한다.
  test('AI 생성 중 다른 사람이 위쪽을 고쳐도 AI 결과는 원래 자리에 들어가고 상대 편집도 남는다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const opts = { spaceId: SPACE_ID, pageId: 17, title: '회의록', body: '첫 문단\n\n둘째 문단' }
    await mockWikiPageEditor(a, opts)
    // A 의 /ai 시작 → correlationId. /events 는 B 의 편집이 서버에 닿은 뒤에야 결과(델타+done)를 흘린다.
    await a.route('**/api/v1/wiki/pages/*/ai', (route) =>
      route.request().method() === 'POST' ? route.fulfill({ json: { correlationId: 'corr-collab' } }) : route.fallback(),
    )
    let release!: () => void
    const released = new Promise<void>((r) => (release = r))
    await a.route('**/api/v1/events', async (route) => {
      await released
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: buildWikiAiSse(['AI 이어쓰기'], 'corr-collab') })
    })
    const b = await newAuthedPage()
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.goto(pagePath(17))
    await b.goto(pagePath(17))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await expect(syncStatus(b)).toHaveAttribute('data-status', 'live')

    // A: 둘째 문단 끝에서 /ai 이어쓰기 시작 — 생성 중 표시.
    await typeAtEnd(a, '둘째 문단', '/')
    await a.getByTestId('wiki-slash-option-continue').click()
    await expect(a.getByTestId('wiki-ai-busy')).toBeVisible()

    // 그 사이 B 가 위쪽(첫 문단)에 글을 넣는다 → A 의 숫자 위치가 밀리는 상황.
    await typeAtEnd(b, '첫 문단', ' B입력')
    await expect(a.locator('.ProseMirror')).toContainText('첫 문단 B입력')

    // 생성 완료 → AI 글은 둘째 문단 뒤에 들어가고, 둘째 문단·B 의 편집은 깨지지 않는다.
    release()
    await expect(a.getByTestId('wiki-ai-busy')).toHaveCount(0)
    await expect.poll(() => readCollabMarkdown(collabNs, 17)).toContain('AI 이어쓰기')
    const md = await readCollabMarkdown(collabNs, 17)
    expect(md).toContain('첫 문단 B입력')
    expect(md).toContain('둘째 문단')
    expect(md.indexOf('AI 이어쓰기')).toBeGreaterThan(md.indexOf('둘째 문단'))
    expect(md).not.toContain('/')
    await expect(b.locator('.ProseMirror')).toContainText('AI 이어쓰기')
  })

  // WP-295 — 업로드 자리표시자는 공유 문서가 아니라 각자 화면의 데코레이션이다. 예전엔 탭마다 0 부터 세는 번호의 텍스트를 문서에
  // 넣어, 두 사람이 동시에 붙여 넣으면 같은 "#1" 을 서로 찾아 이미지가 뒤바뀌고, 그 텍스트가 노트 본문에 저장됐다.
  test('두 사람이 동시에 이미지를 올려도 각자 자리에 들어가고, 자리표시자는 공유 문서에 들어가지 않으며 위쪽 편집을 따라간다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const opts = { spaceId: SPACE_ID, pageId: 18, title: '회의록', body: '맨 위\n\n첫 문단\n\n둘째 문단' }
    await mockWikiPageEditor(a, opts)
    const releaseA = await holdUpload(a, 18, 1)
    const b = await newAuthedPage()
    await mockWikiPageEditor(b, { ...opts, seed: false })
    const releaseB = await holdUpload(b, 18, 2)
    await a.goto(pagePath(18))
    await b.goto(pagePath(18))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await expect(syncStatus(b)).toHaveAttribute('data-status', 'live')

    // A 는 첫 문단 끝, B 는 둘째 문단 끝에 한 글자씩 친 뒤 붙여 넣는다 — 둘 다 업로드 중. 클릭만 하고 바로 붙여 넣으면
    // 에디터가 클릭한 커서(selectionchange 는 비동기)를 아직 못 읽어 문서 처음에 붙는다 — 입력이 커서를 확정한다.
    await typeAtEnd(a, '첫 문단', ' A')
    await pasteImageFile(a, 'image/png', 'a.png')
    await typeAtEnd(b, '둘째 문단', ' B')
    await pasteImageFile(b, 'image/png', 'b.png')
    await expect.poll(() => placeholdersOn(a)).toBe(1)
    await expect.poll(() => placeholdersOn(b)).toBe(1)

    // 업로드 중에도 자리표시자는 서버 문서(= 노트 본문으로 저장될 내용)·상대 화면에 없다.
    await expectStays(a, () => readCollabMarkdown(collabNs, 18), '맨 위\n\n첫 문단 A\n\n둘째 문단 B', { ms: 1000, reach: true })

    // B 가 위쪽(맨 위)을 고쳐도 A 의 자리표시자는 남는다.
    await typeAtEnd(b, '맨 위', ' B편집')
    await expect(a.locator('.ProseMirror')).toContainText('맨 위 B편집')
    expect(await placeholdersOn(a)).toBe(1)

    // 완료 순서를 뒤집어도 각자 자기 자리에 자기 이미지가 들어간다.
    releaseB()
    releaseA()
    const expected = '맨 위 B편집\n\n첫 문단 A![a.png](/api/v1/wiki/pages/18/attachments/1/content)\n\n둘째 문단 B![b.png](/api/v1/wiki/pages/18/attachments/2/content)'
    await expect.poll(() => readCollabMarkdown(collabNs, 18)).toBe(expected)
    for (const p of [a, b]) await expect.poll(() => placeholdersOn(p)).toBe(0)
  })
})

// WP-289·291 — 실시간 편집 중 AI(MCP·채팅 비서)의 본문 저장이 도착하는 경우. API 는 본문 PUT 을 동기화 서버의 3-way 병합
// (apply-markdown merge, 기준본 = AI 가 읽은 판)으로 넘긴다. 웹 E2E 는 API 가 모킹이라 그 내부 경로를 직접 부른다(applyCollabMarkdown).
// 사람이 치고 있는 입력과 AI 수정이 둘 다 남아야 하고(덮어쓰기 금지), AI 가 고친 자리에는 서버가 ✦ 이름표를 약 3초 보인다.
// 서버 표식은 3초 뒤 사라지므로 표식 단언·스크린샷을 먼저 하고, 본문 단언은 표식이 사라진 뒤에 한다(위젯 글자가 섞이지 않게).
test.describe('노트 편집 중 AI 본문 병합', () => {
  test('편집 중 AI 가 다른 문단을 고쳐도 내 입력과 AI 수정이 함께 남고, AI 가 고친 자리에 ✦ 이름표가 잠깐 보인다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    const body = '첫 문단\n\n둘째 문단'
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 31, title: '회의록', body })
    await a.goto(pagePath(31))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    // 내가 둘째 문단을 고치는 중 — AI 는 그 전에 읽은 판(body)을 기준으로 첫 문단을 고쳐 전체 본문을 보낸다.
    await typeAtEnd(a, '둘째 문단', ' 내입력')
    await expect.poll(() => readCollabMarkdown(collabNs, 31)).toBe('첫 문단\n\n둘째 문단 내입력')
    const out = await applyCollabMarkdown(collabNs, 31, { baseBody: body, body: '첫 문단 AI수정\n\n둘째 문단' })
    expect(out.body).toBe('첫 문단 AI수정\n\n둘째 문단 내입력')

    const marker = a.getByTestId('wiki-ai-marker')
    await expect(marker).toHaveText('김에이아이')
    await expect(marker.locator('svg')).toHaveCount(1)
    // 표식은 AI 가 고친 블록(첫 문단) 맨 앞에 붙는다.
    await expect(a.locator('.ProseMirror p').first().getByTestId('wiki-ai-marker')).toHaveCount(1)
    await a.screenshot({ path: 'test-results/tc/wiki-collab/ai-marker-desktop.png' })
    // ~3초 뒤 사라진다.
    await expect(marker).toHaveCount(0, { timeout: 8000 })
    await expect(a.locator('.ProseMirror p')).toHaveText(['첫 문단 AI수정', '둘째 문단 내입력'])
    // 내 커서는 그대로 — 이어 치면 내 문단 끝에 들어간다.
    await a.keyboard.type('!')
    await expect.poll(() => readCollabMarkdown(collabNs, 31)).toBe('첫 문단 AI수정\n\n둘째 문단 내입력!')
  })

  test('AI 가 내가 쓰던 문단의 다른 곳을 고치면 글자 단위로 합쳐진다', async ({ authenticatedPage: a, collabNs }) => {
    const body = '회의 안건을 정리합니다'
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 32, title: '회의록', body })
    await a.goto(pagePath(32))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await typeAtEnd(a, '회의 안건을 정리합니다', ' — 내 메모')
    await expect.poll(() => readCollabMarkdown(collabNs, 32)).toBe('회의 안건을 정리합니다 — 내 메모')
    await applyCollabMarkdown(collabNs, 32, { baseBody: body, body: '다음 회의 안건을 정리합니다' })
    await expect.poll(() => readCollabMarkdown(collabNs, 32)).toBe('다음 회의 안건을 정리합니다 — 내 메모')
    await expect(a.getByTestId('wiki-ai-marker')).toHaveCount(0, { timeout: 8000 })
    await expect(a.locator('.ProseMirror')).toHaveText('다음 회의 안건을 정리합니다 — 내 메모')
  })

  // 위 두 테스트는 내 입력이 서버에 닿은 뒤 병합이 온다. 여기선 병합이 도착할 때 내가 친 글자가 아직 서버로 가는 중이다 —
  // 브라우저 → 서버 메시지를 붙잡아 둔 채 치고(서버 → 브라우저는 흐름), 병합을 적용한 뒤 놓는다. 그래서 병합과 입력이 항상 겹친다.
  // 직전에 친 띄어쓰기(' 내입력 ' 끝 공백)는 이미 서버에 있다 — 병합 적용이 그걸 지우면 이어 친 글자가 앞 단어에 붙는다(WP-289 버그).
  for (const c of [
    {
      name: '다른 문단',
      pageId: 33,
      body: '첫 문단\n\n둘째 문단',
      at: '둘째 문단',
      ai: '첫 문단 AI수정\n\n둘째 문단',
      aiSeen: '첫 문단 AI수정',
      expected: '첫 문단 AI수정\n\n둘째 문단 내입력 계속 쓰는 중',
    },
    {
      name: '같은 문단의 다른 곳',
      pageId: 34,
      body: '회의 안건을 정리합니다',
      at: '회의 안건을 정리합니다',
      ai: '다음 회의 안건을 정리합니다',
      aiSeen: '다음 회의',
      expected: '다음 회의 안건을 정리합니다 내입력 계속 쓰는 중',
    },
  ]) {
    test(`내가 친 글자가 서버로 가는 중에 AI 가 ${c.name}을 고친 병합이 도착해도 내 글자와 AI 수정이 모두 남는다`, async ({
      authenticatedPage: a,
      collabNs,
    }) => {
      await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: c.pageId, title: '회의록', body: c.body })
      const socket = await controlCollabSocket(a)
      await a.goto(pagePath(c.pageId))
      await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
      await typeAtEnd(a, c.at, ' 내입력 ')
      await expect.poll(() => readCollabMarkdown(collabNs, c.pageId)).toMatch(/ 내입력 $/)

      socket.hold()
      await a.keyboard.type('계속 쓰는 중')
      await expect(a.locator('.ProseMirror')).toContainText('내입력 계속 쓰는 중')
      // 서버는 아직 이 글자를 모른다 — 그 상태에서 병합이 적용되고 결과가 내 화면에 들어온다.
      expect(await readCollabMarkdown(collabNs, c.pageId)).not.toContain('계속')
      await applyCollabMarkdown(collabNs, c.pageId, { baseBody: c.body, body: c.ai })
      await expect(a.locator('.ProseMirror')).toContainText(c.aiSeen)
      socket.release()

      await expect.poll(() => readCollabMarkdown(collabNs, c.pageId)).toBe(c.expected)
      await expect(a.getByTestId('wiki-ai-marker')).toHaveCount(0, { timeout: 8000 })
      await expect(a.locator('.ProseMirror p')).toHaveText(c.expected.split('\n\n'))
    })
  }

  // WP-291 디자이너 리뷰 I-1 — 두 사람의 AI 가 같은 블록을 잇달아 고치면 서버 표식 둘이 같은 자리에 붙는다.
  // 겹쳐 그리면 뒤 태그가 앞 태그를 가리므로(이름 하나가 사라짐) 비켜 쌓아 둘 다 온전히 보여야 한다. 표식은 약 3초라 바로 잰다.
  test('두 사람의 AI 표식이 같은 자리에 붙어도 이름표가 겹치지 않고 둘 다 온전히 보인다', async ({ authenticatedPage: a, collabNs }) => {
    const body = '첫 문단\n\n둘째 문단'
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 37, title: '회의록', body })
    await a.goto(pagePath(37))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    const first = '첫 문단 이영희AI'
    await applyCollabMarkdown(collabNs, 37, { baseBody: body, body: `${first}\n\n둘째 문단`, actor: { userId: 7, name: '이영희' } })
    await applyCollabMarkdown(collabNs, 37, {
      baseBody: `${first}\n\n둘째 문단`,
      body: `${first} 김철수AI\n\n둘째 문단`,
      actor: { userId: 8, name: '김철수' },
    })
    const markers = a.locator('.ProseMirror p').first().getByTestId('wiki-ai-marker')
    await expect(markers).toHaveCount(2)
    // 같은 자리 위젯의 DOM 순서는 정해져 있지 않다 — 이름 집합만 본다.
    expect((await markers.allTextContents()).sort()).toEqual(['김철수', '이영희'])
    await expect.poll(() => tagLayout(a), { timeout: 2000 }).toMatchObject({ count: 2, disjoint: true, truncated: 0 })
    await a.screenshot({ path: 'test-results/tc/wiki-collab/ai-marker-stacked.png' })
  })

  // WP-291 디자이너 리뷰 I-2 — 표 첫 행(머리글 칸)의 표식은 위로 펼치면 표 감싸개(overflow:auto)에 잘린다 → 캐럿 아래로 펼친다.
  test('표 첫 행에 붙은 AI 표식의 이름표는 표 감싸개에 잘리지 않게 캐럿 아래로 펼친다', async ({ authenticatedPage: a, collabNs }) => {
    const body = '표 위 문단\n\n| 이름 | 역할 |\n| --- | --- |\n| 홍길동 | 개발 |\n| 김영희 | 기획 |'
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 38, title: '회의록', body })
    await a.goto(pagePath(38))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await applyCollabMarkdown(collabNs, 38, { baseBody: body, body: body.replace('| 이름 |', '| 성명 |') })
    const marker = a.locator('.tableWrapper th').first().getByTestId('wiki-ai-marker')
    await expect(marker).toHaveText('김에이아이')
    await expect(marker).toHaveClass(/wiki-ai-marker--below/, { timeout: 2000 })
    const inside = await marker.evaluate((el) => {
      const tag = el.querySelector('.wiki-ai-marker__tag')!.getBoundingClientRect()
      const wrap = el.closest('.tableWrapper')!.getBoundingClientRect()
      return tag.top >= wrap.top && tag.bottom <= wrap.bottom && tag.right <= window.innerWidth
    })
    expect(inside).toBe(true)
    await a.screenshot({ path: 'test-results/tc/wiki-collab/ai-marker-table-first-row.png' })
  })

  test('구버전 웹(사람)의 본문 저장이 합쳐질 때는 ✦ 표식이 없다', async ({ authenticatedPage: a, collabNs }) => {
    const body = '첫 문단\n\n둘째 문단'
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 35, title: '회의록', body })
    await a.goto(pagePath(35))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await applyCollabMarkdown(collabNs, 35, { baseBody: body, body: '첫 문단 웹\n\n둘째 문단', ai: false })
    await expect(a.locator('.ProseMirror')).toContainText('첫 문단 웹')
    await expectStays(a, () => a.getByTestId('wiki-ai-marker').count(), 0, { ms: 800 })
  })

  test('내가 /ai 로 생성하는 동안 다른 사람 화면에 ✦ 내 이름표가 고정되고, 내가 끊기면 사라졌다가 다시 붙으면 돌아오며, 끝나면 사라진다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const opts = { spaceId: SPACE_ID, pageId: 36, title: '회의록', body: '첫 문단\n\n둘째 문단' }
    await mockWikiPageEditor(a, opts)
    await a.route('**/api/v1/wiki/pages/*/ai', (route) =>
      route.request().method() === 'POST' ? route.fulfill({ json: { correlationId: 'corr-marker' } }) : route.fallback(),
    )
    let release!: () => void
    const released = new Promise<void>((r) => (release = r))
    await a.route('**/api/v1/events', async (route) => {
      await released
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: buildWikiAiSse(['AI 결과'], 'corr-marker') })
    })
    const socket = await controlCollabSocket(a)
    const b = await newAuthedPage()
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.goto(pagePath(36))
    await b.goto(pagePath(36))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await expect(syncStatus(b)).toHaveAttribute('data-status', 'live')

    await typeAtEnd(a, '둘째 문단', '/')
    await a.getByTestId('wiki-slash-option-continue').click()
    await expect(a.getByTestId('wiki-ai-busy')).toBeVisible()

    const onB = b.getByTestId('wiki-ai-marker')
    await expect(onB).toHaveText('테스트 사용자')
    // 내 화면엔 내 표식이 없다. 상대 화면 표식은 서버 표식(3초)과 달리 생성 내내 고정.
    await expect(a.getByTestId('wiki-ai-marker')).toHaveCount(0)
    await expectStays(b, () => onB.count(), 1, { ms: 3500 })
    await b.screenshot({ path: 'test-results/tc/wiki-collab/ai-writing-marker-desktop.png' })

    // A 가 끊기면 서버가 A 의 awareness 를 지워 상대 화면에서 사라지고, 다시 붙으면 돌아온다.
    // (재접속 때 표식을 다시 올리는 우리 코드는 provider 도 재연결 때 로컬 awareness 를 다시 보내 E2E 로는 가려지지 않는다 —
    //  wikiAiPresence.test.ts 가 지킨다. 여기선 사용자가 보는 결과만 본다.)
    await socket.drop()
    await expect(onB).toHaveCount(0)
    socket.restore()
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live', { timeout: 30_000 })
    await expect(onB).toHaveText('테스트 사용자')

    release()
    await expect(a.getByTestId('wiki-ai-busy')).toHaveCount(0)
    await expect(onB).toHaveCount(0)
    await expect.poll(() => readCollabMarkdown(collabNs, 36)).toContain('AI 결과')
  })
})

// WP-291 — 내 /ai 생성 중 ✦ 표식(awareness)이 생성이 끝나는 모든 갈래에서 내려가는지 본다. 남으면 상대 화면에 "✦ 내 이름 작성 중" 이
// 계속 고정된다.
// (재접속 뒤 표식을 다시 올리는 동작은 provider 가 재연결 때 로컬 awareness 를 다시 보내기도 해서 E2E 로는 가려지지 않는다 — wikiAiPresence.test.ts 가 지킨다.)
test.describe('노트 /ai 생성 중 ✦ 표식 정리', () => {
  const corr = 'corr-presence'

  /**
   * A 가 둘째 문단 끝에서 /ai 이어쓰기를 시작해 생성 중인 채로 두고, 같은 문서에 붙은 B 에서 A 의 표식이 보일 때까지 간다.
   * /events 는 finish(sse) 전까지 붙잡는다. 반환한 finish 는 테스트 끝에 꼭 불러 붙잡힌 라우트를 푼다.
   */
  async function startWritingSeenByB(
    a: Page,
    newAuthedPage: () => Promise<Page>,
    pageId: number,
  ): Promise<{ b: Page; onB: ReturnType<Page['getByTestId']>; finish: (sse: string) => void }> {
    const opts = { spaceId: SPACE_ID, pageId, title: '회의록', body: '첫 문단\n\n둘째 문단' }
    await mockWikiPageEditor(a, opts)
    await a.route('**/api/v1/wiki/pages/*/ai', (route) =>
      route.request().method() === 'POST' ? route.fulfill({ json: { correlationId: corr } }) : route.fallback(),
    )
    let finish!: (sse: string) => void
    const finished = new Promise<string>((r) => (finish = r))
    await a.route('**/api/v1/events', async (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: await finished }),
    )
    const b = await newAuthedPage()
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.goto(pagePath(pageId))
    await b.goto(pagePath(pageId))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await expect(syncStatus(b)).toHaveAttribute('data-status', 'live')

    await typeAtEnd(a, '둘째 문단', '/')
    await a.getByTestId('wiki-slash-option-continue').click()
    await expect(a.getByTestId('wiki-ai-busy')).toBeVisible()
    const onB = b.getByTestId('wiki-ai-marker')
    await expect(onB).toHaveText('테스트 사용자')
    return { b, onB, finish }
  }

  test('생성이 끝나면 상대 화면의 ✦ 표식이 사라지고 결과가 들어간다', async ({ authenticatedPage: a, newAuthedPage }) => {
    const { b, onB, finish } = await startWritingSeenByB(a, newAuthedPage, 40)
    finish(buildWikiAiSse(['AI 결과'], corr))
    await expect(a.getByTestId('wiki-ai-busy')).toHaveCount(0)
    await expect(onB).toHaveCount(0)
    await expect(b.locator('.ProseMirror')).toContainText('AI 결과')
  })

  test('생성을 취소하면 상대 화면의 ✦ 표식이 사라진다', async ({ authenticatedPage: a, newAuthedPage }) => {
    const { onB, finish } = await startWritingSeenByB(a, newAuthedPage, 41)
    await a.getByTestId('wiki-ai-cancel').click()
    await expect(a.getByTestId('wiki-ai-busy')).toHaveCount(0)
    await expect(onB).toHaveCount(0)
    finish('')
  })

  test('생성이 오류로 끝나면 상대 화면의 ✦ 표식이 사라진다', async ({ authenticatedPage: a, newAuthedPage }) => {
    const { onB, finish } = await startWritingSeenByB(a, newAuthedPage, 42)
    finish(`event: wiki.ai.error\ndata: ${JSON.stringify({ correlationId: corr, message: '생성 실패' })}\n\n`)
    await expect(a.getByTestId('wiki-ai-busy')).toHaveCount(0)
    await expect(onB).toHaveCount(0)
  })

  test('생성 중 다른 노트로 옮겨 가면 상대 화면의 ✦ 표식이 사라진다', async ({ authenticatedPage: a, newAuthedPage }) => {
    const { onB, finish } = await startWritingSeenByB(a, newAuthedPage, 43)
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 44, title: '다른 노트', body: '다른 본문' })
    // 앱 안 이동(새로고침 없음) — 떠난 노트의 동기화 세션은 캐시라 잠시(GRACE 5초) 연결된 채 남는다. 그 안에 사라져야
    // 언마운트 정리가 내린 것이다(세션 파기로 사라진 것이 아니다).
    await a.evaluate((path) => {
      history.pushState(null, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, pagePath(44))
    await expect(a.locator('.ProseMirror')).toContainText('다른 본문')
    await expect(onB).toHaveCount(0, { timeout: 2500 })
    finish('')
  })

  // latest action wins — 생성 중 다시 /ai 를 시작하면 앞 생성은 취소된다. 그 앞 생성의 결과(델타·done)가 뒤늦게 도착해도
  // 새 생성의 표식을 내리거나 결과를 넣으면 안 된다. 지금은 취소 때 앞 생성의 구독이 풀려(useWikiAiStream abort→teardown)
  // 늦은 이벤트가 콜백까지 오지 않는다 — 이 테스트는 그 결과(새 표식 유지·늦은 결과 미삽입·표식 자리 교체)를 사용자 화면으로 본다.
  // 구독이 남는 회귀가 생기면 실행별 stop(WikiEditor)이 표식을 지키지만 늦은 결과가 들어가 여기서 걸린다.
  test('생성 중 다시 /ai 를 시작한 뒤 앞 생성의 늦은 완료가 와도 새 생성의 ✦ 표식은 남고, 새 생성이 끝나야 사라진다', async ({
    authenticatedPage: a,
    newAuthedPage,
  }) => {
    const opts = { spaceId: SPACE_ID, pageId: 45, title: '회의록', body: '첫 문단\n\n둘째 문단' }
    await mockWikiPageEditor(a, opts)
    // 시작 요청마다 다른 correlationId — 첫 번째는 corr-old, 두 번째는 corr-new.
    const corrs = ['corr-old', 'corr-new']
    await a.route('**/api/v1/wiki/pages/*/ai', (route) =>
      route.request().method() === 'POST' ? route.fulfill({ json: { correlationId: corrs.shift() } }) : route.fallback(),
    )
    // /events 는 deliver(sse) 때까지 붙잡는다. 한 번 흘리면 스트림이 닫히고 클라이언트가 다시 붙는데, 그 새 연결은 다음 deliver 를
    // 기다린다. connects 는 지금까지 들어온 연결 수 — 흘린 뒤 다시 붙었다는 건 흘린 이벤트를 다 읽었다는 뜻이다.
    let connects = 0
    const held = () => {
      let resolve!: (sse: string) => void
      const promise = new Promise<string>((r) => (resolve = r))
      return { promise, resolve }
    }
    let current = held()
    const deliver = (sse: string) => {
      current.resolve(sse)
      current = held()
    }
    await a.route('**/api/v1/events', async (route) => {
      connects += 1
      const body = await current.promise
      // 그새 닫힌 연결(개발 모드 이중 마운트 등)은 응답할 곳이 없다 — 무시한다.
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body }).catch(() => {})
    })
    const b = await newAuthedPage()
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.goto(pagePath(45))
    await b.goto(pagePath(45))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await expect(syncStatus(b)).toHaveAttribute('data-status', 'live')

    // 앞 생성: 둘째 문단 끝.
    await typeAtEnd(a, '둘째 문단', '/')
    await a.getByTestId('wiki-slash-option-continue').click()
    await expect(a.getByTestId('wiki-ai-busy')).toBeVisible()
    const onB = b.getByTestId('wiki-ai-marker')
    await expect(b.locator('.ProseMirror p').nth(1).getByTestId('wiki-ai-marker')).toHaveText('테스트 사용자')

    // 새 생성: 첫 문단 끝 — 표식 자리가 달라 B 화면에서 교체가 끝났는지 알 수 있다.
    await typeAtEnd(a, '첫 문단', '/')
    await a.getByTestId('wiki-slash-option-continue').click()
    await expect(a.getByTestId('wiki-ai-busy')).toBeVisible()
    await expect(b.locator('.ProseMirror p').first().getByTestId('wiki-ai-marker')).toHaveText('테스트 사용자')
    await expect(onB).toHaveCount(1)

    // 앞 생성의 늦은 결과·완료를 흘리고, 클라이언트가 그걸 다 읽고 다시 붙을 때까지 기다린다.
    const before = connects
    deliver(buildWikiAiSse(['늦은 결과'], 'corr-old'))
    await expect.poll(() => connects).toBeGreaterThan(before)
    // 새 생성은 그대로 진행 중 — 표식은 첫 문단에 하나로 남고, 늦은 결과는 들어가지 않는다.
    await expectStays(
      b,
      async () => [await onB.count(), await b.locator('.ProseMirror p').first().getByTestId('wiki-ai-marker').count()],
      [1, 1],
      { ms: 800 },
    )
    await expect(a.getByTestId('wiki-ai-busy')).toBeVisible()
    await expect(a.locator('.ProseMirror')).not.toContainText('늦은 결과')

    // 새 생성이 끝나야 표식이 사라지고 그 결과만 들어간다.
    deliver(buildWikiAiSse(['새 결과'], 'corr-new'))
    await expect(a.getByTestId('wiki-ai-busy')).toHaveCount(0)
    await expect(onB).toHaveCount(0)
    await expect(b.locator('.ProseMirror')).toContainText('새 결과')
    await expect(b.locator('.ProseMirror')).not.toContainText('늦은 결과')
  })
})
