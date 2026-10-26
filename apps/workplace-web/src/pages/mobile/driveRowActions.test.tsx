// 모바일 드라이브 행 액션(WP-216) — 페이지 테스트(WP-971).
// ⋮ 시트의 공유·삭제·이름 변경 요청, 원본 유실·보관된 공간의 비활성 판정, 선택 모드 밖 행 탭의 미리보기 주소는
// 브라우저 없이 판정되므로 e2e/pages/mobile/drive-row-actions.spec.ts 에서 옮겼다.
// 길게 누르기·선택 범위·포커스(@input), 다운로드·업로드 진행(@platform), ⋮ 위치·하단 바 위치(@layout)는 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { createFile, createFolder, createSpace, personalSpace } from '../../../e2e/factories/drive.factory'

// 모바일(iPhone 13·터치) — 파일 안 첫 renderPage 전에 한 번.
mockViewport()

const SPACE_ID = 1
const LONG_FILE = '2026_하반기_스마트워크플레이스_도입제안서_최종_검토반영_v3_고객사송부본.pdf'
const FOLDER = createFolder({ id: 10, name: '고객사별 견적 및 계약 검토 자료' })
const FILE = createFile({ id: 70, name: LONG_FILE, mimeType: 'application/pdf', category: 'PDF', sizeBytes: 4_400_000 })
const MISSING = createFile({ id: 71, name: '원본유실_회의록.docx', available: false })

type Call = { method: string; path: string; body: unknown }

/** 공간·항목 조회와 쓰기 요청 — 쓰기는 calls 에 쌓는다. */
function driveApi({ archived = false } = {}) {
  const calls: Call[] = []
  const record = async (request: Request) => {
    const text = await request.text()
    calls.push({ method: request.method, path: new URL(request.url).pathname, body: text ? JSON.parse(text) : null })
  }
  const handlers = [
    http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 * 1024 * 1024 })),
    http.get('/api/v1/drive/spaces', () => HttpResponse.json([personalSpace(), createSpace({ archived })])),
    http.get(`/api/v1/drive/spaces/${SPACE_ID}`, () => HttpResponse.json(createSpace({ archived }))),
    http.get(`/api/v1/drive/spaces/${SPACE_ID}/items`, () => HttpResponse.json({ folders: [FOLDER], files: [FILE, MISSING] })),
    http.get('/api/v1/drive/files/:id/thumbnail', () => new HttpResponse(null, { status: 404 })),
    // 미리보기가 여는 부가 조회 — 이 파일은 미리보기 내용을 보지 않으므로 없음으로 둔다.
    http.get('/api/v1/drive/files/:id/:sub', ({ params }) =>
      params.sub === 'share-links' ? HttpResponse.json([]) : new HttpResponse(null, { status: 404 }),
    ),
    http.delete('/api/v1/drive/files/70', async ({ request }) => {
      await record(request)
      return new HttpResponse(null, { status: 204 })
    }),
    http.patch('/api/v1/drive/folders/10', async ({ request }) => {
      await record(request)
      return HttpResponse.json({ ...FOLDER, name: '계약 자료' })
    }),
  ]
  return { handlers, calls }
}

/** 공간을 열고 파일 행이 뜰 때까지 기다린다. */
async function open(opts: { archived?: boolean } = {}) {
  const api = driveApi(opts)
  const page = renderPage(`/drive/spaces/${SPACE_ID}`, { handlers: api.handlers })
  await screen.findByTestId('drive-row-file-70', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return { ...page, api }
}

describe('모바일 드라이브 ⋮ 시트', () => {
  // 공유는 공유 모달로, 삭제는 확인을 거쳐 DELETE 로 이어지는지 — 시트가 모바일의 유일한 진입점이라 끊기면 기능을 못 쓴다.
  test('파일 ⋮ → 공유 링크는 공유 모달, 삭제는 확인 후 DELETE', async () => {
    const { user, api } = await open()
    await user.click(screen.getByTestId('drive-row-more-file-70'))
    await user.click(await screen.findByTestId('mobile-action-share'))
    expect(await screen.findByTestId('share-link-modal')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('share-link-modal')).not.toBeInTheDocument())

    await user.click(screen.getByTestId('drive-row-more-file-70'))
    await user.click(await screen.findByTestId('mobile-action-delete'))
    await user.click(await screen.findByTestId('drive-confirm-confirm'))
    await waitFor(() => expect(api.calls).toEqual([{ method: 'DELETE', path: '/api/v1/drive/files/70', body: null }]))
  })

  // 폴더 시트엔 다운로드가 없고, 이름 변경은 기존 이름으로 열려 새 이름 payload 로 PATCH 한다.
  test('폴더 ⋮ → 이름 변경은 새 이름으로 PATCH', async () => {
    const { user, api } = await open()
    await user.click(screen.getByTestId('drive-row-more-folder-10'))
    const sheet = await screen.findByTestId('drive-row-sheet')
    expect(within(sheet).queryByTestId('mobile-action-download')).not.toBeInTheDocument()
    await user.click(within(sheet).getByTestId('mobile-action-rename'))
    const input = await screen.findByTestId('folder-name-input')
    expect(input).toHaveValue(FOLDER.name)
    await user.clear(input)
    await user.paste('계약 자료')
    await user.click(screen.getByTestId('folder-name-confirm'))
    await waitFor(() => expect(api.calls).toEqual([{ method: 'PATCH', path: '/api/v1/drive/folders/10', body: { name: '계약 자료' } }]))
  })

  // 원본이 없는 파일은 내용이 필요한 작업(다운로드·공유·복사)만 막고 정리 작업(이동·삭제)은 남긴다.
  test('원본 유실 파일은 다운로드·공유·복사가 비활성', async () => {
    const { user } = await open()
    await user.click(screen.getByTestId('drive-row-more-file-71'))
    const sheet = await screen.findByTestId('drive-row-sheet')
    expect(within(sheet).getByTestId('mobile-action-download')).toBeDisabled()
    expect(within(sheet).getByTestId('mobile-action-share')).toBeDisabled()
    expect(within(sheet).getByTestId('mobile-action-copy')).toBeDisabled()
    expect(within(sheet).getByTestId('mobile-action-move')).toBeEnabled()
    expect(within(sheet).getByTestId('mobile-action-delete')).toBeEnabled()
  })

  // 보관된 공간은 읽기 전용 — 배너가 보이고 폴더 시트의 쓰기 작업이 모두 막힌다.
  test('보관된 공간 — 폴더 시트의 쓰기 작업이 모두 비활성', async () => {
    const { user } = await open({ archived: true })
    expect(await screen.findByTestId('drive-readonly-banner')).toBeInTheDocument()
    await user.click(screen.getByTestId('drive-row-more-folder-10'))
    const sheet = await screen.findByTestId('drive-row-sheet')
    for (const key of ['rename', 'move', 'copy', 'delete']) {
      expect(within(sheet).getByTestId(`mobile-action-${key}`)).toBeDisabled()
    }
  })
})

// 선택 모드가 아니면 행 탭은 미리보기(?preview=)로 간다 — 선택 토글로 새면 파일을 열 수 없다.
test('선택 모드가 아니면 행 탭은 그대로 미리보기를 연다', async () => {
  const { user, location } = await open()
  await user.click(screen.getByRole('button', { name: LONG_FILE }))
  await waitFor(() => expect(location()).toBe(`/drive/spaces/${SPACE_ID}?preview=70`))
})
