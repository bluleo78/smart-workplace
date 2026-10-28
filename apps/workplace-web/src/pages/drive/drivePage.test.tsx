// 드라이브 공간 화면(DrivePage) — 화면 컴포넌트 테스트(WP-971, WP-984).
// 목록 열·폴더 만들기/이름 변경·업로드(여러 개·실패 사유·취소·사용량 갱신)·휴지통·검색(파일명·내용·AI Overview 시작/취소)·헤더 경로·
// 찾을 수 없는 공간·폴더 이동 창·썸네일 404 캐시·전환 중 목록 유지는 브라우저 없이 판정되므로
// e2e/pages/drive/drive.spec.ts·drive-list-columns.spec.ts·drive-upload-failure-reason.spec.ts·drive-content-search.spec.ts·
// drive-overview.spec.ts·drive-realtime.spec.ts 에서 옮겼다.
// 화면 배선(라우트 → 페이지 → API)·호버/포커스 노출·토스트 겹침 같은 기하는 drive.spec.ts 의 E2E 가 지킨다.
// DrivePage 만 renderScreen 으로 띄운다(testkit-b6 renderDrivePage — 풀페이지 라우트) — 사용량 갱신처럼 사이드바가 필요한 판정만 DriveSidebar 를 함께 띄운다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { DriveSidebar } from '@/components/drive/DriveSidebar'
import { API, driveBaseHandlers, fileSideHandlers, renderDrivePage } from '@/test/kits/drive/testkit-b6'
import { PAGE_LOAD_TIMEOUT } from '@/test/renderPage'
import type { renderScreen } from '@/test/renderScreen'
import type { DriveFile, DriveFolder } from '@/types/drive'

import { createFile, createFolder, createSpace, makeTrashList } from '../../../e2e/factories/drive.factory'

const SPACE_ID = 1

type Items = { folders: DriveFolder[]; files: DriveFile[] }

/** 공간 화면을 띄우고 첫 목록(또는 빈 폴더 안내)이 그려질 때까지 기다린다. */
async function openDrive(items: Items | ((url: URL) => Items), extra: Parameters<typeof renderDrivePage>[1] = {}) {
  const view = renderDrivePage(SPACE_ID, { ...extra, handlers: [...(extra.handlers ?? []), ...driveBaseHandlers({ items })] })
  await screen.findByTestId('drive-page', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return view
}

/** 숨은 파일 입력에 파일을 넣는다(업로드 버튼이 여는 input[multiple]). */
function chooseFiles(files: File[]) {
  fireEvent.change(screen.getByTestId('file-input'), { target: { files } })
}

/** 파일 한 개를 목록 영역에 놓는다 — readDroppedTree 가 읽는 webkitGetAsEntry 엔트리만 흉내 낸다. */
function dropFile() {
  fireEvent.drop(screen.getByTestId('drive-dropzone'), {
    dataTransfer: {
      items: [{ webkitGetAsEntry: () => ({ isFile: true, isDirectory: false, name: 'a.txt', file: (cb: (f: File) => void) => cb(new File(['x'], 'a.txt')) }) }],
    },
  })
}

/** 행(listitem)을 이름으로 찾는다. */
async function rowOf(name: string) {
  return (await screen.findByText(name)).closest('li') as HTMLElement
}

/** 행 ⋯ 더보기를 열고 항목을 고른다 — ⋯ 는 hover 때만 보이지만(E2E @input) DOM 에는 있어 바로 누른다. */
async function pickRowMenu(user: ReturnType<typeof renderScreen>['user'], name: string, item: string) {
  const row = await rowOf(name)
  await user.click(within(row).getByRole('button', { name: /더보기/ }))
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

describe('목록 열', () => {
  // #799: 이름/크기/수정일 3열 헤더는 정렬 없는 레이블(버튼 아님), 폴더 크기는 「—」, 파일은 formatFileSize·formatDateOnly.
  test('공간 목록 — 3열 헤더와 폴더·파일 행의 크기/수정일 값', async () => {
    const folder = createFolder({ id: 10, name: '문서함', updatedAt: '2026-03-05T00:00:00Z' })
    const file = createFile({ id: 20, name: '2026년_3분기_실적보고서.pdf', sizeBytes: 15_728_640, mimeType: 'application/pdf', category: 'PDF', updatedAt: '2026-08-21T03:15:00Z' })
    await openDrive({ folders: [folder], files: [file] })
    const header = screen.getByTestId('drive-column-header')
    for (const label of ['이름', '크기', '수정일']) expect(within(header).getByText(label)).toBeInTheDocument()
    expect(within(header).queryAllByRole('button')).toHaveLength(0)
    const folderRow = await rowOf('문서함')
    expect(within(folderRow).getByText('—')).toBeInTheDocument()
    expect(within(folderRow).getByText('2026-03-05')).toBeInTheDocument()
    const fileRow = await rowOf('2026년_3분기_실적보고서.pdf')
    expect(within(fileRow).getByText('15.0 MB')).toBeInTheDocument()
    expect(within(fileRow).getByText('2026-08-21')).toBeInTheDocument()
  })
})

describe('검색', () => {
  const searchHit = {
    folders: [{ id: 50, parentId: 9, name: 'report-archive', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-10T00:00:00Z', folderPath: '프로젝트' }],
    files: [{ id: 60, folderId: 9, fileId: 100, name: 'report-final.txt', mimeType: 'text/plain', sizeBytes: 2048, category: 'TEXT', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-04-15T00:00:00Z', folderPath: '프로젝트/문서' }],
  }

  // 검색어 → q 파라미터, 결과(경로 포함)·3열 값, 폴더 결과를 누르면 그 폴더(folderId)로 간다.
  test('검색어 입력 시 q 로 조회해 경로·크기·수정일과 함께 보이고, 폴더 결과를 누르면 그 폴더로 간다', async () => {
    const qs: string[] = []
    const { user, location } = await openDrive({ folders: [], files: [] }, {
      handlers: [
        http.get(`${API}/spaces/${SPACE_ID}/search`, ({ request }) => {
          qs.push(new URL(request.url).searchParams.get('q') ?? '')
          return HttpResponse.json(searchHit)
        }),
        http.get(`${API}/search`, () => HttpResponse.json({ hits: [], semantic: false })),
        http.get(`${API}/folders/50/path`, () => HttpResponse.json([{ id: 50, name: 'report-archive' }])),
      ],
    })
    await user.click(screen.getByLabelText('파일명 및 콘텐츠 검색'))
    await user.paste('report')
    const results = await screen.findByTestId('search-results')
    await waitFor(() => expect(qs.at(-1)).toBe('report'))
    expect(await within(results).findByText('report-final.txt')).toBeInTheDocument()
    expect(within(results).getByText('프로젝트/문서')).toBeInTheDocument()
    expect(within(screen.getByTestId('drive-column-header')).queryAllByRole('button')).toHaveLength(0)
    const folderRow = await rowOf('report-archive')
    expect(within(folderRow).getByText('—')).toBeInTheDocument()
    expect(within(folderRow).getByText('2026-02-10')).toBeInTheDocument()
    const fileRow = await rowOf('report-final.txt')
    expect(within(fileRow).getByText('2.0 KB')).toBeInTheDocument()
    expect(within(fileRow).getByText('2026-04-15')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /report-archive/ }))
    await waitFor(() => expect(location()).toMatch(/folderId=50/))
  })
})

describe('통합 검색(파일명 + 내용)', () => {
  const contentHit = {
    hits: [{ driveFileId: 1, fileId: 10, spaceId: SPACE_ID, spaceName: '내 드라이브', name: '예산안', mimeType: 'application/pdf', snippet: '내년도 <b>예산</b> 편성', score: 0.5 }],
    semantic: true,
  }

  /** 검색 입력에 값을 넣는다 — 디바운스 뒤 파일명·내용 검색이 함께 나간다. */
  async function search(user: ReturnType<typeof renderScreen>['user'], q: string) {
    await user.click(screen.getByLabelText('파일명 및 콘텐츠 검색'))
    await user.paste(q)
  }

  // 내용 일치 그룹에 스니펫(b 태그 제거)·공간 배지, 내용 검색은 현재 공간(spaceId)으로, 풀페이지라 AI Overview 버튼이 있다.
  test('내용 일치 결과에 스니펫·공간 배지와 AI Overview 버튼을 보이고 spaceId 로 조회한다', async () => {
    const contentUrls: URL[] = []
    const { user } = await openDrive({ folders: [], files: [] }, {
      handlers: [
        http.get(`${API}/spaces/${SPACE_ID}/search`, () => HttpResponse.json({ folders: [], files: [] })),
        http.get(`${API}/search`, ({ request }) => {
          contentUrls.push(new URL(request.url))
          return HttpResponse.json(contentHit)
        }),
      ],
    })
    await search(user, '예산')
    const results = await screen.findByTestId('drive-content-results')
    expect(within(results).getByText('예산안')).toBeInTheDocument()
    expect(within(results).getByText('내년도 예산 편성')).toBeInTheDocument()
    expect(within(screen.getByTestId('drive-content-hit')).getByText('내 드라이브', { exact: true })).toBeInTheDocument()
    expect(contentUrls.at(-1)?.searchParams.get('spaceId')).toBe(String(SPACE_ID))
    expect(screen.getByTestId('drive-overview-btn')).toBeInTheDocument()
  })

  // 2자 미만은 검색하지 않는다(디바운스가 지나도 요청·결과 화면 없음).
  test('검색어 2자 미만은 검색을 실행하지 않는다', async () => {
    let calls = 0
    const { user } = await openDrive({ folders: [], files: [] }, {
      handlers: [
        http.get(`${API}/search`, () => {
          calls++
          return HttpResponse.json({ hits: [], semantic: false })
        }),
      ],
    })
    await search(user, 'a')
    // 디바운스(300ms)를 실제로 흘려보내야 「요청 없음」을 볼 수 있다.
    await act(() => new Promise((r) => setTimeout(r, 450)))
    expect(calls).toBe(0)
    expect(screen.queryByTestId('search-results')).not.toBeInTheDocument()
  })

  // 내용 검색이 500 이어도 로딩이 풀려 「결과 없음」 안내가 보인다(영구 숨김 방지). #789: 빈 상태 4요소 + 검색 초기화로 기본 목록 복귀.
  test('내용 검색 실패에도 결과 없음 안내가 보이고, 검색 초기화로 기본 목록으로 돌아온다', async () => {
    const { user } = await openDrive({ folders: [], files: [createFile({ id: 1, name: '기본목록.txt' })] }, {
      handlers: [
        http.get(`${API}/spaces/${SPACE_ID}/search`, () => HttpResponse.json({ folders: [], files: [] })),
        http.get(`${API}/search`, () => HttpResponse.json({ status: 500, error: 'Internal Server Error', message: '검색 실패' }, { status: 500 })),
      ],
    })
    await screen.findByText('기본목록.txt')
    await search(user, '존재하지않는검색어')
    const empty = await screen.findByTestId('drive-search-empty')
    await waitFor(() => expect(empty).toHaveTextContent("'존재하지않는검색어'에 대한 결과가 없습니다."))
    expect(empty).toHaveTextContent('다른 키워드로 검색해 보세요.')
    await user.click(within(empty).getByTestId('drive-search-empty-reset'))
    expect(screen.getByLabelText('파일명 및 콘텐츠 검색')).toHaveValue('')
    expect(screen.queryByTestId('drive-search-empty')).not.toBeInTheDocument()
    expect(await screen.findByText('기본목록.txt')).toBeInTheDocument()
  })

  // AI Overview — 버튼을 누르면 q 로 생성을 시작하고(생성 중 스피너), 결과 화면을 벗어나 카드가 사라지면 그 correlationId 를 취소(DELETE)한다.
  // /events 로 델타가 쌓이는 것은 실제 SSE 라 E2E(@platform) 몫.
  test('AI Overview 는 q 로 시작해 생성 중을 보이고, 카드가 사라지면 생성을 취소한다', async () => {
    const starts: URL[] = []
    const cancels: string[] = []
    const { user } = await openDrive({ folders: [], files: [] }, {
      handlers: [
        http.get(`${API}/spaces/${SPACE_ID}/search`, () => HttpResponse.json({ folders: [], files: [] })),
        http.get(`${API}/search`, () => HttpResponse.json(contentHit)),
        http.get(`${API}/search-overview`, ({ request }) => {
          starts.push(new URL(request.url))
          return HttpResponse.json({ correlationId: 'corr-pending' })
        }),
        http.delete(`${API}/search-overview/:id`, ({ params }) => {
          cancels.push(String(params.id))
          return HttpResponse.json({})
        }),
      ],
    })
    await search(user, '기획서')
    await user.click(await screen.findByTestId('drive-overview-btn'))
    const card = await screen.findByTestId('drive-overview-card')
    await waitFor(() => expect(starts.at(-1)?.searchParams.get('q')).toBe('기획서'))
    expect(card).toHaveTextContent('생성 중…')
    expect(card.querySelector('svg.animate-spin')).not.toBeNull()

    await user.clear(screen.getByLabelText('파일명 및 콘텐츠 검색'))
    await waitFor(() => expect(screen.queryByTestId('drive-overview-card')).not.toBeInTheDocument())
    await waitFor(() => expect(cancels.at(-1)).toBe('corr-pending'))
  })
})

describe('AI Overview 시간 초과', () => {
  afterEach(() => vi.useRealTimers())

  // #681: SSE 유실로 done/error 가 오지 않으면 클라이언트 타임아웃(125초) 뒤 카드가 오류 상태로 바뀐다.
  // 125초 경계 자체는 src/api/overviewStream.test.ts 가 보고, 여기선 타임아웃 → 카드 오류 배선만 본다(시계는 가짜로 흘린다).
  test('done/error 가 오지 않으면 시간 초과 오류를 보인다', async () => {
    const cancels: string[] = []
    const { user, unmount } = await openDrive({ folders: [], files: [] }, {
      handlers: [
        http.get(`${API}/spaces/${SPACE_ID}/search`, () => HttpResponse.json({ folders: [], files: [] })),
        http.get(`${API}/search`, () =>
          HttpResponse.json({ hits: [{ driveFileId: 20, fileId: 500, spaceId: SPACE_ID, spaceName: '팀 공간', name: '기획서.txt', mimeType: 'text/plain', snippet: '핵심', score: 1 }], semantic: false }),
        ),
        http.get(`${API}/search-overview`, () => HttpResponse.json({ correlationId: 'corr-lost-sse' })),
        http.delete(`${API}/search-overview/:id`, ({ params }) => {
          cancels.push(String(params.id))
          return HttpResponse.json({})
        }),
      ],
    })
    await user.click(screen.getByLabelText('파일명 및 콘텐츠 검색'))
    await user.paste('기획서')
    const btn = await screen.findByTestId('drive-overview-btn')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await user.click(btn)
    const card = await screen.findByTestId('drive-overview-card')
    await waitFor(() => expect(card).toHaveTextContent('생성 중…'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(130_000)
    })
    await waitFor(() => expect(screen.getByTestId('drive-overview-card')).toHaveTextContent('생성 시간이 초과되었습니다.'))
    // 화면이 내려가며 보내는 생성 취소(DELETE)를 이 테스트 안에서 받아 낸다 — 공통 정리(핸들러 초기화) 뒤에 도착하면
    // 처리되지 않은 요청으로 다음 테스트를 실패시켰다(전체 실행에서만 가끔).
    unmount()
    await waitFor(() => expect(cancels).toContain('corr-lost-sse'))
  })
})

describe('전환 중 목록 유지', () => {
  // WP-63: 같은 공간에서 폴더를 바꾸면 새 목록이 오기 전까지 이전 목록을 유지하고 빈 폴더 문구를 띄우지 않는다.
  test('폴더 전환 중에는 이전 목록을 유지하고 빈 폴더 문구를 숨긴다', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { user } = await openDrive({ folders: [], files: [] }, {
      handlers: [
        http.get(`${API}/spaces/${SPACE_ID}/items`, async ({ request }) => {
          if (new URL(request.url).searchParams.get('parentId') === '10') {
            await gate
            return HttpResponse.json({ folders: [], files: [createFile({ id: 31, name: 'inner.txt', folderId: 10 })] })
          }
          return HttpResponse.json({ folders: [createFolder({ id: 10, name: '문서' })], files: [createFile({ id: 20, name: 'root.txt' })] })
        }),
        http.get(`${API}/folders/10/path`, () => HttpResponse.json([{ id: 10, name: '문서' }])),
      ],
    })
    await screen.findByText('root.txt')
    await user.click(screen.getByRole('button', { name: '문서' }))
    expect(screen.getByText('root.txt')).toBeInTheDocument()
    expect(screen.queryByTestId('drive-empty-folder')).not.toBeInTheDocument()
    release()
    expect(await screen.findByText('inner.txt')).toBeInTheDocument()
    expect(screen.queryByText('root.txt')).not.toBeInTheDocument()
  })

  // WP-63: 다른 공간으로 가면 새 공간 응답 전에도 이전 공간 파일을 보이지 않는다.
  test('공간 전환 중에는 이전 공간 파일이 보이지 않는다', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const spaces = [createSpace({ id: 1 }), createSpace({ id: 2, name: '두번째' })]
    const { user } = renderDrivePage(SPACE_ID, {
      extra: <DriveSidebar />,
      handlers: [
        http.get(`${API}/spaces/2/items`, async () => {
          await gate
          return HttpResponse.json({ folders: [], files: [createFile({ id: 41, name: 'space2.txt' })] })
        }),
        ...driveBaseHandlers({ spaces, items: { folders: [], files: [createFile({ id: 40, name: 'space1.txt' })] } }),
      ],
    })
    expect(await screen.findByText('space1.txt', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    await user.click(within(screen.getByTestId('drive-space-list')).getByText('두번째'))
    await waitFor(() => expect(screen.queryByText('space1.txt')).not.toBeInTheDocument())
    release()
    expect(await screen.findByText('space2.txt')).toBeInTheDocument()
  })
})

describe('폴더 만들기·이름 변경', () => {
  // 새 폴더 대화상자 — 빈 이름은 요청 없이 인라인 오류, 입력하면 오류가 사라지고 「만들기」로 POST(이름 그대로) 뒤 목록에 반영(#360·#635).
  test('새 폴더 — 빈 이름은 인라인 오류·요청 없음, 이름을 넣어 만들면 POST name 이 가고 목록에 보인다', async () => {
    const state: Items = { folders: [], files: [] }
    const posts: unknown[] = []
    const { user } = await openDrive(() => state, {
      handlers: [
        http.post(`${API}/spaces/${SPACE_ID}/folders`, async ({ request }) => {
          posts.push(await request.json())
          const folder = createFolder({ name: '문서' })
          state.folders = [folder]
          return HttpResponse.json(folder, { status: 201 })
        }),
      ],
    })
    await user.click(screen.getByRole('button', { name: '새 폴더' }))
    expect(await screen.findByTestId('folder-name-confirm')).toHaveTextContent('만들기')
    await user.click(screen.getByTestId('folder-name-confirm'))
    expect(await screen.findByTestId('folder-name-error')).toHaveTextContent('폴더 이름을 입력해주세요')
    expect(screen.getByTestId('folder-name-input')).toBeInTheDocument()
    expect(posts).toHaveLength(0)

    await user.click(screen.getByTestId('folder-name-input'))
    await user.paste('문서')
    expect(screen.queryByTestId('folder-name-error')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('folder-name-confirm'))
    expect(await screen.findByRole('button', { name: '문서' })).toBeInTheDocument()
    expect(posts).toEqual([{ parentId: null, name: '문서' }])
  })

  // #116: 서버 400(공백 이름 @NotBlank) 사유를 토스트로 알린다 — 공백만 있어도 클라이언트는 그대로 보낸다.
  test('폴더 생성 400 — 서버 사유를 토스트로 보인다', async () => {
    let posts = 0
    const { user } = await openDrive({ folders: [], files: [] }, {
      handlers: [
        http.post(`${API}/spaces/${SPACE_ID}/folders`, () => {
          posts++
          return HttpResponse.json({ status: 400, error: 'Bad Request', message: '폴더 이름은 비어 있을 수 없습니다' }, { status: 400 })
        }),
      ],
    })
    await user.click(screen.getByRole('button', { name: '새 폴더' }))
    await user.click(await screen.findByTestId('folder-name-input'))
    await user.paste('   ')
    await user.click(screen.getByTestId('folder-name-confirm'))
    expect(await screen.findByText('폴더 이름은 비어 있을 수 없습니다')).toBeInTheDocument()
    expect(posts).toBeGreaterThan(0)
  })

  // #135·#360·#635: ⋯ → 이름 변경 — 현재 이름이 미리 채워지고, 지우면 인라인 오류(요청 없음), 바꾸면 「이름 변경」으로 PATCH 뒤 목록 반영.
  test('폴더 이름 변경 — 현재 이름 사전 입력, 빈 이름 인라인 오류, 바꾸면 PATCH name 뒤 목록 반영', async () => {
    const folder = createFolder({ id: 10, name: '문서' })
    const state: Items = { folders: [folder], files: [] }
    const patches: unknown[] = []
    const { user } = await openDrive(() => state, {
      handlers: [
        http.patch(`${API}/folders/10`, async ({ request }) => {
          const body = (await request.json()) as { name: string }
          patches.push(body)
          state.folders = [{ ...folder, name: body.name }]
          return HttpResponse.json(state.folders[0])
        }),
      ],
    })
    await pickRowMenu(user, '문서', '이름 변경')
    const input = await screen.findByTestId('folder-name-input')
    expect(input).toHaveValue('문서')
    await user.clear(input)
    await user.click(screen.getByTestId('folder-name-confirm'))
    expect(await screen.findByTestId('folder-name-error')).toBeInTheDocument()
    expect(patches).toHaveLength(0)

    await user.click(input)
    await user.paste('보관함')
    expect(screen.getByTestId('folder-name-confirm')).toHaveTextContent('이름 변경')
    await user.click(screen.getByTestId('folder-name-confirm'))
    expect(await screen.findByRole('button', { name: '보관함' })).toBeInTheDocument()
    expect(patches).toEqual([{ name: '보관함' }])
  })
})

describe('업로드', () => {
  // #260·#589: 빈 폴더 안내(제목·설명) → 파일 여러 개를 고르면 파일마다 POST 1건씩(각 1개 파일), 완료 토스트·목록 반영.
  test('빈 폴더 안내가 보이고, 파일 여러 개를 고르면 하나씩 업로드해 완료 토스트와 목록에 보인다', async () => {
    const state: Items = { folders: [], files: [] }
    // 요청마다 실린 파일 파트 수 — jsdom File 은 MSW(undici)로 넘어가며 파일명이 「blob」으로 바뀌어, 이름은 요청 순서로 돌려준다.
    const partsPerRequest: number[] = []
    const names = ['one.txt', 'two.txt']
    await openDrive(() => state, {
      handlers: [
        http.post(`${API}/spaces/${SPACE_ID}/files`, async ({ request }) => {
          partsPerRequest.push([...(await request.text()).matchAll(/name="file"/g)].length)
          const file = createFile({ id: 20 + state.files.length, name: names[state.files.length] })
          state.files = [...state.files, file]
          return HttpResponse.json(file, { status: 201 })
        }),
      ],
    })
    const empty = await screen.findByTestId('drive-empty-folder')
    expect(within(empty).getByText('이 폴더는 비어 있어요')).toBeInTheDocument()
    expect(within(empty).getByText('파일을 업로드하거나 새 폴더를 만들어보세요')).toBeInTheDocument()
    expect(screen.getByTestId('file-input')).toHaveAttribute('multiple')

    chooseFiles([new File(['one'], 'one.txt', { type: 'text/plain' }), new File(['two'], 'two.txt', { type: 'text/plain' })])
    expect(await screen.findByText('2개 파일 업로드 완료')).toBeInTheDocument()
    expect(await screen.findByText('one.txt')).toBeInTheDocument()
    expect(screen.getByText('two.txt')).toBeInTheDocument()
    expect(partsPerRequest).toEqual([1, 1])
  })

  // 단건 400 은 서버 사유를, 다중 업로드 400 은 요약 토스트에 백엔드 사유(파일명만이 아님)를 보인다.
  test('업로드 400 — 단건·다중 모두 서버 사유를 토스트로 보인다', async () => {
    let reply = '파일을 업로드할 수 없습니다'
    await openDrive({ folders: [], files: [] }, {
      handlers: [http.post(`${API}/spaces/${SPACE_ID}/files`, () => HttpResponse.json({ status: 400, message: reply }, { status: 400 }))],
    })
    chooseFiles([new File(['hello'], 'memo.txt', { type: 'text/plain' })])
    expect(await screen.findByText('파일을 업로드할 수 없습니다')).toBeInTheDocument()

    reply = '이미지 파일은 최대 10MB까지 업로드할 수 있습니다: big.png'
    chooseFiles([new File(['x'], 'a.png', { type: 'image/png' }), new File(['y'], 'b.png', { type: 'image/png' })])
    expect(await screen.findByText(/이미지 파일은 최대 10MB/)).toBeInTheDocument()
  })

  // #170: 업로드 중 버튼은 비활성 + 「업로드 중…」, 끝나면 「업로드」로 돌아온다. 진행률(%) 표시는 실제 XHR 업로드 진행 이벤트라 E2E(@platform) 몫.
  test('업로드 중 버튼이 비활성·「업로드 중…」이고, 끝나면 다시 「업로드」', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    await openDrive({ folders: [], files: [] }, {
      handlers: [
        http.post(`${API}/spaces/${SPACE_ID}/files`, async () => {
          await held
          return HttpResponse.json(createFile(), { status: 201 })
        }),
      ],
    })
    chooseFiles([new File(['hello'], 'memo.txt', { type: 'text/plain' })])
    const btn = screen.getByTestId('drive-upload')
    await waitFor(() => expect(btn).toBeDisabled())
    expect(btn).toHaveTextContent('업로드 중…')
    release()
    await waitFor(() => expect(btn).toHaveTextContent(/^업로드$/))
    expect(btn).toBeEnabled()
  })

  // #658: 업로드 중 취소 — 요청을 끊고 취소 토스트, 버튼 복원, 목록에 파일이 생기지 않는다.
  test('업로드 중 취소 버튼을 누르면 요청이 중단되고 목록에 추가되지 않는다', async () => {
    const { user } = await openDrive({ folders: [], files: [] }, {
      handlers: [
        // 응답을 보내지 않는다 — 업로드는 취소(AbortController)로만 끝난다.
        http.post(`${API}/spaces/${SPACE_ID}/files`, () => new Promise<Response>(() => {})),
      ],
    })
    chooseFiles([new File(['hello'], 'memo.txt', { type: 'text/plain' })])
    const btn = screen.getByTestId('drive-upload')
    await waitFor(() => expect(btn).toHaveTextContent('업로드 중…'))
    await user.click(screen.getByTestId('drive-upload-cancel'))
    expect(await screen.findByText('업로드를 취소했습니다.')).toBeInTheDocument()
    await waitFor(() => expect(btn).toHaveTextContent(/^업로드$/))
    expect(btn).toBeEnabled()
    expect(screen.queryByTestId('drive-upload-cancel')).not.toBeInTheDocument()
    expect(screen.queryByText('memo.txt')).not.toBeInTheDocument()
  })

  // #820: 업로드가 끝나면 새로고침 없이 사이드바 사용량을 다시 불러와 갱신한다(쿼터 쿼리 무효화).
  test('업로드 뒤 사이드바 사용량이 다시 조회돼 갱신된다', async () => {
    let quotaCalls = 0
    renderDrivePage(SPACE_ID, {
      extra: <DriveSidebar />,
      handlers: [
        http.get(`${API}/quota`, () => {
          quotaCalls++
          return HttpResponse.json({ usedBytes: quotaCalls === 1 ? 57_461_965 : 57_671_680, quotaBytes: 10_737_418_240 })
        }),
        http.post(`${API}/spaces/${SPACE_ID}/files`, () => HttpResponse.json(createFile(), { status: 201 })),
        ...driveBaseHandlers(),
      ],
    })
    await waitFor(() => expect(screen.getByTestId('drive-usage-text')).toHaveTextContent('54.8'), { timeout: PAGE_LOAD_TIMEOUT })
    expect(quotaCalls).toBe(1)
    chooseFiles([new File(['hello'], 'memo.txt', { type: 'text/plain' })])
    await waitFor(() => expect(screen.getByTestId('drive-usage-text')).toHaveTextContent('55.0'))
    expect(quotaCalls).toBeGreaterThan(1)
  })
})

describe('휴지통', () => {
  // 휴지통 목록 한 건(memo.txt) 조회
  const trashHandler = http.get(`${API}/spaces/${SPACE_ID}/trash`, () => HttpResponse.json(makeTrashList()))

  // 휴지통을 열면 목록이 보이고, 복원하면 다시 조회해 비어 있음 안내로 바뀐다.
  test('복원하면 휴지통 목록이 다시 조회돼 비어 있음으로 바뀐다', async () => {
    let restored = false
    const { user } = await openDrive({ folders: [], files: [] }, {
      handlers: [
        http.get(`${API}/spaces/${SPACE_ID}/trash`, () => HttpResponse.json(restored ? { items: [] } : makeTrashList())),
        http.post(`${API}/files/901/restore`, () => {
          restored = true
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    await user.click(screen.getByTestId('trash-toggle'))
    const trash = await screen.findByTestId('trash-view')
    expect(await within(trash).findByText('memo.txt')).toBeInTheDocument()
    await user.click(within(trash).getByRole('button', { name: '복원' }))
    expect(await screen.findByText('휴지통이 비어 있습니다')).toBeInTheDocument()
    expect(restored).toBe(true)
  })

  // WP-1082: 휴지통 뷰에서는 새 폴더·업로드를 감춘다 — 거기서 만들면 보이지 않는 루트에 알림 없이 생겼다. 드라이브로 돌아가면 다시 보인다.
  test('휴지통 뷰에서는 새 폴더·업로드 단추가 없고, 드라이브로 돌아가면 다시 보인다', async () => {
    const { user } = await openDrive({ folders: [], files: [] }, {
      handlers: [trashHandler],
    })
    expect(screen.getByTestId('drive-new-folder')).toBeInTheDocument()
    await user.click(screen.getByTestId('trash-toggle'))
    expect(await within(await screen.findByTestId('trash-view')).findByText('memo.txt')).toBeInTheDocument()
    expect(screen.queryByTestId('drive-new-folder')).not.toBeInTheDocument()
    expect(screen.queryByTestId('drive-upload')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('trash-toggle'))
    expect(await screen.findByTestId('drive-new-folder')).toBeInTheDocument()
    expect(screen.getByTestId('drive-upload')).toBeInTheDocument()
  })

  // WP-1082: 휴지통 뷰에 파일을 놓아도 올리지 않는다. 먼저 휴지통에 놓고, 드라이브로 돌아가 다시 놓으면 그 한 번만 올라간다.
  test('휴지통 뷰에 파일을 놓으면 올리지 않고, 드라이브 뷰에 놓으면 올린다', async () => {
    let posts = 0
    const { user } = await openDrive({ folders: [], files: [] }, {
      handlers: [
        trashHandler,
        http.post(`${API}/spaces/${SPACE_ID}/files`, () => {
          posts += 1
          return HttpResponse.json(createFile({ id: 30 }), { status: 201 })
        }),
      ],
    })
    await user.click(screen.getByTestId('trash-toggle'))
    await within(await screen.findByTestId('trash-view')).findByText('memo.txt')
    // 휴지통 뷰에서는 끌어 와도 놓기 표시(테두리)를 하지 않는다.
    fireEvent.dragOver(screen.getByTestId('drive-dropzone'), { dataTransfer: { dropEffect: 'copy' } })
    expect(screen.getByTestId('drive-dropzone').style.outline).toBe('')
    dropFile()
    await user.click(screen.getByTestId('trash-toggle'))
    await screen.findByTestId('drive-new-folder')
    dropFile()
    await waitFor(() => expect(posts).toBe(1))
    expect(await screen.findByText(/업로드 완료/)).toBeInTheDocument()
    expect(posts).toBe(1)
  })

  // WP-1101: 업로드 중에 휴지통을 열어도 진행 표시(누를 수 없는 「업로드 중…」)와 「취소」가 함께 남는다 — 취소만 홀로 남지 않는다.
  test('업로드 중에 휴지통을 열면 진행 표시와 취소가 함께 보이고, 취소하면 함께 사라진다', async () => {
    const { user } = await openDrive({ folders: [], files: [] }, {
      handlers: [trashHandler, http.post(`${API}/spaces/${SPACE_ID}/files`, () => new Promise<Response>(() => {}))],
    })
    chooseFiles([new File(['hello'], 'memo.txt', { type: 'text/plain' })])
    await waitFor(() => expect(screen.getByTestId('drive-upload')).toHaveTextContent('업로드 중…'))
    await user.click(screen.getByTestId('trash-toggle'))
    await within(await screen.findByTestId('trash-view')).findByText('memo.txt')
    expect(screen.getByTestId('drive-upload')).toHaveTextContent('업로드 중…')
    expect(screen.getByTestId('drive-upload')).toBeDisabled()
    expect(screen.getByTestId('drive-upload-cancel')).toBeInTheDocument()
    // 새 폴더는 휴지통에서 계속 감춘다.
    expect(screen.queryByTestId('drive-new-folder')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('drive-upload-cancel'))
    expect(await screen.findByText('업로드를 취소했습니다.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('drive-upload')).not.toBeInTheDocument())
    expect(screen.queryByTestId('drive-upload-cancel')).not.toBeInTheDocument()
  })

  // #143: 복원 500 이면 사유 토스트를 보이고 휴지통 목록은 그대로다.
  test('복원 실패(500) 시 사유 토스트를 보이고 목록은 남는다', async () => {
    const { user } = await openDrive({ folders: [], files: [] }, {
      handlers: [
        trashHandler,
        http.post(`${API}/files/901/restore`, () =>
          HttpResponse.json({ status: 500, error: 'Internal Server Error', message: '복원하지 못했습니다.' }, { status: 500 }),
        ),
      ],
    })
    await user.click(screen.getByTestId('trash-toggle'))
    const trash = await screen.findByTestId('trash-view')
    await user.click(await within(trash).findByRole('button', { name: '복원' }))
    expect(await screen.findByText('복원하지 못했습니다.')).toBeInTheDocument()
    expect(within(trash).getByText('memo.txt')).toBeInTheDocument()
  })
})

describe('머리말·주소', () => {
  // 페이지 제목은 화면에 없고(스크린리더용 숨은 h1), 경로(팀 공간 / 문서 / 2026)가 유일한 위치 표시 — 쓰기 버튼은 보인다.
  // 경로는 헤더 왼쪽 한 줄, 시작점은 공간 이름(앱 이름 「드라이브」는 넣지 않는다, WP-979 §B-1).
  test('folderId 로 들어오면 숨은 h1 과 폴더 이름 경로, 새 폴더·업로드 버튼을 보인다', async () => {
    await openDrive({ folders: [], files: [] }, {
      search: '?folderId=10',
      handlers: [
        http.get(`${API}/folders/10/path`, () => HttpResponse.json([{ id: 5, name: '문서' }, { id: 10, name: '2026' }])),
        // 경로 시작점은 공간 이름 — 공간 한 건 조회(GET /drive/spaces/{id})로 받는다.
        http.get(`${API}/spaces/${SPACE_ID}`, () => HttpResponse.json(createSpace())),
      ],
    })
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveClass('sr-only')
    expect(h1.textContent).toMatch(/^드라이브/)
    expect(within(screen.getByTestId('page-header')).getByTestId('drive-breadcrumb')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('drive-root')).toHaveTextContent('팀 공간'))
    expect(await screen.findByTestId('drive-crumb-5')).toHaveTextContent('문서')
    expect(screen.getByTestId('drive-crumb-10')).toHaveTextContent('2026')
    expect(screen.getByTestId('drive-new-folder')).toBeInTheDocument()
    expect(screen.getByTestId('drive-upload')).toBeInTheDocument()
  })

  // 풀페이지에서 폴더를 열면 URL 의 folderId 가 바뀐다(뒤로 가기·공유 가능한 주소).
  test('폴더를 누르면 주소의 folderId 가 갱신된다', async () => {
    const { user, location } = await openDrive((url) => (url.searchParams.get('parentId') ? { folders: [], files: [] } : { folders: [createFolder({ id: 10, name: '폴더A' })], files: [] }), {
      handlers: [http.get(`${API}/folders/10/path`, () => HttpResponse.json([{ id: 10, name: '폴더A' }]))],
    })
    await user.click(await screen.findByRole('button', { name: '폴더A' }))
    await waitFor(() => expect(location()).toMatch(/folderId=10/))
  })

  // WP-529: 없는/권한 없는 공간(404 존재 은닉)은 빈 폴더 + 업로드 대신 「불러올 수 없음」 상태, 「드라이브로」는 /drive 로 간다.
  test('열 수 없는 공간은 찾을 수 없음 상태를 보이고 「드라이브로」가 공간 주소를 벗어난다', async () => {
    const notFound = () => HttpResponse.json({ status: 404, message: '드라이브 공간을 찾을 수 없습니다 (id: 999)' }, { status: 404 })
    const { user, location } = renderDrivePage(999, {
      handlers: [http.get(`${API}/spaces/999`, notFound), http.get(`${API}/spaces/999/items`, notFound), ...driveBaseHandlers()],
    })
    expect(await screen.findByText('드라이브 공간을 불러올 수 없습니다', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.getByText('요청한 공간이 존재하지 않거나 접근 권한이 없습니다.')).toBeInTheDocument()
    expect(screen.queryByTestId('drive-empty-folder')).not.toBeInTheDocument()
    expect(screen.queryByTestId('drive-upload')).not.toBeInTheDocument()
    expect(screen.queryByTestId('drive-new-folder')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '드라이브로' }))
    await waitFor(() => expect(location()).not.toMatch(/\/drive\/spaces\/999/))
  })
})

describe('이동 창', () => {
  // 파일 ⋯ → 이동 → 창에서 폴더로 들어가 「여기로」 → PATCH /files/:id/move { targetFolderId } 뒤 루트 목록에서 빠진다.
  test('파일을 폴더로 옮기면 targetFolderId 로 요청하고 목록에서 빠진다', async () => {
    const state: Items = { folders: [createFolder({ id: 10, name: '문서' })], files: [createFile({ id: 20, name: 'memo.txt' })] }
    const moves: unknown[] = []
    const { user } = await openDrive((url) => (url.searchParams.get('parentId') === '10' ? { folders: [], files: [] } : state), {
      handlers: [
        http.patch(`${API}/files/20/move`, async ({ request }) => {
          moves.push(await request.json())
          state.files = []
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    await pickRowMenu(user, 'memo.txt', '이동')
    const picker = await screen.findByTestId('folder-picker')
    await user.click(within(picker).getByRole('button', { name: '문서' }))
    await user.click(within(picker).getByTestId('folder-picker-confirm'))
    await waitFor(() => expect(screen.queryByText('memo.txt')).not.toBeInTheDocument())
    expect(moves).toEqual([{ targetFolderId: 10 }])
  })

  // WP-530: 폴더 행 「이동」 → 깊이 들어갔다 경로의 중간 단계로 돌아가 확정하면 그 폴더(targetParentId)로 옮긴다.
  test('폴더 이동 — 경로 중간 단계로 돌아가 확정하면 그 폴더로 옮긴다', async () => {
    const folder = (id: number, name: string, parentId: number | null) => createFolder({ id, name, parentId })
    const children: Record<string, DriveFolder[]> = {
      root: [folder(10, '2026 마케팅 자료', null), folder(12, '보관함', null)],
      '10': [folder(11, '분기 보고서', 10)],
      '11': [],
    }
    const moves: unknown[] = []
    const { user } = await openDrive((url) => ({ folders: children[url.searchParams.get('parentId') ?? 'root'] ?? [], files: [] }), {
      handlers: [
        http.patch(`${API}/folders/12/move`, async ({ request }) => {
          moves.push(await request.json())
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    const row = await rowOf('보관함')
    await user.click(within(row).getByRole('button', { name: '보관함 이동' }))
    const picker = await screen.findByTestId('folder-picker')
    await user.click(within(picker).getByRole('button', { name: '2026 마케팅 자료' }))
    await user.click(await within(picker).findByRole('button', { name: '분기 보고서' }))
    const path = within(picker).getByTestId('folder-picker-path')
    await waitFor(() => expect(path).toHaveTextContent('루트/2026 마케팅 자료/분기 보고서'))
    await user.click(within(path).getByRole('button', { name: '2026 마케팅 자료' }))
    expect(path).toHaveTextContent('루트/2026 마케팅 자료')
    await user.click(within(picker).getByTestId('folder-picker-confirm'))
    await waitFor(() => expect(moves).toEqual([{ targetParentId: 10 }]))
  })

  // #319: 폴더 선택 창은 Esc·바깥(오버레이) 누름으로 닫힌다(shadcn Dialog).
  test('폴더 선택 창은 Esc 와 바깥 누름으로 닫힌다', async () => {
    const { user } = await openDrive({ folders: [createFolder({ id: 10, name: '문서' })], files: [] })
    const row = await rowOf('문서')
    await user.click(within(row).getByRole('button', { name: '문서 이동' }))
    await screen.findByTestId('folder-picker')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('folder-picker')).not.toBeInTheDocument())

    await user.click(within(row).getByRole('button', { name: '문서 이동' }))
    await screen.findByTestId('folder-picker')
    // 모달이 바깥 포인터를 막아(pointer-events: none) user.click 대신 바깥 pointerdown 을 직접 보낸다(Radix 바깥 닫기).
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByTestId('folder-picker')).not.toBeInTheDocument())
  })
})

describe('썸네일', () => {
  afterEach(() => vi.unstubAllGlobals())

  // #615: 썸네일 404(생성 실패)는 캐시되어, 하위 폴더를 오가며 목록이 다시 그려져도 같은 요청을 반복하지 않는다.
  // 뷰포트 진입 판정(IntersectionObserver)은 레이아웃이라, 여기선 관찰하자마자 보인다고 알리는 관찰자로 바꾼다.
  test('썸네일 404 는 폴더를 오가도 다시 요청하지 않는다', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        private cb: IntersectionObserverCallback
        constructor(cb: IntersectionObserverCallback) {
          this.cb = cb
        }
        observe() {
          queueMicrotask(() => this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver))
        }
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return []
        }
      },
    )
    let thumbs = 0
    const root: Items = { folders: [createFolder({ id: 30, name: 'sub' })], files: [createFile({ id: 14, name: 'broken.png', mimeType: 'image/png', category: 'IMAGE' })] }
    const { user, location } = await openDrive((url) => (url.searchParams.get('parentId') ? { folders: [], files: [] } : root), {
      handlers: [
        http.get(`${API}/folders/30/path`, () => HttpResponse.json([{ id: 30, name: 'sub' }])),
        http.get(`${API}/files/14/thumbnail`, () => {
          thumbs++
          return HttpResponse.json({}, { status: 404 })
        }),
      ],
    })
    await screen.findByText('broken.png')
    await waitFor(() => expect(thumbs).toBe(1))
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole('button', { name: 'sub' }))
      await waitFor(() => expect(location()).toMatch(/folderId=30/))
      // 하위 폴더 목록(빈 폴더)으로 바뀌어 썸네일 행이 내려갔다가, 루트로 돌아오며 다시 올라온다.
      await waitFor(() => expect(screen.queryByText('broken.png')).not.toBeInTheDocument())
      await user.click(screen.getByTestId('drive-root'))
      await screen.findByText('broken.png')
    }
    await act(() => new Promise((r) => setTimeout(r, 50)))
    expect(thumbs).toBe(1)
  })
})

describe('미리보기', () => {
  // 이미지 파일을 누르면 미리보기에 그 콘텐츠를 이미지로 그린다(objectURL — 픽셀은 E2E 몫이 아니라 관심 밖).
  test('이미지 파일을 누르면 미리보기에 이미지가 보인다', async () => {
    const { user } = await openDrive({ folders: [], files: [createFile({ id: 70, name: 'photo.png', mimeType: 'image/png', sizeBytes: 100, category: 'IMAGE' })] }, {
      handlers: [
        http.get(`${API}/files/70/content`, () => new HttpResponse(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } })),
        ...fileSideHandlers(70),
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'photo.png' }))
    const body = await screen.findByTestId('preview-body')
    await waitFor(() => expect(body.querySelector('img')).not.toBeNull())
  })
})

describe('검색 결과 화면의 만들기·놓기 (WP-1101)', () => {
  const searchHandlers = [
    http.get(`${API}/spaces/${SPACE_ID}/search`, () => HttpResponse.json({ folders: [], files: [createFile({ id: 41, name: '예산안.pdf' })] })),
    http.get(`${API}/search`, () => HttpResponse.json({ hits: [], semantic: false })),
  ]

  // 결과 화면에서 만들면 보이지 않는 지금 폴더에 알림 없이 생겼다 — 휴지통처럼 새 폴더·업로드를 감추고, 검색을 지우면 다시 보인다.
  test('검색 결과 화면에서는 새 폴더·업로드 단추가 없고, 검색을 지우면 다시 보인다', async () => {
    const { user } = await openDrive({ folders: [], files: [] }, { handlers: searchHandlers })
    expect(screen.getByTestId('drive-upload')).toBeInTheDocument()
    await user.click(screen.getByLabelText('파일명 및 콘텐츠 검색'))
    await user.paste('예산')
    expect(await within(await screen.findByTestId('search-results')).findByText('예산안.pdf')).toBeInTheDocument()
    expect(screen.queryByTestId('drive-new-folder')).not.toBeInTheDocument()
    expect(screen.queryByTestId('drive-upload')).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('파일명 및 콘텐츠 검색'))
    expect(await screen.findByTestId('drive-new-folder')).toBeInTheDocument()
    expect(screen.getByTestId('drive-upload')).toBeInTheDocument()
  })

  // 검색어를 친 직후(결과가 오기 전)에도 업로드를 막는다 — 곧 결과 화면이 덮어 보이지 않는 폴더에 생긴다.
  test('검색어를 친 직후 결과가 오기 전에도 새 폴더·업로드가 없다', async () => {
    const { user } = await openDrive({ folders: [], files: [] }, {
      // 결과를 늦게 준다 — 디바운스·조회 중인 틈을 본다.
      handlers: [http.get(`${API}/spaces/${SPACE_ID}/search`, () => new Promise<Response>(() => {})), http.get(`${API}/search`, () => new Promise<Response>(() => {}))],
    })
    await user.click(screen.getByLabelText('파일명 및 콘텐츠 검색'))
    await user.paste('예산')
    expect(screen.queryByTestId('search-results')).not.toBeInTheDocument()
    expect(screen.queryByTestId('drive-new-folder')).not.toBeInTheDocument()
    expect(screen.queryByTestId('drive-upload')).not.toBeInTheDocument()
  })

  // 결과 화면에 파일을 놓아도 올리지 않고 놓기 테두리도 없다. 드라이브 뷰에서는 테두리가 생기고 올린다(대조).
  test('검색 결과 화면에 놓으면 올리지 않고, 폴더 보기에서는 테두리가 생기고 올린다', async () => {
    let posts = 0
    const { user } = await openDrive({ folders: [], files: [] }, {
      handlers: [
        ...searchHandlers,
        http.post(`${API}/spaces/${SPACE_ID}/files`, () => {
          posts += 1
          return HttpResponse.json(createFile({ id: 30 }), { status: 201 })
        }),
      ],
    })
    await user.click(screen.getByLabelText('파일명 및 콘텐츠 검색'))
    await user.paste('예산')
    await within(await screen.findByTestId('search-results')).findByText('예산안.pdf')
    fireEvent.dragOver(screen.getByTestId('drive-dropzone'), { dataTransfer: { dropEffect: 'copy' } })
    expect(screen.getByTestId('drive-dropzone').style.outline).toBe('')
    dropFile()

    await user.clear(screen.getByLabelText('파일명 및 콘텐츠 검색'))
    await screen.findByTestId('drive-new-folder')
    fireEvent.dragOver(screen.getByTestId('drive-dropzone'), { dataTransfer: { dropEffect: 'copy' } })
    expect(screen.getByTestId('drive-dropzone').style.outline).not.toBe('')
    dropFile()
    await waitFor(() => expect(posts).toBe(1))
    expect(await screen.findByText(/업로드 완료/)).toBeInTheDocument()
    expect(posts).toBe(1)
  })
})
