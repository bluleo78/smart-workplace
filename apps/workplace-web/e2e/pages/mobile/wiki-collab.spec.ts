import { changeCollabRole, controlCollabSocket, readCollabMarkdown, typeAtEnd } from '../../fixtures/collab'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { mockWikiPageEditor } from '../../fixtures/wiki-mock'

// 모바일 셸(390px)의 노트 동시 편집(WP-172) — 테스트 모드 동기화 서버에 실제로 붙는다.
// 정상(live)은 헤더 폭을 지키려 점 하나만, 문제 상태는 짧은 글자 칩. 데스크톱 시나리오는 pages/wiki/wiki-collab.spec.ts.

const SPACE_ID = 1
const pagePath = (pageId: number) => `/wiki/spaces/${SPACE_ID}/pages/${pageId}`

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
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 23, title: '노트', body: '본문' })
    await a.goto(pagePath(23))
    const chip = a.getByTestId('wiki-sync-status')
    const editor = a.locator('.ProseMirror')
    await expect(chip).toHaveAttribute('data-status', 'live')
    await expect(editor).toHaveAttribute('contenteditable', 'true')

    await changeCollabRole(collabNs, 23, 'VIEWER')
    await expect(chip).toHaveAttribute('data-status', 'readonly')
    await expect(editor).toHaveAttribute('contenteditable', 'false')

    await changeCollabRole(collabNs, 23, 'NONE')
    await expect(a.getByTestId('wiki-forbidden-notice')).toHaveText('삭제되었거나 접근 권한이 없습니다')
    await expect(chip).toHaveAttribute('data-status', 'forbidden')
    await expect(chip).toHaveText('접근 불가')
    await expectNoHorizontalOverflow(a)
  })
})
