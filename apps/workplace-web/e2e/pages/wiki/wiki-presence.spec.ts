import type { Locator, Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import {
  applyCollabMarkdown,
  changeCollabRole,
  connectCollabPeer,
  controlCollabSocket,
  leaveAllCollabPeers,
  presenceShot,
  readCollabMarkdown,
  typeAtEnd,
} from '../../fixtures/collab'
import { cursorOf, KIM, LONG_BODY } from '../../fixtures/presence'
import { expectStays, nextFrame, stableBox } from '../../fixtures/wait'
import { mockWikiPageEditor, pasteImageFile } from '../../fixtures/wiki-mock'
import { LABEL_SHOW_MS } from '../../../src/components/wiki/presenceLabels'

// 노트 접속자·원격 커서(WP-173 · WP-292) — 테스트 모드 동기화 서버에 실제로 붙는다. 모바일은 pages/mobile/wiki-presence.spec.ts.

const SPACE_ID = 1
const pagePath = (pageId: number) => `/wiki/spaces/${SPACE_ID}/pages/${pageId}`
/** 기본 로그인 사용자(authenticatedPage) — auth.factory createUser. */
const ME = { id: 1, name: '테스트 사용자' }
const syncStatus = (p: Page) => p.getByTestId('wiki-sync-status')
const presence = (p: Page) => p.getByTestId('wiki-presence')
const avatarIn = (p: Page) => presence(p).locator('[data-testid^="wiki-presence-avatar-"]')
const avatar = (p: Page, userId: number) => presence(p).getByTestId(`wiki-presence-avatar-${userId}`)

test.afterEach(() => leaveAllCollabPeers())

test.describe('노트 접속 알리기', () => {
  test('노트를 열면 다른 접속자에게 내 이름이 알려지고, pagehide 로 지워진 뒤 다시 붙으면 다시 알리고, 떠나면 사라진다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    const sock = await controlCollabSocket(a)
    // 앱 안에서 옮겨 갈 다른 노트 — 먼저 등록해 트리·스페이스 모킹은 아래 30번 것이 이기게 한다(나중 라우트 우선).
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 39, title: '다른 노트', body: '다른 본문' })
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 30, title: '회의록', body: '첫 문단' })
    const peer = await connectCollabPeer(collabNs, 30, { id: 3, name: '박민수' })
    await a.goto(pagePath(30))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await expect.poll(() => peer.userIds()).toEqual([ME.id])

    // pagehide(bfcache 진입 등)면 provider 가 내 로컬 awareness 를 지운다(origin 'page hide'). 이어 소켓이 끊기면 서버가 그 연결의
    // 접속자를 지워 상대에게서 내가 사라진다(서버 4.7 은 클라이언트가 보낸 null 제거를 다시 인코딩하며 버려, pagehide 만으로는 사라지지 않는다).
    // 다시 붙을 때 provider 의 startSync 는 로컬 상태가 null 이라 아무것도 보내지 않는다. 그래서 announcePresence 의
    // synced 재발행이 없으면 마지막 단언이 [] 에 머물러 실패한다(단순 drop/restore 는 provider 가 남겨 둔 로컬 상태를 다시 보내 재발행 없이도 통과한다).
    await a.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await sock.drop()
    await expect.poll(() => peer.userIds()).toEqual([])
    sock.restore()
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await expect.poll(() => peer.userIds()).toEqual([ME.id])

    // 앱 안에서 다른 노트로 옮기면(전체 새로고침 아님 — 세션 캐시는 5초 남는다) 화면이 떠나며 내린다.
    // goto('/wiki') 는 마지막 본 노트 복원으로 되돌아올 수 있어 쓰지 않는다.
    await a.evaluate(() => {
      history.pushState({}, '', '/wiki/spaces/1/pages/39')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(a.locator('.ProseMirror')).toHaveText('다른 본문')
    await expect.poll(() => peer.userIds()).toEqual([])
  })
})

test.describe('노트 헤더 접속자', () => {
  test('다른 사람이 노트를 열면 헤더에 그 사람 아바타가 보이고, 나가면 사라진다', async ({ authenticatedPage: a, newAuthedPage }) => {
    const opts = { spaceId: SPACE_ID, pageId: 31, title: '회의록', body: '첫 문단' }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.goto(pagePath(31))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    // 혼자일 땐 아무것도 없다 — 나는 표시하지 않는다.
    await expect(presence(a)).toHaveCount(0)

    await b.goto(pagePath(31))
    await expect(avatar(a, KIM.id)).toHaveText('김')
    await avatar(a, KIM.id).hover()
    await expect(a.getByRole('tooltip')).toContainText('김철수')
    await expect(avatar(b, ME.id)).toBeVisible()
    await presenceShot(a, 'header-one-person')

    await b.close()
    await expect(presence(a)).toHaveCount(0)
  })

  test('같은 사람의 다른 탭은 접속자로 보이지 않는다', async ({ authenticatedPage: a, newAuthedPage, collabNs }) => {
    const opts = { spaceId: SPACE_ID, pageId: 32, title: '회의록', body: '첫 문단' }
    await mockWikiPageEditor(a, opts)
    const sameMe = await newAuthedPage()
    await mockWikiPageEditor(sameMe, { ...opts, seed: false })
    const peer = await connectCollabPeer(collabNs, 32, { id: 3, name: '박민수' })
    await a.goto(pagePath(32))
    await sameMe.goto(pagePath(32))
    // 내 두 탭이 모두 알렸다(다른 접속자가 둘 다 본다).
    await expect.poll(() => peer.userIds().filter((id) => id === ME.id).length).toBe(2)
    await expect(avatarIn(a)).toHaveCount(1)
    await expect(avatar(a, 3)).toBeVisible()
  })

  test('접속자가 넷이면 셋과 +1, AI 작성 중인 사람이 ✦ 배지와 함께 맨 앞이고, 누르면 목록 팝오버가 열린다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 33, title: '회의록', body: '첫 문단' })
    await a.goto(pagePath(33))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    const ps = []
    for (const u of [
      { id: 3, name: '박민수' },
      { id: 4, name: '최수진' },
      { id: 5, name: '이영희' },
      { id: 6, name: '정우성' },
    ])
      ps.push(await connectCollabPeer(collabNs, 33, u))
    ps[2].setAiMarker(0, 1)

    await expect(avatarIn(a)).toHaveCount(3)
    await expect(presence(a).getByTestId('wiki-presence-more')).toHaveText('+1')
    await expect(avatarIn(a).first()).toHaveAttribute('data-testid', 'wiki-presence-avatar-5')
    await expect(a.getByTestId('wiki-presence-ai-5')).toBeVisible()

    await presence(a).click()
    const pop = a.getByTestId('wiki-presence-popover')
    await expect(pop).toContainText('이 노트를 보고 있는 사람 4')
    await expect(pop.getByTestId('wiki-presence-row-5')).toContainText('AI 작성 중')
    await expect(pop.getByTestId('wiki-presence-row-3')).toContainText('보는 중')
    await presenceShot(a, 'popover-four')
  })

  test('서버가 AI 수정을 적용하면 그 사람이 ✦ AI 작성 중으로 잠깐 보였다가 사라진다', async ({ authenticatedPage: a, collabNs }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 34, title: '회의록', body: '첫 문단' })
    await a.goto(pagePath(34))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await applyCollabMarkdown(collabNs, 34, {
      baseBody: '첫 문단',
      body: '첫 문단\n\nAI 가 더한 문단',
      actor: { userId: 9, name: '김에이아이' },
    })
    await expect(a.getByTestId('wiki-presence-ai-9')).toBeVisible()
    // 서버 표식은 COLLAB_AI_MARKER_MS(3초) 뒤 내려간다 — 노트를 열지 않은 사람이라 목록에서도 사라진다.
    await expect(presence(a)).toHaveCount(0, { timeout: 10_000 })
  })

  test('연결이 끊기면 마지막으로 본 아바타가 흐리게 남고, 다시 붙으면 또렷해지며, 접근을 잃으면 사라진다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const opts = { spaceId: SPACE_ID, pageId: 35, title: '회의록', body: '첫 문단' }
    const sock = await controlCollabSocket(a)
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.goto(pagePath(35))
    await b.goto(pagePath(35))
    await expect(avatar(a, KIM.id)).toBeVisible()

    // 소켓이 닫히면 provider(onClose)가 원격 상태를 그 자리에서 지운다. 덮개(presenceAwarenessOf)가 마지막 값을 붙잡지 않으면
    // 헤더가 비어 아래 두 단언이 실패한다 — 흐림은 "남아 있는 아바타" 가 있어야 의미가 있다.
    // drop 은 restore 전까지 재접속을 바로 닫으므로 provider 재시도가 돌아도 끊긴 채다(시계를 멈출 필요 없음).
    await sock.drop()
    await expect(presence(a)).toHaveAttribute('data-stale', 'true')
    await expect(avatar(a, KIM.id)).toBeVisible()
    sock.restore()
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live', { timeout: 10_000 })
    await expect(avatar(a, KIM.id)).toBeVisible()
    await expect(presence(a)).not.toHaveAttribute('data-stale', 'true')

    await changeCollabRole(collabNs, 35, 'NONE')
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'forbidden')
    await expect(presence(a)).toHaveCount(0)
  })

  test('목록을 연 채 접속자가 모두 나가면 목록이 닫히고, 다른 사람이 다시 들어와도 저절로 열리지 않는다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 37, title: '회의록', body: '첫 문단' })
    await a.goto(pagePath(37))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    const park = await connectCollabPeer(collabNs, 37, { id: 3, name: '박민수' })
    await presence(a).click()
    const pop = a.getByTestId('wiki-presence-popover')
    await expect(pop).toBeVisible()

    park.leave()
    await expect(presence(a)).toHaveCount(0)
    await connectCollabPeer(collabNs, 37, { id: 4, name: '최수진' })
    await expect(avatar(a, 4)).toBeVisible()
    // 열림 상태가 남아 있으면 새 접속자가 오는 순간 누르지도 않은 팝오버가 열린다.
    await expectStays(a, () => pop.count(), 0)
  })

  test('✦ AI 이름표는 사람 색이 아니라 AI 마커 색(ai-accent)이다 — 캐럿·테두리·다크 배경까지', async ({ authenticatedPage: a, collabNs }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 37, title: '회의록', body: '첫 문단' })
    await a.goto(pagePath(37))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    const peer = await connectCollabPeer(collabNs, 37, { id: 5, name: '이영희' })
    peer.setAiMarker(0, 1)
    const tag = a.locator('.wiki-ai-marker__tag')
    const caret = a.locator('.wiki-ai-marker__caret')
    await expect(tag).toContainText('이영희')
    // 토큰 값의 문자열(oklch 표기)과 계산된 색(rgb)은 표기가 달라 직접 비교하지 않는다 — 같은 토큰을 바른 탐침의 계산값과 비교한다.
    // 탐침은 body 아래라 지금 테마(html.dark 여부)의 토큰 값으로 풀린다.
    const probe = (token: string) =>
      a.evaluate((t) => {
        const el = document.createElement('span')
        el.style.background = `var(${t})`
        document.body.append(el)
        const color = getComputedStyle(el).backgroundColor
        el.remove()
        return color
      }, token)
    const colorOf = (loc: typeof tag, prop: 'backgroundColor' | 'borderTopColor') =>
      loc.evaluate((el, p) => getComputedStyle(el)[p], prop)
    /** 이영희(userId 5)의 사람 색 — presenceColorIndex(5) = 6. ✦ 의 어느 색도 이것이면 안 된다(판정 R0). */
    const PERSON = '--presence-6'

    // 라이트 — 바탕·테두리·캐럿 모두 ai-accent.
    const aiAccent = await probe('--ai-accent')
    const person = await probe(PERSON)
    expect(aiAccent).not.toBe(person)
    await expect.poll(() => colorOf(tag, 'backgroundColor')).toBe(aiAccent)
    expect(await colorOf(tag, 'borderTopColor')).toBe(aiAccent)
    expect(await colorOf(caret, 'backgroundColor')).toBe(aiAccent)
    // 같은 사람의 헤더 아바타는 사람 색이다 — ✦ 와 달라야 한다.
    const avatarBg = await a
      .getByTestId('wiki-presence-avatar-5')
      .locator('[data-slot="avatar-fallback"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(avatarBg).toBe(person)

    // 다크 — 바탕은 ai-accent-subtle(대비 보정), 테두리·캐럿은 다크 ai-accent. 어느 것도 다크 사람 색이 아니다.
    await a.evaluate(() => document.documentElement.classList.add('dark'))
    const darkAccent = await probe('--ai-accent')
    const darkSubtle = await probe('--ai-accent-subtle')
    const darkPerson = await probe(PERSON)
    expect(darkAccent).not.toBe(aiAccent) // 다크 토큰이 실제로 풀렸다
    await expect.poll(() => colorOf(tag, 'backgroundColor')).toBe(darkSubtle)
    expect(await colorOf(tag, 'borderTopColor')).toBe(darkAccent)
    expect(await colorOf(caret, 'backgroundColor')).toBe(darkAccent)
    for (const c of [darkSubtle, darkAccent]) expect(c).not.toBe(darkPerson)
  })
})

test.describe('노트 원격 커서', () => {
  test('다른 사람 커서가 입력 위치를 따라가고, 이름표는 움직일 때만 3초 보이며 캐럿에 마우스를 올리면 다시 보인다', async ({
    authenticatedPage: a,
    newAuthedPage,
  }) => {
    const opts = { spaceId: SPACE_ID, pageId: 41, title: '회의록', body: '첫 문단\n\n둘째 문단' }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.clock.install()
    await a.goto(pagePath(41))
    await b.goto(pagePath(41))
    await typeAtEnd(b, '둘째 문단', ' 추가')

    const cur = cursorOf(a, KIM.id)
    await expect(a.locator('.ProseMirror p', { has: cur })).toHaveText('둘째 문단 추가')
    await expect(cur).toHaveAttribute('data-label-visible', '')
    await expect(cur.locator('.wiki-presence-cursor__tag')).toHaveAttribute('data-name', '김철수')
    await expect(cur.locator('.wiki-presence-cursor__tag')).toBeVisible()
    await presenceShot(a, 'cursor-label')

    await a.clock.fastForward(LABEL_SHOW_MS + 100)
    await expect(cur).not.toHaveAttribute('data-label-visible')
    await expect(cur.locator('.wiki-presence-cursor__tag')).toBeHidden()

    // hover 재표시
    const caret = (await stableBox(cur.locator('.wiki-presence-cursor__caret')))
    await a.mouse.move(caret.x + caret.width / 2, caret.y + caret.height / 2)
    await expect(cur).toHaveAttribute('data-label-visible', '')
    await a.mouse.move(5, 5)
    await a.clock.fastForward(LABEL_SHOW_MS + 100)
    await expect(cur).not.toHaveAttribute('data-label-visible')

    // 다시 움직이면 다시 보인다
    await b.keyboard.press('ArrowLeft')
    await expect(cur).toHaveAttribute('data-label-visible', '')
  })

  test('문단 중간에서 타이핑해도 움직임이라 이름표가 다시 보이고 3초 뒤 꺼진다', async ({ authenticatedPage: a, newAuthedPage }) => {
    const opts = { spaceId: SPACE_ID, pageId: 50, title: '회의록', body: '첫 문단\n\n둘째 문단 가운데' }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.clock.install()
    await a.goto(pagePath(50))
    await b.goto(pagePath(50))
    // 낱말 가운데("가|운데")에 캐럿을 둔다 — 오른쪽 글자가 남아 타이핑해도 캐럿의 상대 위치 JSON 이 그대로인 자리.
    // (공백 옆은 피한다 — 텍스트 차이 계산이 공백을 삽입의 앞·뒤 어느 쪽으로 붙일지 모호해 상대 위치가 바뀔 수 있다.)
    await typeAtEnd(b, '둘째 문단 가운데', '')
    for (let i = 0; i < 2; i++) await b.keyboard.press('ArrowLeft')
    const cur = cursorOf(a, KIM.id)
    await expect(cur).toHaveAttribute('data-label-visible', '')
    await a.clock.fastForward(LABEL_SHOW_MS + 100)
    await expect(cur).not.toHaveAttribute('data-label-visible')

    await b.keyboard.type('나다')
    await expect(a.locator('.ProseMirror p', { has: cur })).toHaveText('둘째 문단 가나다운데')
    await expect(cur).toHaveAttribute('data-label-visible', '')
    await a.clock.fastForward(LABEL_SHOW_MS + 100)
    await expect(cur).not.toHaveAttribute('data-label-visible')
  })

  test('/ai 로 쓰는 사람은 사람 캐럿·이름표 없이 ✦ 캐럿·이름표 하나만 보이고, 끝나면 사람 캐럿이 돌아온다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 42, title: '회의록', body: '첫 문단' })
    await a.goto(pagePath(42))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    const peer = await connectCollabPeer(collabNs, 42, { id: 5, name: '이영희' })
    peer.setCursor(0, 2)
    const caret = cursorOf(a, 5).locator('.wiki-presence-cursor__caret')
    await expect(cursorOf(a, 5)).toHaveAttribute('data-label-visible', '')
    await expect(caret).toBeVisible()
    peer.setAiMarker(0, 2)
    await expect(cursorOf(a, 5)).toHaveAttribute('data-ai', 'true')
    await expect(cursorOf(a, 5)).not.toHaveAttribute('data-label-visible')
    // R13 + 사용자 결정(2026-10-09): 같은 자리의 사람 색 캐럿이 ✦ 캐럿을 가리지 않게 사람 캐럿도 감춘다.
    await expect(caret).toBeHidden()
    await expect(a.locator('.wiki-ai-marker__caret')).toBeVisible()
    await expect(a.locator('.wiki-ai-marker__name')).toHaveText(['이영희'])
    peer.clearAiMarker()
    await expect(a.locator('.wiki-ai-marker')).toHaveCount(0)
    await expect(cursorOf(a, 5)).not.toHaveAttribute('data-ai')
    await expect(caret).toBeVisible()
  })

  test('편집자가 보기 전용으로 바뀌면 그 사람 커서가 사라지고 다시 나타나지 않는다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const opts = { spaceId: SPACE_ID, pageId: 43, title: '회의록', body: '첫 문단\n\n둘째 문단' }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.goto(pagePath(43))
    await b.goto(pagePath(43))
    await typeAtEnd(b, '둘째 문단', '!')
    // 커서 위젯 자체는 폭 0 이라 Playwright 가 보이지 않음으로 본다 — 2px 캐럿으로 확인한다.
    await expect(cursorOf(a, KIM.id).locator('.wiki-presence-cursor__caret')).toBeVisible()

    await changeCollabRole(collabNs, 43, 'VIEWER')
    await expect(syncStatus(b)).toHaveAttribute('data-status', 'readonly')
    await expect(cursorOf(a, KIM.id)).toHaveCount(0)
    await b.locator('.ProseMirror p', { hasText: '첫 문단' }).click()
    await b.keyboard.press('ArrowRight')
    await expectStays(a, () => cursorOf(a, KIM.id).count(), 0, { ms: 1000 })
    // 여전히 접속자로는 보인다 — 보는 중
    await presence(a).click()
    await expect(a.getByTestId('wiki-presence-row-2')).toContainText('보는 중')
  })

  test('편집자가 본문에서 포커스를 떼면 그 사람 커서가 사라진다', async ({ authenticatedPage: a, newAuthedPage }) => {
    const opts = { spaceId: SPACE_ID, pageId: 49, title: '회의록', body: '첫 문단' }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.goto(pagePath(49))
    await b.goto(pagePath(49))
    await typeAtEnd(b, '첫 문단', '!')
    await expect(cursorOf(a, KIM.id).locator('.wiki-presence-cursor__caret')).toBeVisible()
    // focusout 시점에 이미 포커스가 빠져 있어야(view.hasFocus() false) 커서를 내린다 — 남아 있으면 떠난 자리에 커서가 계속 보인다.
    await b.locator('.ProseMirror').evaluate((el) => (el as HTMLElement).blur())
    await expect(cursorOf(a, KIM.id)).toHaveCount(0)
  })

  test('처음부터 보기 전용인 사람의 커서는 보이지 않지만 접속자로는 보인다', async ({ authenticatedPage: a, newAuthedPage }) => {
    const opts = { spaceId: SPACE_ID, pageId: 44, title: '회의록', body: '첫 문단' }
    await mockWikiPageEditor(a, { ...opts, collabRoles: { '2': 'VIEWER' } })
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, role: 'VIEWER', seed: false })
    await a.goto(pagePath(44))
    await b.goto(pagePath(44))
    await expect(syncStatus(b)).toHaveAttribute('data-status', 'readonly')
    await b.locator('.ProseMirror p').first().click()
    await expect(avatar(a, KIM.id)).toBeVisible()
    await expectStays(a, () => cursorOf(a, KIM.id).count(), 0, { ms: 1000 })
  })

  test('끊긴 동안 원격 커서가 마지막 자리에 흐리게 남고, 접근을 잃으면 사라진다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const opts = { spaceId: SPACE_ID, pageId: 45, title: '회의록', body: '첫 문단' }
    const sock = await controlCollabSocket(a)
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.goto(pagePath(45))
    await b.goto(pagePath(45))
    await typeAtEnd(b, '첫 문단', '!')
    await expect(cursorOf(a, KIM.id).locator('.wiki-presence-cursor__caret')).toBeVisible()

    // 소켓이 닫히면 provider(onClose)가 김철수 상태를 그 자리에서 지운다 — 덮개가 붙잡지 않으면 커서 위젯이 사라져 아래 두 단언이 실패한다.
    // drop 은 restore 전까지 재접속을 바로 닫으므로 시계를 멈출 필요가 없다.
    await sock.drop()
    await expect(a.locator('[data-presence-stale]')).toHaveCount(1)
    await expect(cursorOf(a, KIM.id)).toHaveCount(1)
    await expect.poll(() => cursorOf(a, KIM.id).evaluate((el) => getComputedStyle(el).opacity)).toBe('0.4')
    sock.restore()
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live', { timeout: 10_000 })
    await expect(a.locator('[data-presence-stale]')).toHaveCount(0)

    await typeAtEnd(b, '첫 문단', '?')
    await expect(cursorOf(a, KIM.id).locator('.wiki-presence-cursor__caret')).toBeVisible()
    await changeCollabRole(collabNs, 45, 'NONE')
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'forbidden')
    await expect(cursorOf(a, KIM.id)).toHaveCount(0)
  })

  test('목록에서 이름을 누르면 그 사람 커서로 스크롤되고 이름표가 보인다', async ({ authenticatedPage: a, newAuthedPage }) => {
    const opts = { spaceId: SPACE_ID, pageId: 46, title: '긴 회의록', body: LONG_BODY }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.clock.install()
    await a.goto(pagePath(46))
    await b.goto(pagePath(46))
    await typeAtEnd(b, '문단 40', ' 끝')
    const cur = cursorOf(a, KIM.id)
    await expect(cur).toHaveCount(1)
    await a.clock.fastForward(LABEL_SHOW_MS + 100)
    await expect(cur).not.toBeInViewport()

    await presence(a).click()
    await a.getByTestId('wiki-presence-row-2').getByRole('button').click()
    await expect(cur).toBeInViewport()
    await expect(cur).toHaveAttribute('data-label-visible', '')
  })
})

/**
 * 스크롤 영역을 top 으로 옮기고 그 scroll 이벤트가 앱에 전달될 때까지 기다린다(고정 대기 없이).
 * 이미 그 위치면 scroll 이벤트가 오지 않으므로 한 프레임 뒤 바로 끝낸다.
 */
const scrollEditorTo = (p: Page, top: number) =>
  p.getByTestId('wiki-editor-scroll').evaluate(
    (el, t) =>
      new Promise<void>((resolve) => {
        const done = () => requestAnimationFrame(() => resolve())
        if (Math.abs(el.scrollTop - t) < 1) return done()
        el.addEventListener('scroll', done, { once: true })
        el.scrollTop = t
      }),
    top,
  )

/** 문단이 스크롤 영역 맨 위에 오도록 올린다 — 에디터 위쪽(제목·요약 카드)은 화면 밖으로 나간다. */
const scrollParaToTop = async (p: Page, para: Locator) =>
  scrollEditorTo(
    p,
    await para.evaluate((el) => {
      const sc = el.closest('[data-testid="wiki-editor-scroll"]')!
      return sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top
    }),
  )

/** 손으로 풀어 주는 응답 관문 — 고정 대기 없이 "스크롤한 뒤에 도착" 을 만든다. */
function gate() {
  let open!: () => void
  const opened = new Promise<void>((r) => (open = r))
  return { opened, open }
}

test.describe('위쪽 삽입 화면 고정', () => {
  test('읽고 있는 동안 다른 사람이 위쪽에 문단을 넣어도 보던 문단이 제자리에 있다', async ({ authenticatedPage: a, collabNs }) => {
    const paras = Array.from({ length: 40 }, (_, i) => `문단 ${i + 1}`)
    const body = paras.join('\n\n')
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 52, title: '긴 노트', body })
    await a.goto(pagePath(52))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    const target = a.locator('.ProseMirror p', { hasText: /^문단 20$/ })
    // 맨 위가 아니라 내려서 읽는 중이어야 한다 — 맨 위에서 읽으면 위에 들어온 문단을 보여 준다(아래 테스트).
    await scrollParaToTop(a, target)
    const y0 = (await stableBox(target)).y

    await applyCollabMarkdown(collabNs, 52, {
      baseBody: body,
      body: ['맨 위에 넣은 문단 1', '맨 위에 넣은 문단 2', ...paras].join('\n\n'),
      ai: false,
    })
    await expect(a.locator('.ProseMirror')).toContainText('맨 위에 넣은 문단 2')
    expect(Math.abs((await stableBox(target)).y - y0)).toBeLessThanOrEqual(2)
  })

  test('맨 위에서 읽고 있으면(캐럿 없음) 다른 사람이 위쪽에 넣은 문단이 그대로 보인다', async ({ authenticatedPage: a, collabNs }) => {
    const paras = Array.from({ length: 40 }, (_, i) => `문단 ${i + 1}`)
    const body = paras.join('\n\n')
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 60, title: '긴 노트', body })
    await a.goto(pagePath(60))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await expect(a.getByTestId('wiki-editor-scroll')).toHaveJSProperty('scrollTop', 0)

    await applyCollabMarkdown(collabNs, 60, { baseBody: body, body: ['맨 위에 넣은 문단', ...paras].join('\n\n'), ai: false })
    await expect(a.locator('.ProseMirror')).toContainText('맨 위에 넣은 문단')
    await nextFrame(a)
    await expect(a.locator('.ProseMirror p', { hasText: '맨 위에 넣은 문단' })).toBeInViewport()
    await expect(a.getByTestId('wiki-editor-scroll')).toHaveJSProperty('scrollTop', 0)
  })

  test('입력하다 에디터를 떠나 맨 위에서 읽으면 다른 사람이 위쪽에 넣은 문단이 그대로 보인다', async ({ authenticatedPage: a, collabNs }) => {
    const paras = Array.from({ length: 40 }, (_, i) => `문단 ${i + 1}`)
    const body = paras.join('\n\n')
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 64, title: '긴 노트', body })
    await a.goto(pagePath(64))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await typeAtEnd(a, '문단 3', ' 가')
    await expect.poll(() => readCollabMarkdown(collabNs, 64)).toContain('문단 3 가')
    await expect(a.getByTestId('wiki-editor-scroll')).toHaveJSProperty('scrollTop', 0)
    // 에디터를 떠난다 — 남은 캐럿 기준점으로 고정하면 안 된다.
    await a.locator('.ProseMirror').evaluate((el) => (el as HTMLElement).blur())
    await expect(a.locator('.ProseMirror')).not.toBeFocused()

    const next = ['맨 위에 넣은 문단', ...paras.map((t) => (t === '문단 3' ? '문단 3 가' : t))]
    await applyCollabMarkdown(collabNs, 64, { baseBody: body.replace('문단 3', '문단 3 가'), body: next.join('\n\n'), ai: false })
    await expect(a.locator('.ProseMirror')).toContainText('맨 위에 넣은 문단')
    await nextFrame(a)
    await expect(a.locator('.ProseMirror p', { hasText: '맨 위에 넣은 문단' })).toBeInViewport()
    await expect(a.getByTestId('wiki-editor-scroll')).toHaveJSProperty('scrollTop', 0)
  })

  test('overflow-anchor 를 모르는 옛 브라우저에서도 ProseMirror 스크롤 보존이 보정을 되돌리지 않는다', async ({ authenticatedPage: a, collabNs }) => {
    // 옛 iOS Safari 흉내 — element.style.overflowAnchor 가 undefined(미지원 속성)면 ProseMirror 가 (overflowAnchor == null) 자체 스크롤
    // 보존 경로를 탄다. Chromium 은 그 속성을 인스턴스에 두어 지울 수 없으니 style 을 감싸 그 이름만 미지원처럼 보이게 한다
    // (대입하면 미지원 브라우저처럼 일반 값으로만 남는다).
    await a.addInitScript(() => {
      const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style')!
      const expando = new WeakMap<HTMLElement, unknown>()
      Object.defineProperty(HTMLElement.prototype, 'style', {
        configurable: true,
        get(this: HTMLElement) {
          const real = desc.get!.call(this) as CSSStyleDeclaration
          return new Proxy(real, {
            get: (t, k) => {
              if (k === 'overflowAnchor') return expando.get(this)
              const v = Reflect.get(t, k, t) as unknown
              return typeof v === 'function' ? (v as (...args: unknown[]) => unknown).bind(t) : v
            },
            set: (t, k, v) => {
              if (k === 'overflowAnchor') expando.set(this, v)
              else Reflect.set(t, k, v, t)
              return true
            },
          })
        },
        set(this: HTMLElement, v: string) {
          desc.set!.call(this, v)
        },
      })
    })
    const paras = Array.from({ length: 40 }, (_, i) => `문단 ${i + 1}`)
    const body = paras.join('\n\n')
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 61, title: '긴 노트', body })
    await a.goto(pagePath(61))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    // 보정 플러그인이 에디터 DOM 에 직접 넣는 값 — 이것이 ProseMirror 의 보존 경로를 끈다.
    await expect.poll(() => a.locator('.ProseMirror').evaluate((el) => (el.style as unknown as Record<string, unknown>).overflowAnchor)).toBe('none')
    const target = a.locator('.ProseMirror p', { hasText: /^문단 20$/ })
    await scrollParaToTop(a, target)
    const y0 = (await stableBox(target)).y

    await applyCollabMarkdown(collabNs, 61, { baseBody: body, body: ['맨 위에 넣은 문단 1', '맨 위에 넣은 문단 2', ...paras].join('\n\n'), ai: false })
    await expect(a.locator('.ProseMirror')).toContainText('맨 위에 넣은 문단 2')
    await nextFrame(a)
    expect(Math.abs((await stableBox(target)).y - y0)).toBeLessThanOrEqual(2)
  })

  test('입력하는 중 다른 사람이 위쪽에 문단을 넣어도 내 캐럿이 화면에서 움직이지 않는다', async ({ authenticatedPage: a, collabNs }) => {
    const paras = Array.from({ length: 40 }, (_, i) => `문단 ${i + 1}`)
    const body = paras.join('\n\n')
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 53, title: '긴 노트', body })
    await a.goto(pagePath(53))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await typeAtEnd(a, '문단 30', ' 가')
    await expect.poll(() => readCollabMarkdown(collabNs, 53)).toContain('문단 30 가')
    const caretTop = () => a.evaluate(() => window.getSelection()!.getRangeAt(0).getBoundingClientRect().top)
    const scrollTop = () => a.getByTestId('wiki-editor-scroll').evaluate((el) => el.scrollTop)
    const before = await caretTop()
    const st0 = await scrollTop()

    const added = Array.from({ length: 5 }, (_, i) => `위에 넣은 문단 ${i + 1}`)
    await applyCollabMarkdown(collabNs, 53, { baseBody: body, body: [...added, ...paras].join('\n\n'), ai: false })
    await expect(a.locator('.ProseMirror')).toContainText('위에 넣은 문단 5')

    expect(Math.abs((await caretTop()) - before)).toBeLessThanOrEqual(2)
    expect(await scrollTop()).toBeGreaterThan(st0)
    await a.keyboard.type('나')
    await expect.poll(() => readCollabMarkdown(collabNs, 53)).toContain('문단 30 가나')
  })

  test('캐럿을 둔 채 위로 스크롤해 읽는 중이면 캐럿이 아니라 보던 문단이 제자리에 있다', async ({ authenticatedPage: a, collabNs }) => {
    const paras = Array.from({ length: 60 }, (_, i) => `문단 ${i + 1}`)
    const body = paras.join('\n\n')
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 58, title: '긴 노트', body })
    await a.goto(pagePath(58))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await typeAtEnd(a, '문단 50', ' 가')
    await expect.poll(() => readCollabMarkdown(collabNs, 58)).toContain('문단 50 가')
    // 포커스는 그대로 두고 문단 10 이 위쪽에 오도록 올려 읽는다 — 캐럿(문단 50)은 화면 밖 아래.
    const target = a.locator('.ProseMirror p', { hasText: /^문단 10$/ })
    await scrollParaToTop(a, target)
    await expect(a.locator('.ProseMirror p', { hasText: '문단 50 가' })).not.toBeInViewport()
    const y0 = (await stableBox(target)).y

    // 보던 문단(10)과 캐럿(50) 사이에 넣는다 — 캐럿만 내려가고 보던 자리는 그대로여야 한다.
    const at = paras.indexOf('문단 30')
    const next = [...paras.slice(0, at), '사이에 넣은 문단 1', '사이에 넣은 문단 2', ...paras.slice(at)].map((t) => (t === '문단 50' ? '문단 50 가' : t))
    await applyCollabMarkdown(collabNs, 58, { baseBody: body.replace('문단 50', '문단 50 가'), body: next.join('\n\n'), ai: false })
    await expect(a.locator('.ProseMirror')).toContainText('사이에 넣은 문단 2')
    await nextFrame(a)
    expect(Math.abs((await stableBox(target)).y - y0)).toBeLessThanOrEqual(2)
  })
})


// 스크롤 영역의 브라우저 앵커링을 끈 뒤(WP-293)에도 화면 위쪽에서 늦게 커지는 것(이미지·AI 요약 카드)이 보던 자리를 밀지 않는다(판정 R6).
test.describe('위쪽 레이아웃 변화 화면 고정', () => {
  const paras = Array.from({ length: 60 }, (_, i) => `문단 ${i + 1}`)
  const IMG = '/api/v1/wiki/attachments/77/content'
  const TALL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="480"><rect width="300" height="480" fill="#888"/></svg>'

  test('화면 위쪽 이미지가 늦게 불러와져 커져도 보던 문단이 제자리에 있다', async ({ authenticatedPage: a }) => {
    const g = gate()
    await a.route(IMG, async (r) => {
      await g.opened
      await r.fulfill({ status: 200, contentType: 'image/svg+xml', body: TALL_SVG })
    })
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 54, title: '그림 노트', body: [`![큰 그림](${IMG})`, ...paras].join('\n\n') })
    await a.goto(pagePath(54))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await expect(a.getByTestId('wiki-image-loading')).toBeAttached()
    const target = a.locator('.ProseMirror p', { hasText: /^문단 40$/ })
    await target.scrollIntoViewIfNeeded()
    await expect(a.getByTestId('wiki-image-loading')).not.toBeInViewport()
    const y0 = (await stableBox(target)).y

    g.open()
    await expect(a.getByTestId('wiki-image')).toHaveJSProperty('complete', true)
    await expect.poll(() => a.getByTestId('wiki-image').evaluate((el: HTMLImageElement) => el.naturalHeight)).toBe(480)
    await nextFrame(a)
    expect(Math.abs((await stableBox(target)).y - y0)).toBeLessThanOrEqual(2)
  })

  test('제목이 화면 밖일 때 붙여 넣은 이미지가 자라면 아래로 자라고 머리가 잘리지 않는다', async ({ authenticatedPage: a }) => {
    const content = '/api/v1/wiki/pages/62/attachments/5/content'
    await a.route(
      (u) => u.pathname === '/api/v1/wiki/pages/62/attachments',
      (r) =>
        r.request().method() === 'POST'
          ? r.fulfill({
              status: 201,
              contentType: 'application/json',
              body: JSON.stringify({ fileId: 5, url: content, originalName: 'p.png', mimeType: 'image/png', sizeBytes: 10 }),
            })
          : r.fallback(),
    )
    await a.route(content, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: TALL_SVG }))
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 62, title: '붙여넣기', body: paras.join('\n\n') })
    await a.goto(pagePath(62))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await typeAtEnd(a, '문단 40', ' 여기')
    await a.keyboard.press('Enter')
    const line = a.locator('.ProseMirror p', { hasText: '문단 40 여기' })
    const y0 = (await stableBox(line)).y

    await pasteImageFile(a, 'image/png', 'p.png')
    await expect(a.getByTestId('wiki-image')).toHaveJSProperty('complete', true)
    await nextFrame(a)
    // 바로 위 문단이 제자리 = 이미지가 그 아래에서 아래로 자랐다(캐럿을 붙들면 이미지가 위로 자라 머리가 화면 위로 잘린다).
    expect(Math.abs((await stableBox(line)).y - y0)).toBeLessThanOrEqual(2)
    await expect(a.getByTestId('wiki-image')).toBeInViewport({ ratio: 0.1 })
    const scrollerTop = (await stableBox(a.getByTestId('wiki-editor-scroll'))).y
    expect((await stableBox(a.getByTestId('wiki-image'))).y).toBeGreaterThanOrEqual(scrollerTop)
  })

  const READY_SUMMARY = {
    summary: '첫째 줄 요약.\n\n둘째 줄 요약.\n\n셋째 줄 요약.',
    status: 'READY',
    summaryVersion: 1,
    pageVersion: 1,
    summarizedAt: '2026-10-08T05:20:00Z',
  }
  const holdSummary = async (a: Page) => {
    const g = gate()
    await a.route('**/api/v1/wiki/pages/*/summary', async (r) => {
      if (r.request().method() !== 'GET') return r.fallback()
      await g.opened
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(READY_SUMMARY) })
    })
    return g
  }

  test('스크롤한 뒤 AI 요약 카드가 늦게 나타나도 보던 문단이 제자리에 있다', async ({ authenticatedPage: a }) => {
    const g = await holdSummary(a)
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 55, title: '요약 노트', body: paras.join('\n\n') })
    await a.goto(pagePath(55))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    const target = a.locator('.ProseMirror p', { hasText: /^문단 40$/ })
    await target.scrollIntoViewIfNeeded()
    await expect(a.getByTestId('wiki-editor-scroll')).not.toHaveJSProperty('scrollTop', 0)
    const y0 = (await stableBox(target)).y

    g.open()
    await expect(a.getByTestId('wiki-ai-summary')).toContainText('셋째 줄 요약')
    await nextFrame(a)
    expect(Math.abs((await stableBox(target)).y - y0)).toBeLessThanOrEqual(2)
  })

  test('화면에 보이는 AI 요약 카드를 접고 펴도 누른 머리글이 제자리에 있다', async ({ authenticatedPage: a }) => {
    await a.route('**/api/v1/wiki/pages/*/summary', (r) =>
      r.request().method() === 'GET'
        ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(READY_SUMMARY) })
        : r.fallback(),
    )
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 59, title: '요약 노트', body: paras.join('\n\n') })
    await a.goto(pagePath(59))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    const header = a.getByTestId('wiki-ai-summary').locator('summary')
    await expect(header).toBeVisible()
    // 카드가 화면에 남을 만큼만 내린다(맨 위가 아니다).
    await scrollEditorTo(a, 40)
    await expect(header).toBeInViewport()
    const y0 = (await stableBox(header)).y

    await header.click()
    await expect(a.getByTestId('wiki-ai-summary')).not.toHaveAttribute('open')
    await nextFrame(a)
    expect(Math.abs((await stableBox(header)).y - y0)).toBeLessThanOrEqual(2)
    await header.click()
    await expect(a.getByTestId('wiki-ai-summary')).toHaveAttribute('open')
    await nextFrame(a)
    expect(Math.abs((await stableBox(header)).y - y0)).toBeLessThanOrEqual(2)
  })

  test('맨 위에서 AI 요약 카드가 늦게 나타나면 카드가 화면에 보인다(밀어 올려 숨기지 않는다)', async ({ authenticatedPage: a }) => {
    const g = await holdSummary(a)
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 56, title: '요약 노트', body: paras.join('\n\n') })
    await a.goto(pagePath(56))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')

    g.open()
    await expect(a.getByTestId('wiki-ai-summary')).toContainText('셋째 줄 요약')
    await expect(a.getByTestId('wiki-ai-summary')).toBeInViewport()
    // 늦은 보정(크기 변화 콜백)이 뒤따라 밀어 올리지 않는지 잠시 지켜본다.
    await expectStays(a, () => a.getByTestId('wiki-editor-scroll').evaluate((el) => el.scrollTop), 0)
  })
})

test.describe('노트 재연결', () => {
  test('네트워크가 돌아왔다는 online 이벤트가 오면 재시도 대기 없이 바로 다시 붙는다', async ({ authenticatedPage: a }) => {
    const sock = await controlCollabSocket(a)
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 70, title: '회의록', body: '첫 문단' })
    await a.clock.install()
    await a.goto(pagePath(70))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    // 이후 페이지 타이머는 하나도 돌지 않는다 — provider 자동 재시도도 멈춘다.
    await a.clock.pauseAt((await a.evaluate(() => Date.now())) + 50)
    await sock.drop()
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'reconnecting')
    sock.restore()
    // 재시도 타이머가 멈춰 있어 저절로는 붙지 않는다.
    await expectStays(a, () => syncStatus(a).getAttribute('data-status'), 'reconnecting', { ms: 1000 })
    await a.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
  })
})
