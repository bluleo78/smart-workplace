// 드라이브 공유 링크 앱 카드(WP-1474) — 보는 사람 권한으로 받은 상태(구성원·열림·비밀번호)나 오류(만료 410·볼 수 없음 404)마다 카드 모양·문구·이동 경로가 다르다.
// 비구성원에게는 비밀번호·만료 링크의 이름이 화면에 나오지 않는다(서버가 이름 대신 고정 제목을 주거나 410 으로 답한다).
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import type { AppLinkCard as AppLinkCardData } from '@/api/appLinks'
import type { AppLink } from '@/lib/appLinks'
import { driveFolderPath } from '@/lib/appUrl'
import { server } from '@/test/msw/server'
import { renderWithProviders } from '@/test/renderWithProviders'

import { AppLinkCard, AppLinkCardPreview } from './AppLinkCard'

const TOKEN = 'sl_Ab3xYz'
const LINK: AppLink = { kind: 'SHARE', to: `/s/${TOKEN}`, token: TOKEN }
const TEST_ID = 'app-link-1-0'
/** 비밀번호 링크 카드의 제목 — 서버가 파일 이름 대신 주는 고정 문구. */
const PASSWORD_TITLE = '비밀번호로 보호된 공유 파일'

/** 공유 링크 카드 응답을 깔고 카드 하나를 그린다 — 받을 때까지 기다린다. */
async function renderShare(card: AppLinkCardData | { status: number }) {
  const requested: string[] = []
  server.use(
    http.get('/api/v1/app-links/shares/:token', ({ params }) => {
      requested.push(String(params.token))
      return 'status' in card ? HttpResponse.json({ message: '없음' }, { status: card.status }) : HttpResponse.json(card)
    }),
  )
  renderWithProviders(<AppLinkCard messageId={1} index={0} link={LINK} />)
  await waitFor(() => expect(screen.getByTestId(TEST_ID)).not.toHaveAttribute('data-state', 'loading'))
  expect(requested).toEqual([TOKEN])
  return screen.getByTestId(TEST_ID)
}

/**
 * 구성원이 아닌 공유 링크 카드는 공유 링크 화면을 새 탭으로 여는 보통 <a> 다 — /s/<token> 은 AppLayout 밖 공개 화면이고 서비스 워커가
 * 서버로 보내는 주소(isOutsideSpaPath)라 앱 안 이동(SPA)으로 열면 안 된다.
 */
function expectNewTabShareLink(card: HTMLElement) {
  expect(card.tagName).toBe('A')
  expect(card).toHaveAttribute('href', `/s/${TOKEN}`)
  expect(card).toHaveAttribute('target', '_blank')
  expect(card).toHaveAttribute('rel', 'noopener noreferrer')
}

describe('AppLinkCard — 드라이브 공유 링크(WP-1474)', () => {
  it('공간 구성원은 드라이브 파일 카드 — 「파일 · 공간」 + 이름, 누르면 드라이브의 그 파일(폴더 포함)', async () => {
    const card = await renderShare({
      kind: 'SHARE', shareState: 'MEMBER', title: '2026 사업계획_최종.pdf', mimeType: 'application/pdf',
      spaceName: '경영기획팀 공간', driveSpaceId: 5, driveFolderId: 12, driveFileId: 77,
    })
    expect(card).toHaveAttribute('data-state', 'ready')
    expect(card).toHaveTextContent('파일 · 경영기획팀 공간')
    expect(screen.getByTestId(`${TEST_ID}-title`)).toHaveTextContent('2026 사업계획_최종.pdf')
    expect(card).toHaveAttribute('href', '/drive/spaces/5?folderId=12&preview=77')
    // 구성원은 앱 안 이동(새 탭 아님)
    expect(card).not.toHaveAttribute('target')
    expect(screen.queryByTestId(`${TEST_ID}-meta`)).not.toBeInTheDocument()
  })

  it('글자만 있는 머리글 래퍼는 말줄임표(truncate)를 지키고 flex 컨테이너가 아니다', async () => {
    const card = await renderShare({
      kind: 'SHARE', shareState: 'MEMBER', title: 'a.pdf', mimeType: 'application/pdf', spaceName: '아주 긴 공간 이름',
    })
    const headWrapper = screen.getByTestId(`${TEST_ID}-title`).previousElementSibling as HTMLElement
    expect(card).toContainElement(headWrapper)
    expect(headWrapper).toHaveClass('truncate')
    expect(headWrapper).not.toHaveClass('flex')
  })

  it('구성원이고 파일이 공간 루트면 폴더 없이 드라이브 미리보기로 간다', async () => {
    const card = await renderShare({
      kind: 'SHARE', shareState: 'MEMBER', title: 'a.txt', mimeType: 'text/plain', spaceName: '팀', driveSpaceId: 5, driveFileId: 77,
    })
    expect(card).toHaveAttribute('href', '/drive/spaces/5?preview=77')
  })

  it('링크로 열 수 있으면 「공유 링크 · 만료일까지」 + 이름 + 「종류 · 크기」, 누르면 공유 링크 화면', async () => {
    const year = new Date().getFullYear()
    // 올해의 11월 18일 정오(로컬) — 올해면 연도 없이 월·일만.
    const expiresAt = new Date(year, 10, 18, 12).toISOString()
    const card = await renderShare({
      kind: 'SHARE', shareState: 'OPEN', title: 'a.pdf', mimeType: 'application/pdf', typeLabel: 'PDF', sizeBytes: 2411724, expiresAt,
    })
    expect(card).toHaveTextContent('공유 링크 · 11월 18일까지')
    expect(screen.getByTestId(`${TEST_ID}-title`)).toHaveTextContent('a.pdf')
    expect(screen.getByTestId(`${TEST_ID}-meta`)).toHaveTextContent('PDF · 2.3 MB')
    expectNewTabShareLink(card)
  })

  it('만료일이 올해가 아니면 연도까지, 만료일이 없으면 머리글은 「공유 링크」만', async () => {
    const card = await renderShare({
      kind: 'SHARE', shareState: 'OPEN', title: 'b.pdf', typeLabel: 'PDF', sizeBytes: 100, expiresAt: '2020-03-05T12:00:00Z',
    })
    expect(card).toHaveTextContent('공유 링크 · 2020년 3월 5일까지')
    expect(screen.getByTestId(`${TEST_ID}-meta`)).toHaveTextContent('PDF · 100 B')
  })

  it('만료일 없는 링크는 머리글에 날짜가 없다', async () => {
    const card = await renderShare({ kind: 'SHARE', shareState: 'OPEN', title: 'c.pdf', typeLabel: 'PDF', sizeBytes: 2048 })
    expect(card).toHaveTextContent(/^공유 링크c\.pdfPDF · 2\.0 KB$/)
  })

  it('비밀번호 링크는 자물쇠 + 서버가 준 고정 제목만 — 이름·크기·종류 자리가 없고, 누르면 공유 링크 화면(비밀번호 입력)', async () => {
    const card = await renderShare({ kind: 'SHARE', shareState: 'PASSWORD', title: PASSWORD_TITLE })
    expect(card).toHaveAttribute('data-state', 'ready')
    expect(card).toHaveTextContent(/^공유 링크비밀번호로 보호된 공유 파일$/)
    expect(screen.queryByTestId(`${TEST_ID}-meta`)).not.toBeInTheDocument()
    expectNewTabShareLink(card)
  })

  it('만료·폐기·없는 링크(410)는 링크가 아닌 점선 자리 「만료된 공유 링크입니다」', async () => {
    const card = await renderShare({ status: 410 })
    expect(card).toHaveAttribute('data-state', 'expired')
    expect(card.tagName).not.toBe('A')
    expect(card).not.toHaveAttribute('href')
    expect(card).toHaveTextContent('만료된 공유 링크입니다')
  })

  it('다른 워크스페이스의 내부 링크(404)는 「볼 수 없는 파일입니다」', async () => {
    const card = await renderShare({ status: 404 })
    expect(card).toHaveAttribute('data-state', 'denied')
    expect(card).toHaveTextContent('볼 수 없는 파일입니다')
  })
})

describe('AppLinkCard — 폴더 공유 링크(WP-1538)', () => {
  it('폴더 OPEN: 머리 「폴더」 + 배지 「외부 공유」, 이름, 덧줄 「폴더 2개 · 파일 4개 · 김공유」, 폴더 아이콘, 새 탭 /s/', async () => {
    const card = await renderShare({
      kind: 'SHARE', shareTarget: 'FOLDER', shareState: 'OPEN', title: '견적', audience: 'EXTERNAL', folderCount: 2, fileCount: 4, sharedBy: '김공유',
    })
    expect(card).toHaveTextContent('폴더')
    expect(card).toHaveTextContent('외부 공유')
    expect(screen.getByTestId(`${TEST_ID}-title`)).toHaveTextContent('견적')
    expect(screen.getByTestId(`${TEST_ID}-meta`)).toHaveTextContent('폴더 2개 · 파일 4개 · 김공유')
    expect(card.querySelector('svg.lucide-folder')).not.toBeNull()
    expectNewTabShareLink(card)
  })

  it('폴더 MEMBER 사내: 같은 몸통, 배지 「사내 공유」, 누르면 같은 창에서 드라이브 폴더', async () => {
    const card = await renderShare({
      kind: 'SHARE', shareTarget: 'FOLDER', shareState: 'MEMBER', title: '견적', audience: 'INTERNAL', folderCount: 2, fileCount: 4, sharedBy: '김공유',
      spaceName: '팀', driveSpaceId: 3, driveFolderId: 20,
    })
    expect(card).toHaveTextContent('사내 공유')
    expect(screen.getByTestId(`${TEST_ID}-meta`)).toHaveTextContent('폴더 2개 · 파일 4개 · 김공유')
    expect(card).toHaveAttribute('href', driveFolderPath(3, 20))
    expect(card).not.toHaveAttribute('target')
  })

  it('폴더 PASSWORD: 자물쇠 + 서버가 준 고정 제목, 덧줄 없음', async () => {
    const card = await renderShare({ kind: 'SHARE', shareTarget: 'FOLDER', shareState: 'PASSWORD', title: '비밀번호로 보호된 공유 폴더' })
    expect(card).toHaveTextContent('비밀번호로 보호된 공유 폴더')
    expect(card.querySelector('svg.lucide-lock')).not.toBeNull()
    expect(screen.queryByTestId(`${TEST_ID}-meta`)).not.toBeInTheDocument()
    expectNewTabShareLink(card)
  })

  it('파일 공유 카드는 그대로 — 공유한 사람·배지 없음', async () => {
    const card = await renderShare({
      kind: 'SHARE', shareTarget: 'FILE', shareState: 'OPEN', title: 'a.pdf', typeLabel: 'PDF', sizeBytes: 100, sharedBy: '김공유',
    })
    expect(card).not.toHaveTextContent('외부 공유')
    expect(card).not.toHaveTextContent('김공유')
    expect(screen.getByTestId(`${TEST_ID}-meta`)).toHaveTextContent('PDF · 100 B')
  })
})

describe('AppLinkCardPreview — 공유 링크(WP-1474)', () => {
  const fallback = <div data-testid="fallback">대상 이름</div>

  it('받은 카드를 링크 없이 같은 본문으로 그린다', async () => {
    server.use(
      http.get('/api/v1/app-links/shares/:token', () => HttpResponse.json({ kind: 'SHARE', shareState: 'PASSWORD', title: PASSWORD_TITLE })),
    )
    renderWithProviders(<AppLinkCardPreview link={LINK} testId="preview" fallback={fallback} />)
    const card = await screen.findByTestId('preview')
    expect(card).toHaveTextContent(PASSWORD_TITLE)
    expect(card).not.toHaveAttribute('href')
  })

  it('만료된 링크(410)면 대상 이름으로 그린 자리(fallback)를 보인다', async () => {
    let called = false
    server.use(
      http.get('/api/v1/app-links/shares/:token', () => {
        called = true
        return HttpResponse.json({ message: '만료' }, { status: 410 })
      }),
    )
    renderWithProviders(<AppLinkCardPreview link={LINK} testId="preview" fallback={fallback} />)
    await waitFor(() => expect(called).toBe(true))
    // 받은 뒤에도 fallback 그대로다.
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('preview')).not.toBeInTheDocument()
  })
})
