// @vitest-environment jsdom
// 드라이브 「별표」(WP-1698) — 화면 컴포넌트 테스트(renderScreen).
// 「별표」 목록(행 칸·빈 화면·더 불러오기), 별표 빼기 토스트와 되돌리기(여러 행을 연달아 빼도 각자 맞는 항목), 폴더 클릭 이동 주소·파일 클릭 보기 창,
// 행 ⋯ 메뉴(위치 열기·링크 복사·빼기), 사이드바 입구 순서, 공간 화면 행 메뉴 「별표」/「별표 빼기」와 이름 옆 별, 보기 창 별표 단추를 본다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test, vi } from 'vitest'

import { DriveSidebar } from '@/components/drive/DriveSidebar'
import { API, driveBaseHandlers, fileSideHandlers, renderDrivePage } from '@/test/kits/drive/testkit-b6'
import { clickRetryAndExpectErrorKept, gate } from '@/test/loadErrorRetry'
import { PAGE_LOAD_TIMEOUT } from '@/test/renderPage'
import { renderScreen } from '@/test/renderScreen'
import type { DriveFile, DriveFolder, DriveStarredItem, DriveStarTarget } from '@/types/drive'

import { createFile, createFolder } from '../../../e2e/factories/drive.factory'
import { DriveStarredView } from './DriveStarredView'

const fileItem: DriveStarredItem = {
  kind: 'FILE',
  id: 70,
  name: '사업계획.txt',
  mimeType: 'text/plain',
  sizeBytes: 2048,
  fileId: 970,
  category: 'TEXT',
  versionCount: 1,
  available: true,
  folderCount: null,
  fileCount: null,
  parentFolderId: 12,
  path: '보고/1분기',
  spaceId: 3,
  spaceName: '경영지원',
  updatedAt: '2026-11-12T03:00:00Z',
  starredAt: '2026-11-13T03:00:00Z',
}

const folderItem: DriveStarredItem = {
  ...fileItem,
  kind: 'FOLDER',
  id: 12,
  name: '1분기',
  mimeType: null,
  sizeBytes: null,
  fileId: null,
  category: null,
  versionCount: null,
  available: null,
  folderCount: 2,
  fileCount: 5,
  parentFolderId: 4,
  path: '보고',
}

const otherFile: DriveStarredItem = { ...fileItem, id: 71, name: '예산.txt', fileId: 971 }

/** 「별표」 목록 서버 — GET 은 지금 별표(커서로 나눠), PUT·DELETE 는 본문을 모으고 상태를 바꾼다. pageSize 로 한 페이지 크기를 정한다. */
function starredServer(initial: DriveStarredItem[], { pageSize = 50 } = {}) {
  const all = [...initial]
  const state = { starred: new Set(initial.map((i) => `${i.kind}:${i.id}`)), puts: [] as DriveStarTarget[], deletes: [] as DriveStarTarget[], cursors: [] as (string | null)[] }
  const visible = () => all.filter((i) => state.starred.has(`${i.kind}:${i.id}`))
  const handlers: RequestHandler[] = [
    http.get(`${API}/starred`, ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      state.cursors.push(cursor)
      const start = cursor == null ? 0 : Number(cursor)
      const items = visible().slice(start, start + pageSize)
      const next = start + pageSize < visible().length ? String(start + pageSize) : null
      return HttpResponse.json({ items, nextCursor: next })
    }),
    http.put(`${API}/stars`, async ({ request }) => {
      const body = (await request.json()) as DriveStarTarget
      state.puts.push(body)
      state.starred.add(`${body.kind}:${body.id}`)
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete(`${API}/stars`, async ({ request }) => {
      const body = (await request.json()) as DriveStarTarget
      state.deletes.push(body)
      state.starred.delete(`${body.kind}:${body.id}`)
      return new HttpResponse(null, { status: 204 })
    }),
  ]
  return { state, handlers }
}

describe('「별표」 목록', () => {
  test('행마다 이름·경로·크기·공간·별표한 날, 폴더는 폴더 n개·파일 n개', async () => {
    const { handlers } = starredServer([fileItem, folderItem])
    renderScreen(<DriveStarredView />, { path: '/drive/starred', handlers })

    const fileRow = await screen.findByTestId('drive-starred-row-file-70')
    expect(within(fileRow).getByRole('button', { name: '사업계획.txt' })).toBeInTheDocument()
    expect(within(fileRow).getByTestId('drive-starred-meta-file-70')).toHaveTextContent('보고/1분기 · 2.0 KB')
    expect(within(fileRow).getByTestId('drive-starred-space-file-70')).toHaveTextContent('경영지원')
    expect(within(fileRow).getAllByText('11월 13일').length).toBeGreaterThan(0)
    expect(within(fileRow).getByRole('button', { name: '사업계획.txt 별표 빼기' })).toHaveAttribute('aria-pressed', 'true')

    const folderRow = screen.getByTestId('drive-starred-row-folder-12')
    expect(within(folderRow).getByTestId('drive-starred-meta-folder-12')).toHaveTextContent('보고 · 폴더 2개 · 파일 5개')
  })

  test('비었으면 「별표한 항목 없음」', async () => {
    const { handlers } = starredServer([])
    renderScreen(<DriveStarredView />, { path: '/drive/starred', handlers })
    const empty = await screen.findByTestId('drive-starred-empty')
    expect(within(empty).getByText('별표한 항목 없음')).toBeInTheDocument()
  })

  test('불러오지 못하면 오류 안내', async () => {
    renderScreen(<DriveStarredView />, {
      path: '/drive/starred',
      handlers: [http.get(`${API}/starred`, () => new HttpResponse(null, { status: 500 }))],
    })
    expect(await screen.findByTestId('drive-starred-error')).toHaveTextContent('별표한 항목을 불러오지 못했습니다')
  })

  test('다음 커서가 있으면 그 커서로 이어 받아 아래에 붙인다', async () => {
    // 센티널이 늘 보이는 것으로 가장한 IntersectionObserver — 목록 끝에 닿으면 다음 쪽을 받는다.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        cb: (entries: { isIntersecting: boolean }[]) => void
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
          this.cb = cb
        }
        observe() {
          this.cb([{ isIntersecting: true }])
        }
        disconnect() {}
        unobserve() {}
      },
    )
    try {
      const { handlers, state } = starredServer([fileItem, otherFile, folderItem], { pageSize: 2 })
      renderScreen(<DriveStarredView />, { path: '/drive/starred', handlers })
      expect(await screen.findByTestId('drive-starred-row-folder-12')).toBeInTheDocument()
      expect(screen.getByTestId('drive-starred-row-file-70')).toBeInTheDocument()
      expect(screen.getByTestId('drive-starred-row-file-71')).toBeInTheDocument()
      expect(state.cursors).toEqual([null, '2'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('별표 단추로 빼면 DELETE 하고 행이 빠지며, 「되돌리기」는 그 항목을 다시 넣는다', async () => {
    const { handlers, state } = starredServer([fileItem, folderItem])
    const { user } = renderScreen(<DriveStarredView />, { path: '/drive/starred', handlers })

    await user.click(await screen.findByRole('button', { name: '사업계획.txt 별표 빼기' }))
    await waitFor(() => expect(screen.queryByTestId('drive-starred-row-file-70')).not.toBeInTheDocument())
    expect(state.deletes).toEqual([{ kind: 'FILE', id: 70 }])
    expect(await screen.findByText('별표 뺌')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '되돌리기' }))
    expect(await screen.findByTestId('drive-starred-row-file-70')).toBeInTheDocument()
    expect(state.puts).toEqual([{ kind: 'FILE', id: 70 }])
  })

  test('되돌리기 전에 다른 행을 빼도 각 토스트의 되돌리기는 자기 항목을 되살린다', async () => {
    const { handlers, state } = starredServer([fileItem, folderItem])
    const { user } = renderScreen(<DriveStarredView />, { path: '/drive/starred', handlers })

    await user.click(await screen.findByRole('button', { name: '사업계획.txt 별표 빼기' }))
    await screen.findByText('별표 뺌')
    await user.click(screen.getByRole('button', { name: '1분기 별표 빼기' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: '되돌리기' })).toHaveLength(2))
    expect(state.deletes).toEqual([
      { kind: 'FILE', id: 70 },
      { kind: 'FOLDER', id: 12 },
    ])

    // 먼저 뺀 파일의 토스트(위쪽이 아닐 수 있어 순서에 기대지 않고 둘 다 눌러 본다) — 누른 대로 그 항목이 돌아온다.
    const undos = screen.getAllByRole('button', { name: '되돌리기' })
    await user.click(undos[0])
    await waitFor(() => expect(state.puts).toHaveLength(1))
    await user.click(screen.getAllByRole('button', { name: '되돌리기' }).at(-1)!)
    await waitFor(() => expect(state.puts).toHaveLength(2))
    expect(state.puts).toEqual(expect.arrayContaining([{ kind: 'FILE', id: 70 }, { kind: 'FOLDER', id: 12 }]))
    expect(await screen.findByTestId('drive-starred-row-file-70')).toBeInTheDocument()
    expect(await screen.findByTestId('drive-starred-row-folder-12')).toBeInTheDocument()
  })

  test('빼기에 실패하면 행이 돌아오고 오류를 알린다', async () => {
    const { handlers } = starredServer([fileItem])
    const { user } = renderScreen(<DriveStarredView />, {
      path: '/drive/starred',
      handlers: [http.delete(`${API}/stars`, () => new HttpResponse(null, { status: 500 })), ...handlers],
    })
    await user.click(await screen.findByRole('button', { name: '사업계획.txt 별표 빼기' }))
    expect(await screen.findByText('별표를 빼지 못했습니다. 잠시 후 다시 시도하세요.')).toBeInTheDocument()
    expect(await screen.findByTestId('drive-starred-row-file-70')).toBeInTheDocument()
  })

  test('연달아 뺀 두 행이 동시에 도는 동안 앞 행이 실패하면 앞 행의 오류와 뒤 행의 「별표 뺌」을 둘 다 알린다', async () => {
    // mutate 의 호출별 콜백은 마지막 호출에만 불려, 앞 행의 오류 토스트가 빠지던 문제(호출마다 mutateAsync 로 기다린다).
    const { handlers, state } = starredServer([fileItem, folderItem])
    const { user } = renderScreen(<DriveStarredView />, {
      path: '/drive/starred',
      handlers: [
        http.delete(`${API}/stars`, async ({ request }) => {
          const body = (await request.clone().json()) as DriveStarTarget
          if (body.kind !== 'FILE') return undefined
          // 앞 행(파일)은 뒤 행이 끝난 뒤에 실패한다 — 두 바꾸기가 겹친다.
          await delay(300)
          return new HttpResponse(null, { status: 500 })
        }),
        ...handlers,
      ],
    })
    await user.click(await screen.findByRole('button', { name: '사업계획.txt 별표 빼기' }))
    await user.click(screen.getByRole('button', { name: '1분기 별표 빼기' }))

    expect(await screen.findByText('별표 뺌')).toBeInTheDocument()
    expect(await screen.findByText('별표를 빼지 못했습니다. 잠시 후 다시 시도하세요.')).toBeInTheDocument()
    // 실패한 파일 행은 돌아오고, 뺀 폴더 행은 빠진 채
    expect(await screen.findByTestId('drive-starred-row-file-70')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('drive-starred-row-folder-12')).not.toBeInTheDocument())
    expect(state.deletes).toEqual([{ kind: 'FOLDER', id: 12 }])
  })

  test('원본 유실 파일은 「원본 유실」 배지, 누르면 열지 않고 안내하며 ⋯ 의 다운로드를 막는다', async () => {
    const { handlers } = starredServer([{ ...fileItem, available: false }])
    const { user, location } = renderScreen(<DriveStarredView />, { path: '/drive/starred', handlers })

    expect(await screen.findByTestId('drive-starred-missing-file-70')).toHaveTextContent('원본 유실')
    await user.click(screen.getByRole('button', { name: '사업계획.txt' }))
    expect(await screen.findByText('이 파일의 원본이 유실되어 열거나 내려받을 수 없습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(location()).toBe('/drive/starred')

    await user.click(screen.getByTestId('drive-starred-menu-file-70'))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: '다운로드' })).toHaveAttribute('aria-disabled', 'true')
  })

  test('원본이 있는 파일은 배지 없고 다운로드가 열려 있다', async () => {
    const { handlers } = starredServer([fileItem])
    const { user } = renderScreen(<DriveStarredView />, { path: '/drive/starred', handlers })
    await user.click(await screen.findByTestId('drive-starred-menu-file-70'))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: '다운로드' })).not.toHaveAttribute('aria-disabled')
    expect(screen.queryByTestId('drive-starred-missing-file-70')).not.toBeInTheDocument()
  })

  test('폴더를 누르면 그 공간의 그 폴더로 간다', async () => {
    const { handlers } = starredServer([folderItem])
    const { user, location } = renderScreen(<DriveStarredView />, { path: '/drive/starred', handlers })
    await user.click(await screen.findByRole('button', { name: '1분기' }))
    await waitFor(() => expect(location()).toBe('/drive/spaces/3?folderId=12'))
  })

  test('파일을 누르면 이 자리에서 보기 창이 열리고, 보기 창 별표 단추로 빼고 다시 넣는다', async () => {
    const { handlers, state } = starredServer([fileItem])
    const { user, location } = renderScreen(<DriveStarredView />, {
      path: '/drive/starred',
      handlers: [
        ...handlers,
        http.get(`${API}/files/70/content`, () => new HttpResponse('본문', { headers: { 'Content-Type': 'text/plain' } })),
        ...fileSideHandlers(70),
      ],
    })
    await user.click(await screen.findByRole('button', { name: '사업계획.txt' }))
    const dialog = await screen.findByRole('dialog')
    expect(location()).toBe('/drive/starred?preview=70')

    const star = within(dialog).getByTestId('viewer-star')
    expect(star).toHaveAttribute('aria-pressed', 'true')
    await user.click(star)
    await waitFor(() => expect(within(dialog).getByTestId('viewer-star')).toHaveAttribute('aria-pressed', 'false'))
    expect(state.deletes).toEqual([{ kind: 'FILE', id: 70 }])
    // 목록에서 빠져도 보기 창은 그대로 — 다시 누르면 넣는다
    await user.click(within(dialog).getByTestId('viewer-star'))
    await waitFor(() => expect(within(dialog).getByTestId('viewer-star')).toHaveAttribute('aria-pressed', 'true'))
    expect(state.puts).toEqual([{ kind: 'FILE', id: 70 }])
  })

  test('행 ⋯ — 파일은 위치 열기·다운로드·링크 작업(공간 화면과 같은 링크 복사·채팅·이슈로 보내기)·별표 빼기, 폴더는 다운로드 없음, 위치 열기는 그 폴더의 보기 창 주소', async () => {
    const { handlers } = starredServer([fileItem, folderItem])
    const { user, location } = renderScreen(<DriveStarredView />, {
      path: '/drive/starred',
      handlers: [
        ...handlers,
        // 라우트 없이 이 화면만 띄워 위치를 옮겨도 화면이 남아 ?preview 를 읽는다 — 그때 받는 조회를 받아 준다.
        http.get(`${API}/files/70/content`, () => new HttpResponse('본문', { headers: { 'Content-Type': 'text/plain' } })),
        ...fileSideHandlers(70),
      ],
    })

    await user.click(await screen.findByTestId('drive-starred-menu-folder-12'))
    let menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['파일 위치 열기', '링크 복사', '채팅·이슈로 보내기', '별표 빼기'])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    await user.click(screen.getByTestId('drive-starred-menu-file-70'))
    menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['파일 위치 열기', '다운로드', '링크 복사', '채팅·이슈로 보내기', '별표 빼기'])
    await user.click(within(menu).getByRole('menuitem', { name: '파일 위치 열기' }))
    await waitFor(() => expect(location()).toBe('/drive/spaces/3?folderId=12&preview=70'))
  })
})

describe('드라이브 사이드바 「별표」 입구', () => {
  test('「공유받은 항목」 위에 있고 누르면 /drive/starred 로 간다', async () => {
    const { user, location } = renderScreen(<DriveSidebar />, {
      path: '/drive/spaces/1',
      handlers: driveBaseHandlers({ spaces: [] }),
    })
    const starred = await screen.findByTestId('drive-nav-starred')
    expect(starred).toHaveTextContent('별표')
    const shared = screen.getByTestId('drive-nav-shared')
    expect(starred.compareDocumentPosition(shared) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(starred)
    await waitFor(() => expect(location()).toBe('/drive/starred'))
  })
})

describe('공간 화면 별표', () => {
  const SPACE_ID = 1

  /** 공간 화면 — 목록은 상태를 따라 starred 를 싣고, PUT·DELETE 는 본문을 모은다. */
  function openSpace(folders: DriveFolder[], files: DriveFile[], extra: RequestHandler[] = []) {
    const starredKeys = new Set([...folders.filter((f) => f.starred).map((f) => `FOLDER:${f.id}`), ...files.filter((f) => f.starred).map((f) => `FILE:${f.id}`)])
    const calls = { puts: [] as DriveStarTarget[], deletes: [] as DriveStarTarget[] }
    const items = () => ({
      folders: folders.map((f) => ({ ...f, starred: starredKeys.has(`FOLDER:${f.id}`) })),
      files: files.map((f) => ({ ...f, starred: starredKeys.has(`FILE:${f.id}`) })),
    })
    const view = renderDrivePage(SPACE_ID, {
      handlers: [
        ...extra,
        http.put(`${API}/stars`, async ({ request }) => {
          const body = (await request.json()) as DriveStarTarget
          calls.puts.push(body)
          starredKeys.add(`${body.kind}:${body.id}`)
          return new HttpResponse(null, { status: 204 })
        }),
        http.delete(`${API}/stars`, async ({ request }) => {
          const body = (await request.json()) as DriveStarTarget
          calls.deletes.push(body)
          starredKeys.delete(`${body.kind}:${body.id}`)
          return new HttpResponse(null, { status: 204 })
        }),
        ...driveBaseHandlers({ items }),
      ],
    })
    return { ...view, calls }
  }

  async function openRowMenu(user: ReturnType<typeof renderDrivePage>['user'], name: string) {
    const row = (await screen.findByText(name, {}, { timeout: PAGE_LOAD_TIMEOUT })).closest('li') as HTMLElement
    await user.click(within(row).getByRole('button', { name: `${name} 더보기` }))
    return screen.findByRole('menu')
  }

  test('행 메뉴 「별표」는 PUT 을 보내고 이름 옆에 별이 생기며 메뉴는 「별표 빼기」로 바뀐다', async () => {
    const { user, calls } = openSpace([createFolder({ id: 10, name: '문서' })], [createFile({ id: 20, name: 'memo.txt' })])

    let menu = await openRowMenu(user, 'memo.txt')
    await user.click(within(menu).getByRole('menuitem', { name: '별표' }))
    await waitFor(() => expect(calls.puts).toEqual([{ kind: 'FILE', id: 20 }]))
    expect(await screen.findByTestId('drive-row-starred-file-20')).toHaveAccessibleName('별표함')

    menu = await openRowMenu(user, 'memo.txt')
    expect(within(menu).getByRole('menuitem', { name: '별표 빼기' })).toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: '별표 빼기' }))
    await waitFor(() => expect(calls.deletes).toEqual([{ kind: 'FILE', id: 20 }]))
    await waitFor(() => expect(screen.queryByTestId('drive-row-starred-file-20')).not.toBeInTheDocument())

    // 폴더도 같은 규칙
    menu = await openRowMenu(user, '문서')
    await user.click(within(menu).getByRole('menuitem', { name: '별표' }))
    await waitFor(() => expect(calls.puts).toContainEqual({ kind: 'FOLDER', id: 10 }))
    expect(await screen.findByTestId('drive-row-starred-folder-10')).toBeInTheDocument()
  })

  test('보기 창 별표 단추는 행의 별표 상태를 aria-pressed 로 보이고 눌러 바꾼다', async () => {
    const file = createFile({ id: 30, fileId: 1030, name: 'note.txt', mimeType: 'text/plain', category: 'TEXT', starred: true })
    const { user, calls } = openSpace([], [file], [
      http.get(`${API}/files/30/content`, () => new HttpResponse('본문', { headers: { 'Content-Type': 'text/plain' } })),
      ...fileSideHandlers(30),
    ])
    expect(await screen.findByTestId('drive-row-starred-file-30', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'note.txt' }))
    const dialog = await screen.findByRole('dialog')
    const star = within(dialog).getByTestId('viewer-star')
    expect(star).toHaveAttribute('aria-pressed', 'true')
    await user.click(star)
    await waitFor(() => expect(calls.deletes).toEqual([{ kind: 'FILE', id: 30 }]))
    await waitFor(() => expect(within(dialog).getByTestId('viewer-star')).toHaveAttribute('aria-pressed', 'false'))
  })

  test('보기 창 파일이 목록에서 빠져 스냅숏으로 보일 때도 별표 단추가 바꾼 상태를 따른다', async () => {
    const file = createFile({ id: 30, fileId: 1030, name: 'note.txt', mimeType: 'text/plain', category: 'TEXT', starred: true })
    // 별표를 뺀 뒤 다시 받은 목록에는 이 파일이 없다(다른 곳에서 옮겨진 경우) — 보기 창은 마지막 스냅숏으로 남는다.
    let gone = false
    const { user, calls } = openSpace([], [file], [
      http.get(`${API}/spaces/${SPACE_ID}/items`, () => (gone ? HttpResponse.json({ folders: [], files: [] }) : undefined)),
      http.delete(`${API}/stars`, () => {
        gone = true
        return undefined
      }),
      http.get(`${API}/files/30/content`, () => new HttpResponse('본문', { headers: { 'Content-Type': 'text/plain' } })),
      ...fileSideHandlers(30),
    ])
    await user.click(await screen.findByRole('button', { name: 'note.txt' }, { timeout: PAGE_LOAD_TIMEOUT }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByTestId('viewer-star'))
    await waitFor(() => expect(calls.deletes).toEqual([{ kind: 'FILE', id: 30 }]))
    // 목록에서 빠질 때까지 — 이제 보기 창은 스냅숏
    await waitFor(() => expect(screen.queryByTestId('drive-row-starred-file-30')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'note.txt' })).not.toBeInTheDocument())
    expect(within(dialog).getByTestId('viewer-star')).toHaveAttribute('aria-pressed', 'false')

    await user.click(within(dialog).getByTestId('viewer-star'))
    await waitFor(() => expect(calls.puts).toEqual([{ kind: 'FILE', id: 30 }]))
    await waitFor(() => expect(within(dialog).getByTestId('viewer-star')).toHaveAttribute('aria-pressed', 'true'))
  })
})

// WP-1788: 실패 뒤 다시 시도하면 TanStack Query 가 status 를 pending 으로 되돌린다 — 그 동안에도 오류 안내·초점이 남아야 한다.
describe('별표 화면 — 실패 뒤 다시 시도하는 동안 안내와 초점이 남는다(WP-1788)', () => {
  test('WP-1788 다시 시도 성공 — 응답 전에도 안내·초점 유지, 응답 뒤 목록', async () => {
    let calls = 0
    const { promise, release } = gate()
    const { user } = renderScreen(<DriveStarredView />, {
      path: '/drive/starred',
      handlers: [
        http.get(`${API}/starred`, async () => {
          calls += 1
          if (calls === 1) return HttpResponse.json({ message: 'x' }, { status: 500 })
          await promise
          return HttpResponse.json({ items: [fileItem], nextCursor: null })
        }),
      ],
    })
    await clickRetryAndExpectErrorKept(user, 'drive-starred-error', () => calls)
    await act(async () => { release() })
    expect(await screen.findByTestId('drive-starred-row-file-70')).toBeInTheDocument()
    expect(screen.queryByTestId('drive-starred-error')).toBeNull()
  })

  test('WP-1788 첫 진입 로딩 — 실패 전 첫 조회 중에는 「불러오는 중…」', async () => {
    const { promise, release } = gate()
    renderScreen(<DriveStarredView />, {
      path: '/drive/starred',
      handlers: [http.get(`${API}/starred`, async () => { await promise; return HttpResponse.json({ items: [], nextCursor: null }) })],
    })
    expect(await screen.findByText('불러오는 중…')).toBeInTheDocument()
    await act(async () => { release() })
    expect(await screen.findByTestId('drive-starred-empty')).toBeInTheDocument()
  })
})
