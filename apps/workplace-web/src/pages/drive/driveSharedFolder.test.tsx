// 드라이브 안 보기 전용 공유 폴더 화면(/drive/shared/:shareLinkId, WP-1540) — 화면 컴포넌트 테스트(renderScreen).
// 진입 판정(목록에서 행·토큰 찾기 → info 한 번 → 열람), 경로·보기 전용 배지, 쓰기 단추 없음, 공개 파일 경로 미리보기,
// 404·410·401(갱신 뒤 재시도) 처리를 본다. 목록 행은 권한을 주지 않으므로 열람은 늘 공개 폴더 API 로 한다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { setAccessToken } from '@/api/client'
import { renderScreen } from '@/test/renderScreen'
import type { SharedWithMeItem } from '@/types/drive'

import { DriveSharedFolderView } from './DriveSharedFolderView'

// 내려받기는 앵커 클릭(jsdom 에서 이동을 일으킨다)이라 파일 저장 도우미만 끊는다 — 공개 경로 호출·재시도는 그대로 본다.
vi.mock('@/lib/download', () => ({ downloadBlob: vi.fn() }))

const PUBLIC = '/api/v1/public/drive/share/sl_f'

/** 폴더 링크 행 — 열 수 있고 비밀번호 없음이 기본. */
function folderItem(over: Partial<SharedWithMeItem> = {}): SharedWithMeItem {
  return {
    shareLinkId: 21,
    kind: 'FOLDER',
    name: '분기 보고',
    mimeType: null,
    sizeBytes: null,
    folderCount: 1,
    fileCount: 2,
    spaceName: '경영지원',
    sharedBy: '김민수',
    lastOpenedAt: '2026-11-12T03:00:00Z',
    openable: true,
    hasPassword: false,
    token: 'sl_f',
    ...over,
  }
}

const folderInfo = {
  passwordRequired: false,
  loginRequired: false,
  kind: 'FOLDER',
  name: '분기 보고',
  folderCount: 1,
  fileCount: 2,
  sharedBy: '김민수',
  loginAvailable: false,
  driveOpen: null,
}

const file = (id: number, name: string) => ({ id, name, mimeType: 'text/plain', sizeBytes: 2048, updatedAt: '2026-11-01T00:00:00Z' })
const ROOT = { id: 5, name: '분기 보고' }
const rootListing = {
  folderId: 5,
  path: [ROOT],
  folders: [{ id: 6, name: '1월', updatedAt: '2026-11-02T00:00:00Z' }],
  files: [file(31, 'a.txt'), file(32, 'b.txt')],
  truncated: false,
}
const janListing = { folderId: 6, path: [ROOT, { id: 6, name: '1월' }], folders: [], files: [file(35, 'x.txt')], truncated: false }

type Opts = {
  items?: SharedWithMeItem[]
  path?: string
  info?: () => Response
  children?: (folder: string | null) => Response
  extra?: RequestHandler[]
}

/** 화면을 그린다 — 목록·info·children·content 호출을 세어 돌려준다. */
function renderFolderView({ items = [folderItem()], path = '/drive/shared/21', info, children, extra = [] }: Opts = {}) {
  const calls = { list: 0, info: 0, children: 0, content: [] as string[] }
  const view = renderScreen(
    <Routes>
      <Route path="/drive/shared/:shareLinkId" element={<DriveSharedFolderView />} />
      <Route path="*" element={null} />
    </Routes>,
    {
      path,
      handlers: [
        // extra 를 앞에 둔다 — 같은 경로의 기본 응답보다 테스트가 준 응답이 먼저 걸리게.
        ...extra,
        http.get('/api/v1/drive/shared-with-me', () => {
          calls.list += 1
          return HttpResponse.json(items)
        }),
        http.get(PUBLIC, () => {
          calls.info += 1
          return info ? info() : HttpResponse.json(folderInfo)
        }),
        http.get(`${PUBLIC}/children`, ({ request }) => {
          calls.children += 1
          const folder = new URL(request.url).searchParams.get('folder')
          if (children) return children(folder)
          if (folder == null) return HttpResponse.json(rootListing)
          if (folder === '6') return HttpResponse.json(janListing)
          return new HttpResponse(null, { status: 404 })
        }),
        http.get(`${PUBLIC}/files/:fileId/content`, ({ request, params }) => {
          calls.content.push(new URL(request.url).pathname + `#${String(params.fileId)}`)
          return new HttpResponse(`content of ${String(params.fileId)}`, { headers: { 'Content-Type': 'text/plain' } })
        }),
      ],
    },
  )
  return { ...view, calls }
}

describe('드라이브 안 공유 폴더 화면', () => {
  // 로그인 중(메모리 액세스 토큰 있음) — 공개 fetch 가 Bearer 를 보내야 만료 토큰 갱신·재시도(shareFetch)가 걸린다.
  // 경로 nav 에 폭을 준다 — jsdom 은 레이아웃이 없어 nav 폭이 0 인데, 배지(trailing)가 있으면 Breadcrumb 가 그 간격만큼 모자라다고 보고
  // 「… › 현재」로 접는다. 넉넉한 데스크톱 폭을 흉내 내 경로 항목을 그대로 단언한다(nav 외 요소는 jsdom 기본 0 그대로).
  const navWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
  beforeEach(() => {
    setAccessToken('stale-token')
    navWidth.mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'NAV' ? 1000 : 0
    })
  })
  afterEach(() => {
    setAccessToken(null)
    navWidth.mockReset()
  })

  test('공유한 폴더를 열면 경로 「공유받은 항목 › 분기 보고」·보기 전용 배지·목록을 보이고 info 는 한 번만 묻는다', async () => {
    const { calls } = renderFolderView()

    expect(await screen.findByTestId('share-file-row-31')).toBeInTheDocument()
    expect(screen.getByTestId('share-file-row-32')).toBeInTheDocument()
    expect(screen.getByTestId('drive-shared-folder-view')).toBeInTheDocument()
    const crumbs = screen.getByTestId('drive-shared-breadcrumb')
    expect(within(crumbs).getAllByRole('listitem').filter((li) => li.textContent).map((li) => li.textContent)).toEqual(['공유받은 항목', '분기 보고'])
    expect(screen.getByTestId('drive-shared-readonly-badge')).toHaveTextContent('보기 전용')
    expect(screen.getByText('공유한 사람 김민수')).toBeInTheDocument()
    // 헤더 좌측 그룹에서 경로가 폭을 먼저 받는다 — 배지는 경로 nav 안(접기 판정이 그 폭을 센다), 「공유한 사람」은 헤더 밖 본문 첫 줄.
    // 헤더 meta 로 두면 경로(flex-1)보다 먼저 폭을 가져가 1440px 에서도 「… › 현재」로 접혔다.
    expect(within(crumbs).getByTestId('drive-shared-readonly-badge')).toBeInTheDocument()
    expect(within(screen.getByTestId('page-header')).queryByText(/공유한 사람/)).not.toBeInTheDocument()
    expect(screen.getByTestId('drive-shared-shared-by')).toHaveTextContent('공유한 사람 김민수')

    // info 가 끝나면 목록을 무효화해 다시 받는다 — 그 뒤에도 info 는 다시 묻지 않는다.
    await waitFor(() => expect(calls.list).toBe(2))
    expect(calls.info).toBe(1)
  })

  test('하위 폴더로 들어가면 ?folder= 와 경로가 바뀌고, 경로를 눌러 공유 폴더·공유받은 항목으로 간다', async () => {
    const { user, location } = renderFolderView()

    await user.click(await screen.findByRole('button', { name: '1월 폴더 열기' }))
    await waitFor(() => expect(location()).toBe('/drive/shared/21?folder=6'))
    expect(await screen.findByTestId('share-file-row-35')).toBeInTheDocument()
    const crumbs = screen.getByTestId('drive-shared-breadcrumb')
    expect(within(crumbs).getAllByRole('listitem').filter((li) => li.textContent).map((li) => li.textContent)).toEqual(['공유받은 항목', '분기 보고', '1월'])

    await user.click(screen.getByTestId('drive-shared-crumb-5'))
    await waitFor(() => expect(location()).toBe('/drive/shared/21'))
    expect(await screen.findByTestId('share-file-row-31')).toBeInTheDocument()

    await user.click(screen.getByTestId('drive-shared-crumb-root'))
    await waitFor(() => expect(location()).toBe('/drive/shared'))
  })

  test('올리기·새 폴더·이름 변경·삭제·이동 단추가 없고 파일 행엔 미리보기·다운로드만 있다', async () => {
    renderFolderView()
    const row = await screen.findByTestId('share-file-row-31')

    expect(screen.queryByTestId('drive-new-folder')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /업로드|올리기|이름 변경|삭제|이동/ })).not.toBeInTheDocument()
    expect(within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['a.txt 미리보기', 'a.txt 다운로드'])
  })

  test('미리보기는 공개 폴더 파일 경로로 연다', async () => {
    const { user, calls } = renderFolderView()

    await user.click(await screen.findByRole('button', { name: 'b.txt 미리보기' }))
    expect(await screen.findByText('content of 32')).toBeInTheDocument()
    expect(calls.content).toEqual([`${PUBLIC}/files/32/content#32`])
  })

  test('하위가 아닌 폴더(404)는 「이 폴더를 찾을 수 없습니다」와 「공유 폴더로」', async () => {
    const { user, location } = renderFolderView({ path: '/drive/shared/21?folder=999' })

    expect(await screen.findByText('이 폴더를 찾을 수 없습니다')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '공유 폴더로' }))
    await waitFor(() => expect(location()).toBe('/drive/shared/21'))
    expect(await screen.findByTestId('share-file-row-31')).toBeInTheDocument()
  })

  test('info 가 410 이면 「링크가 폐기됐거나 만료됐습니다」와 「공유받은 항목으로」, 방문이 기록되지 않았으니 목록은 다시 받지 않는다', async () => {
    const { calls } = renderFolderView({ info: () => new HttpResponse(null, { status: 410 }) })

    const closed = await screen.findByTestId('drive-shared-folder-closed')
    expect(closed).toHaveTextContent('링크가 폐기됐거나 만료됐습니다')
    expect(within(closed).getByRole('link', { name: '공유받은 항목으로' })).toHaveAttribute('href', '/drive/shared')
    expect(calls.info).toBe(1)
    expect(calls.list).toBe(1)
  })

  test('공유 폴더 자체가 404 면(둘러보는 사이 휴지통 등) 「공유받은 항목으로」 단추가 목록으로 보낸다', async () => {
    const { user, location } = renderFolderView({ children: () => new HttpResponse(null, { status: 404 }) })

    expect(await screen.findByText('이 폴더를 찾을 수 없습니다')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '공유 폴더로' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '공유받은 항목으로' }))
    await waitFor(() => expect(location()).toBe('/drive/shared'))
  })

  test('공유 폴더 자체가 404 일 때 「공유받은 항목으로」를 누르면 목록을 다시 받아 그 행이 더는 열 수 있게 보이지 않는다', async () => {
    const { user, calls } = renderFolderView({ children: () => new HttpResponse(null, { status: 404 }) })

    expect(await screen.findByText('이 폴더를 찾을 수 없습니다')).toBeInTheDocument()
    // info 성공 뒤 무효화로 한 번 더 받은 것(2)까지 기다린 뒤 센다.
    await waitFor(() => expect(calls.list).toBe(2))
    await user.click(screen.getByRole('button', { name: '공유받은 항목으로' }))
    await waitFor(() => expect(calls.list).toBe(3))
  })

  test('하위 목록이 410 이면 목록 자리에 「만료되었거나 폐기된 링크입니다.」', async () => {
    renderFolderView({ children: () => new HttpResponse(null, { status: 410 }) })

    expect(await screen.findByText('만료되었거나 폐기된 링크입니다.')).toBeInTheDocument()
  })

  test('목록에 없는 id 는 「이 항목을 찾을 수 없습니다」', async () => {
    const { calls } = renderFolderView({ path: '/drive/shared/99' })

    const missing = await screen.findByTestId('drive-shared-folder-missing')
    expect(missing).toHaveTextContent('이 항목을 찾을 수 없습니다')
    expect(missing).toHaveTextContent('목록에서 뺐거나, 지금은 그 공간 구성원이라 드라이브에서 바로 볼 수 있습니다.')
    expect(within(missing).getByRole('link', { name: '공유받은 항목으로' })).toHaveAttribute('href', '/drive/shared')
    expect(calls.info).toBe(0)
  })

  test('열 수 없는 행은 막힌 상태만 보이고 공개 API 를 부르지 않는다', async () => {
    const { calls } = renderFolderView({ items: [folderItem({ openable: false, token: null })] })

    const closed = await screen.findByTestId('drive-shared-folder-closed')
    expect(closed).toHaveTextContent('링크가 폐기됐거나 만료됐습니다')
    expect(calls.info).toBe(0)
    expect(calls.children).toBe(0)
  })

  test('토큰을 되살리지 못한 행은 「링크를 열 수 없습니다」', async () => {
    renderFolderView({ items: [folderItem({ token: null })] })

    expect(await screen.findByTestId('drive-shared-folder-closed')).toHaveTextContent('링크를 열 수 없습니다')
  })

  test('비밀번호 폴더 링크는 공유 화면으로 넘긴다', async () => {
    const { location, calls } = renderFolderView({ items: [folderItem({ hasPassword: true })] })

    await waitFor(() => expect(location()).toBe('/s/sl_f'))
    expect(calls.info).toBe(0)
  })

  test('info 응답이 잠금이면 공유 화면으로, 폴더가 아니면 공유받은 항목으로 넘긴다', async () => {
    // 로그인 상태의 loginRequired 는 갱신을 한 번 시도한다(WP-1540) — 갱신이 거절되면 그대로 공유 화면으로.
    const locked = renderFolderView({
      info: () => HttpResponse.json({ loginRequired: true, passwordRequired: false, target: 'FOLDER' }),
      extra: [http.post('/api/v1/auth/refresh', () => new HttpResponse(null, { status: 401 }))],
    })
    await waitFor(() => expect(locked.location()).toBe('/s/sl_f'))
    locked.unmount()

    const notFolder = renderFolderView({
      info: () => HttpResponse.json({ ...folderInfo, kind: 'FILE', mimeType: 'text/plain', sizeBytes: 1 }),
    })
    await waitFor(() => expect(notFolder.location()).toBe('/drive/shared'))
  })

  test('파일 행 id 면 공유받은 항목 목록으로 돌아간다', async () => {
    const { location, calls } = renderFolderView({ items: [folderItem({ kind: 'FILE', mimeType: 'text/plain', sizeBytes: 3 })] })

    await waitFor(() => expect(location()).toBe('/drive/shared'))
    expect(calls.info).toBe(0)
  })

  test('info 가 403 이면 안내 문구와 「공유받은 항목으로」', async () => {
    renderFolderView({ info: () => new HttpResponse(null, { status: 403 }) })
    expect(await screen.findByText(/이 워크스페이스 사람만 볼 수 있는 파일입니다/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '공유받은 항목으로' })).toHaveAttribute('href', '/drive/shared')
  })

  test('info 가 그 밖 실패면 「다시 시도」', async () => {
    renderFolderView({ info: () => new HttpResponse(null, { status: 500 }) })
    expect(await screen.findByText('열지 못했습니다. 잠시 후 다시 시도하세요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })

  test('갱신 뒤에도 401 이면 안내 토스트를 띄우고 공유 화면으로 간다(히스토리를 쌓지 않고 replace)', async () => {
    const historyLength = window.history.length
    const { location } = renderFolderView({
      children: () => new HttpResponse(null, { status: 401 }),
      extra: [http.post('/api/v1/auth/refresh', () => new HttpResponse(null, { status: 401 }))],
    })

    expect(await screen.findByText('다시 열어 주세요 — 공유 화면에서 확인이 필요합니다.')).toBeInTheDocument()
    await waitFor(() => expect(location()).toBe('/s/sl_f'))
    // replace 로 이동 — 이 화면이 히스토리에 남지 않아 뒤로 가기가 고리를 만들지 않는다. 이동 전 항목 /drive/shared/21 이 /s/sl_f 로 바뀐다.
    expect(window.history.length).toBe(historyLength)
  })

  test('info 가 loginRequired 여도 로그인 상태면 갱신 뒤 다시 물어 폴더를 보인다', async () => {
    let infoCalls = 0
    const { calls, location } = renderFolderView({
      info: () => {
        infoCalls += 1
        return infoCalls === 1 ? HttpResponse.json({ loginRequired: true, passwordRequired: false, target: 'FOLDER' }) : HttpResponse.json(folderInfo)
      },
      extra: [http.post('/api/v1/auth/refresh', () => HttpResponse.json({ accessToken: 'new-token' }))],
    })

    expect(await screen.findByTestId('share-file-row-31')).toBeInTheDocument()
    expect(calls.info).toBe(2)
    expect(location()).toBe('/drive/shared/21')
  })

  test('다운로드가 401 이어도 갱신되면 다시 받고 이동하지 않는다', async () => {
    let downloads = 0
    const { user, location } = renderFolderView({
      extra: [
        http.get(`${PUBLIC}/files/31/download`, () => {
          downloads += 1
          return downloads === 1 ? new HttpResponse(null, { status: 401 }) : new HttpResponse('abc', { headers: { 'Content-Type': 'text/plain' } })
        }),
        http.post('/api/v1/auth/refresh', () => HttpResponse.json({ accessToken: 'new-token' })),
      ],
    })

    await user.click(await screen.findByRole('button', { name: 'a.txt 다운로드' }))
    await waitFor(() => expect(downloads).toBe(2))
    expect(location()).toBe('/drive/shared/21')
    expect(screen.queryByTestId('share-download-error')).not.toBeInTheDocument()
  })

  test('미리보기 원본 요청이 401 이어도 갱신되면 다시 받아 보인다', async () => {
    let contents = 0
    const { user, location } = renderFolderView({
      extra: [
        http.get(`${PUBLIC}/files/32/content`, () => {
          contents += 1
          return contents === 1 ? new HttpResponse(null, { status: 401 }) : new HttpResponse('content of 32', { headers: { 'Content-Type': 'text/plain' } })
        }),
        http.post('/api/v1/auth/refresh', () => HttpResponse.json({ accessToken: 'new-token' })),
      ],
    })

    await user.click(await screen.findByRole('button', { name: 'b.txt 미리보기' }))
    expect(await screen.findByText('content of 32')).toBeInTheDocument()
    expect(contents).toBe(2)
    expect(location()).toBe('/drive/shared/21')
  })

  test('401 이어도 갱신되면 다시 물어 목록을 보인다', async () => {
    let childCalls = 0
    renderFolderView({
      children: () => {
        childCalls += 1
        return childCalls === 1 ? new HttpResponse(null, { status: 401 }) : HttpResponse.json(rootListing)
      },
      extra: [http.post('/api/v1/auth/refresh', () => HttpResponse.json({ accessToken: 'new-token' }))],
    })

    expect(await screen.findByTestId('share-file-row-31')).toBeInTheDocument()
    expect(childCalls).toBe(2)
  })
})
