import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { changeCollabRole, controlCollabSocket, readCollabMarkdown, seedCollabDoc, typeAtEnd } from '../../fixtures/collab'
import { expectStays, resizeAndSettle } from '../../fixtures/wait'
import { solidPng } from '../../fixtures/png'
import { buildWikiAiSse, mockWikiPageEditor, pasteImageFile } from '../../fixtures/wiki-mock'

// 노트 실시간 동시 편집(WP-172) — 테스트 모드 동기화 서버(playwright.config webServer)에 실제로 붙는다.
// 문서는 테스트마다 네임스페이스(collabNs)로 격리되고, 서버 문서 결과는 /__test/markdown 으로 읽는다.
// 모바일 셸(점 하나 칩·읽기 전용·접근 불가)은 pages/mobile/wiki-collab.spec.ts 가 다룬다.

const SPACE_ID = 1
const pagePath = (pageId: number) => `/wiki/spaces/${SPACE_ID}/pages/${pageId}`

const syncStatus = (page: Page) => page.getByTestId('wiki-sync-status')

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
