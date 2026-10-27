// @vitest-environment jsdom
// happy-dom(화면 테스트 기본, WP-1002)과 날짜 칸·글자 수 제한·포커스 이동 처리가 달라 이 파일은 jsdom 에서 돈다.
// 드라이브 목록 행 작업(DrivePage) — 화면 컴포넌트 테스트(WP-971, WP-984).
// 행 ⋯ 메뉴 구성·삭제 확인, 보관/보기 전용 공간의 버튼 상태, 파일 이름 변경 실패·빈 이름, 원본 유실 파일, 버전 이력·롤백,
// 여러 개 선택(벌크 이동·ZIP·삭제)은 브라우저 없이 판정되므로 다음 E2E 에서 옮겼다:
// drive.spec.ts · drive-file-rename.spec.ts · drive-missing-blob.spec.ts · drive-versioning.spec.ts · drive-bulk.spec.ts · drive-dnd-move.spec.ts ·
// drive-space-members.spec.ts(보기 전용 롤백 없음).
// 호버로만 보이는 ⋯·포커스 복원·IME·끌어 옮기기·선택 범위는 각 E2E(@input)가 지킨다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, driveBaseHandlers, fileSideHandlers, renderDrivePage } from '@/test/kits/drive/testkit-b6'
import { PAGE_LOAD_TIMEOUT } from '@/test/renderPage'
import type { renderScreen } from '@/test/renderScreen'
import type { DriveFile, DriveFolder, DriveSpace } from '@/types/drive'

import { createFile, createFolder, createSpace, createVersion, personalSpace } from '../../../e2e/factories/drive.factory'

const SPACE_ID = 1

type Items = { folders: DriveFolder[]; files: DriveFile[] }
type User = ReturnType<typeof renderScreen>['user']

/** 공간 화면을 띄우고 목록이 그려질 때까지 기다린다. team 으로 공간 상세(보관·역할)를 바꾼다. */
async function openDrive(items: Items | (() => Items), { team = createSpace(), handlers = [] as RequestHandler[] } = {}) {
  const spaces: DriveSpace[] = [personalSpace(), team]
  const view = renderDrivePage(SPACE_ID, { handlers: [...handlers, ...driveBaseHandlers({ spaces, items })] })
  await screen.findByTestId('drive-page', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return view
}

/** 행(listitem)을 이름으로 찾는다. */
async function rowOf(name: string) {
  return (await screen.findByText(name)).closest('li') as HTMLElement
}

/** 행 ⋯ 더보기를 연다 — ⋯ 는 hover 때만 보이지만(E2E @input) DOM 에는 있어 바로 누른다. */
async function openRowMenu(user: User, name: string) {
  const row = await rowOf(name)
  await user.click(within(row).getByRole('button', { name: `${name} 더보기` }))
  return screen.findByRole('menu')
}

describe('행 ⋯ 메뉴', () => {
  // WP-363: 파일·폴더 ⋯ 메뉴 순서는 모바일 시트와 같고, 삭제는 구분선 아래 맨 끝(destructive). 폴더 삭제는 확인 뒤 DELETE.
  test('파일·폴더 ⋯ 메뉴 순서와 맨 끝 삭제, 폴더 삭제는 확인 뒤 DELETE 하고 목록에서 빠진다', async () => {
    const state: Items = { folders: [createFolder({ id: 10, name: '문서' })], files: [createFile({ id: 20, name: 'memo.txt' })] }
    let deletes = 0
    const { user } = await openDrive(() => state, {
      handlers: [
        http.delete(`${API}/folders/10`, () => {
          deletes++
          state.folders = []
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    let menu = await openRowMenu(user, 'memo.txt')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['이름 변경', '이동', '복사', '버전 이력', '삭제'])
    expect(within(menu).getAllByRole('separator')).toHaveLength(1)
    expect(within(menu).getByRole('separator').nextElementSibling).toHaveTextContent('삭제')
    expect(within(menu).getByRole('menuitem', { name: '삭제' })).toHaveAttribute('data-variant', 'destructive')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    menu = await openRowMenu(user, '문서')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['이름 변경', '복사', '삭제'])
    expect(within(menu).getByRole('separator').nextElementSibling).toHaveTextContent('삭제')
    await user.click(within(menu).getByRole('menuitem', { name: '삭제' }))
    expect(await screen.findByTestId('drive-confirm-dialog')).toHaveTextContent('폴더를 휴지통으로 보낼까요?')
    await user.click(screen.getByTestId('drive-confirm-confirm'))
    await waitFor(() => expect(screen.queryByRole('button', { name: '문서' })).not.toBeInTheDocument())
    expect(deletes).toBe(1)
  })

  // #135: 파일 삭제는 확인 대화상자를 거치고, 취소하면 DELETE 없이 파일이 남는다.
  test('파일 삭제 확인에서 취소하면 DELETE 하지 않는다', async () => {
    let calls = 0
    const { user } = await openDrive({ folders: [], files: [createFile({ id: 20, name: 'memo.txt' })] }, {
      handlers: [
        http.delete(`${API}/files/20`, () => {
          calls++
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    const menu = await openRowMenu(user, 'memo.txt')
    await user.click(within(menu).getByRole('menuitem', { name: '삭제' }))
    await screen.findByTestId('drive-confirm-dialog')
    await user.click(screen.getByTestId('drive-confirm-cancel'))
    await waitFor(() => expect(screen.queryByTestId('drive-confirm-dialog')).not.toBeInTheDocument())
    expect(calls).toBe(0)
    expect(screen.getByText('memo.txt')).toBeInTheDocument()
  })
})

describe('공간 권한', () => {
  // WP-363·WP-364: 보관된 공간 — 폴더 행 인라인 이동과 ⋯ 의 이름 변경·복사·삭제가 비활성, 읽기 전용 배너, 끌어 옮기기도 켜지 않는다.
  test('보관된 공간은 폴더 쓰기 작업이 비활성이고 끌어 옮기기를 켜지 않는다', async () => {
    const { user } = await openDrive(
      { folders: [createFolder({ id: 10, name: '문서' })], files: [createFile({ id: 20, name: 'memo.txt' })] },
      { team: createSpace({ archived: true }) },
    )
    expect(await screen.findByTestId('drive-readonly-banner')).toBeInTheDocument()
    const row = await rowOf('문서')
    await waitFor(() => expect(within(row).getByRole('button', { name: '문서 이동' })).toBeDisabled())
    const menu = await openRowMenu(user, '문서')
    for (const name of ['이름 변경', '복사', '삭제']) expect(within(menu).getByRole('menuitem', { name })).toHaveAttribute('data-disabled')
    expect(screen.getByTestId('drive-row-file-20')).not.toHaveAttribute('aria-roledescription')
  })

  // WP-602: 팀 공간 VIEWER — 새 폴더·업로드·공유·이동이 없고, 파일은 다운로드와 ⋯ 의 버전 이력만 남는다.
  test('VIEWER 팀 공간은 쓰기 버튼 없이 다운로드·버전 이력만 보인다', async () => {
    const { user } = await openDrive(
      { folders: [createFolder({ id: 10, name: '문서' })], files: [createFile({ id: 20, name: '보고서.pdf' })] },
      { team: createSpace({ role: 'VIEWER' }) },
    )
    expect(await screen.findByTestId('drive-viewer-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('drive-new-folder')).not.toBeInTheDocument()
    expect(screen.queryByTestId('drive-upload')).not.toBeInTheDocument()
    const folderRow = await rowOf('문서')
    expect(within(folderRow).queryAllByRole('button', { name: /이동|더보기/ })).toHaveLength(0)
    const fileRow = await rowOf('보고서.pdf')
    expect(within(fileRow).getByRole('button', { name: /다운로드/ })).toBeInTheDocument()
    expect(within(fileRow).queryByTestId('share-link-btn')).not.toBeInTheDocument()
    const menu = await openRowMenu(user, '보고서.pdf')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['버전 이력'])
  })
})

describe('파일 이름 변경', () => {
  /** PATCH /files/70 — 이름이 conflict 면 409, 아니면 state 를 바꿔 200. 받은 본문은 bodies 에 쌓는다. */
  function renameApi(state: Items, { conflict = '', fail400 = false } = {}) {
    const bodies: { name: string }[] = []
    const handler = http.patch(`${API}/files/70`, async ({ request }) => {
      const body = (await request.json()) as { name: string }
      bodies.push(body)
      if (fail400) {
        return HttpResponse.json({ status: 400, error: 'Bad Request', message: '파일 이름에 / \\ 나 제어 문자는 쓸 수 없고, . 이나 .. 만으로 지을 수 없습니다.' }, { status: 400 })
      }
      if (body.name === conflict) {
        return HttpResponse.json({ status: 409, error: 'Conflict', message: `같은 폴더에 이미 '${body.name}' 이름이 있습니다.` }, { status: 409 })
      }
      state.files = state.files.map((f) => (f.id === 70 ? { ...f, name: body.name } : f))
      return HttpResponse.json(state.files.find((f) => f.id === 70))
    })
    return { bodies, handler }
  }

  async function openRename(user: User, name: string) {
    const menu = await openRowMenu(user, name)
    await user.click(within(menu).getByRole('menuitem', { name: '이름 변경' }))
    return screen.findByTestId('rename-dialog-input')
  }

  async function setName(user: User, input: HTMLElement, value: string) {
    await user.clear(input)
    await user.click(input)
    if (value) await user.paste(value)
  }

  // 409(같은 이름) — 대화상자를 유지한 채 서버 문구를 인라인으로(aria-invalid), 입력하면 지워지고 다른 이름으로 저장되면 목록 반영.
  test('같은 이름(409)은 인라인으로 알리고, 고쳐서 저장하면 목록에 반영된다', async () => {
    const state: Items = { folders: [], files: [createFile({ id: 70, name: 'memo.txt' }), createFile({ id: 71, name: 'notes.txt' })] }
    const api = renameApi(state, { conflict: 'notes.txt' })
    const { user } = await openDrive(() => state, { handlers: [api.handler] })
    const input = await openRename(user, 'memo.txt')
    await setName(user, input, 'notes.txt')
    await user.click(screen.getByTestId('rename-dialog-confirm'))
    expect(await screen.findByTestId('rename-dialog-error')).toHaveTextContent("같은 폴더에 이미 'notes.txt' 이름이 있습니다.")
    expect(input).toHaveAttribute('aria-invalid', 'true')

    await setName(user, input, 'notes-2.txt')
    expect(screen.queryByTestId('rename-dialog-error')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('rename-dialog-confirm'))
    await waitFor(() => expect(screen.queryByTestId('rename-dialog-input')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('drive-row-file-70')).toHaveTextContent('notes-2.txt'))
    expect(api.bodies).toEqual([{ name: 'notes.txt' }, { name: 'notes-2.txt' }])
  })

  // 중복이 아닌 실패(400)도 서버 문구를 그대로 인라인으로 보이고 대화상자를 유지한다.
  test('다른 실패(400)도 서버 문구를 인라인으로 보인다', async () => {
    const state: Items = { folders: [], files: [createFile({ id: 70, name: 'memo.txt' })] }
    const api = renameApi(state, { fail400: true })
    const { user } = await openDrive(() => state, { handlers: [api.handler] })
    const input = await openRename(user, 'memo.txt')
    await setName(user, input, '..')
    await user.click(screen.getByTestId('rename-dialog-confirm'))
    expect(await screen.findByTestId('rename-dialog-error')).toHaveTextContent('제어 문자는 쓸 수 없고')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  // 빈 이름이면 「이름 변경」 버튼 비활성, 이름 그대로면 요청 없이 닫힌다.
  test('빈 이름은 버튼 비활성, 그대로인 이름은 요청 없이 닫힌다', async () => {
    const state: Items = { folders: [], files: [createFile({ id: 70, name: 'memo.txt' })] }
    const api = renameApi(state)
    const { user } = await openDrive(() => state, { handlers: [api.handler] })
    const input = await openRename(user, 'memo.txt')
    expect(screen.getByTestId('rename-dialog-confirm')).toHaveTextContent('이름 변경')
    await setName(user, input, '   ')
    expect(screen.getByTestId('rename-dialog-confirm')).toBeDisabled()
    await setName(user, input, 'memo.txt')
    await user.click(screen.getByTestId('rename-dialog-confirm'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.bodies).toHaveLength(0)
  })
})

describe('원본 유실 파일', () => {
  // #739: 정상 파일은 배지 없이 눌러 미리보기, 유실 파일은 「원본 유실」 배지 + 누르면 미리보기 대신 안내.
  test('정상 파일은 미리보기가 열리고, 유실 파일은 배지와 안내만 보인다', async () => {
    const { user } = await openDrive(
      { folders: [], files: [createFile({ id: 20, name: 'ok.txt', available: true }), createFile({ id: 21, name: 'lost.txt', available: false })] },
      {
        handlers: [
          http.get(`${API}/files/20/content`, () => new HttpResponse('hello', { headers: { 'Content-Type': 'text/plain' } })),
          ...fileSideHandlers(20),
        ],
      },
    )
    const okRow = await rowOf('ok.txt')
    expect(within(okRow).queryByTestId('missing-blob-badge')).not.toBeInTheDocument()
    expect(within(await rowOf('lost.txt')).getByTestId('missing-blob-badge')).toHaveTextContent('원본 유실')

    await user.click(screen.getByRole('button', { name: 'lost.txt' }))
    expect(await screen.findByText('이 파일의 원본이 유실되어 열거나 내려받을 수 없습니다.')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-body')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'ok.txt' }))
    expect(await screen.findByTestId('preview-body')).toBeInTheDocument()
  })

  // #739: 유실 파일의 인라인 다운로드·공유 링크와 ⋯ 복사는 비활성, 이동(메타데이터만)은 허용.
  test('유실 파일은 다운로드·공유·복사가 비활성이고 이동은 된다', async () => {
    const { user } = await openDrive({ folders: [], files: [createFile({ id: 22, name: 'lost2.txt', available: false })] })
    const row = await rowOf('lost2.txt')
    expect(within(row).getByRole('button', { name: 'lost2.txt 다운로드' })).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'lost2.txt 공유 링크' })).toBeDisabled()
    const menu = await openRowMenu(user, 'lost2.txt')
    expect(within(menu).getByRole('menuitem', { name: '복사' })).toHaveAttribute('data-disabled')
    expect(within(menu).getByRole('menuitem', { name: '이동' })).not.toHaveAttribute('data-disabled')
  })
})

describe('버전 이력', () => {
  const versions = [
    createVersion({ versionNo: 2, fileId: 11, sizeBytes: 2048, createdAt: '2026-06-21T01:00:00Z', current: true }),
    // 1024바이트 미만 — 「0KB」로 잘못 보이던 회귀(#792).
    createVersion({ versionNo: 1, fileId: 10, sizeBytes: 100, current: false }),
  ]

  async function openVersions(onRollback: () => void) {
    const file = createFile({ id: 5, name: 'doc.txt', versionCount: 2 })
    const view = await openDrive({ folders: [], files: [file] }, {
      handlers: [
        http.get(`${API}/files/5/versions`, () => HttpResponse.json(versions)),
        http.post(`${API}/files/5/versions/1/rollback`, () => {
          onRollback()
          return HttpResponse.json({ ...file, versionCount: 3 })
        }),
      ],
    })
    expect(await screen.findByTestId('version-badge')).toHaveTextContent('v2')
    const menu = await openRowMenu(view.user, 'doc.txt')
    await view.user.click(within(menu).getByRole('menuitem', { name: '버전 이력' }))
    return { ...view, modal: await screen.findByTestId('version-history-modal') }
  }

  // #79·#792·#829·#815: 버전 행(현재 표시·크기 포맷), 닫기 버튼 하나·하단 「취소」, 롤백은 확인을 거쳐서만 요청한다.
  test('버전 행·크기를 보이고, 롤백은 확인 뒤에만 요청하며 모달은 유지된다', async () => {
    let rollbacks = 0
    const { user, modal } = await openVersions(() => rollbacks++)
    expect(within(modal).getAllByRole('button', { name: '닫기' })).toHaveLength(1)
    expect(within(modal).getAllByRole('button', { name: '취소' })).toHaveLength(1)
    const v2 = await screen.findByTestId('version-row-2')
    expect(v2).toHaveTextContent('현재')
    expect(v2).toHaveTextContent('2.0 KB')
    expect(screen.getByTestId('version-row-1')).toHaveTextContent('100 B')
    expect(screen.getByTestId('version-row-1')).not.toHaveTextContent('0KB')

    await user.click(screen.getByTestId('rollback-1'))
    expect(await screen.findByTestId('rollback-confirm-dialog')).toBeInTheDocument()
    expect(rollbacks).toBe(0)
    await user.click(screen.getByTestId('rollback-confirm-action'))
    await waitFor(() => expect(rollbacks).toBe(1))
    await waitFor(() => expect(screen.queryByTestId('rollback-confirm-dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('version-history-modal')).toBeInTheDocument()
  })

  // #815: 롤백 확인에서 취소하면 요청하지 않고 v2 가 계속 현재다.
  test('롤백 확인에서 취소하면 요청하지 않는다', async () => {
    let rollbacks = 0
    const { user } = await openVersions(() => rollbacks++)
    await user.click(await screen.findByTestId('rollback-1'))
    const dialog = await screen.findByTestId('rollback-confirm-dialog')
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByTestId('rollback-confirm-dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('version-history-modal')).toBeInTheDocument()
    expect(rollbacks).toBe(0)
    expect(screen.getByTestId('version-row-2')).toHaveTextContent('현재')
  })
})

describe('보기 전용 버전 이력', () => {
  // WP-582: 보기 전용 멤버도 버전 이력은 보지만 롤백 버튼은 없다.
  test('VIEWER 는 버전 이력을 보되 롤백이 없다', async () => {
    const { user } = await openDrive({ folders: [], files: [createFile({ id: 20, name: '주간 회의록.docx' })] }, {
      team: createSpace({ role: 'VIEWER' }),
      handlers: [
        http.get(`${API}/files/20/versions`, () =>
          HttpResponse.json([createVersion({ versionNo: 2, fileId: 102, current: true }), createVersion({ versionNo: 1, fileId: 101, current: false })]),
        ),
      ],
    })
    const menu = await openRowMenu(user, '주간 회의록.docx')
    await user.click(within(menu).getByRole('menuitem', { name: '버전 이력' }))
    expect(await screen.findByTestId('version-row-1')).toBeInTheDocument()
    expect(screen.queryByTestId('rollback-1')).not.toBeInTheDocument()
  })
})

describe('여러 개 선택', () => {
  const FOLDER = createFolder({ id: 10, name: '문서' })
  const FILE = createFile({ id: 20, name: 'memo.txt' })

  // 선택 개수 툴바, 해제하면 사라짐, 전체 선택/해제, 체크박스 접근 이름(#800).
  test('체크하면 툴바에 개수가 보이고, 전체 선택·해제와 체크박스 이름이 맞다', async () => {
    const { user } = await openDrive({ folders: [FOLDER], files: [FILE] })
    expect(screen.queryByTestId('bulk-toolbar')).not.toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: '문서 선택' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '전체 선택' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'memo.txt 선택' })).toBeInTheDocument()

    await user.click(screen.getByTestId('select-folder-10'))
    expect(screen.getByTestId('bulk-toolbar')).toHaveTextContent('선택 1개')
    await user.click(screen.getByTestId('select-file-20'))
    expect(screen.getByTestId('bulk-toolbar')).toHaveTextContent('선택 2개')
    await user.click(screen.getByTestId('bulk-clear'))
    expect(screen.queryByTestId('bulk-toolbar')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('select-all'))
    expect(screen.getByTestId('bulk-toolbar')).toHaveTextContent('선택 2개')
    expect(screen.getByTestId('select-folder-10')).toBeChecked()
    expect(screen.getByTestId('select-file-20')).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '전체 선택 해제' })).toBeInTheDocument()
    await user.click(screen.getByTestId('select-all'))
    expect(screen.queryByTestId('bulk-toolbar')).not.toBeInTheDocument()
  })

  // 벌크 삭제(확인 뒤 DELETE body)·이동(폴더 창 → PATCH items/move)·ZIP(POST download-zip) 이 선택한 id 를 보낸다.
  test('벌크 삭제·이동·ZIP 이 선택한 fileIds/folderIds 를 보낸다', async () => {
    const bodies: Record<string, unknown[]> = { delete: [], move: [], zip: [] }
    const { user } = await openDrive({ folders: [FOLDER], files: [FILE] }, {
      handlers: [
        http.delete(`${API}/spaces/${SPACE_ID}/items`, async ({ request }) => {
          bodies.delete.push(await request.json())
          return new HttpResponse(null, { status: 204 })
        }),
        http.patch(`${API}/spaces/${SPACE_ID}/items/move`, async ({ request }) => {
          bodies.move.push(await request.json())
          return new HttpResponse(null, { status: 204 })
        }),
        http.post(`${API}/spaces/${SPACE_ID}/download-zip`, async ({ request }) => {
          bodies.zip.push(await request.json())
          return new HttpResponse(new Blob(['zip']), { headers: { 'Content-Type': 'application/zip' } })
        }),
      ],
    })
    await user.click(await screen.findByTestId('select-folder-10'))
    await user.click(screen.getByTestId('select-file-20'))
    await user.click(screen.getByTestId('bulk-zip'))
    await waitFor(() => expect(bodies.zip).toEqual([{ fileIds: [20], folderIds: [10] }]))

    await user.click(screen.getByTestId('bulk-delete'))
    await screen.findByTestId('drive-confirm-dialog')
    await user.click(screen.getByTestId('drive-confirm-confirm'))
    await waitFor(() => expect(bodies.delete).toEqual([{ fileIds: [20], folderIds: [10] }]))

    // 삭제 뒤 선택이 풀렸으면 파일만 다시 골라 루트로 옮긴다.
    if (screen.queryByTestId('bulk-toolbar')) await user.click(screen.getByTestId('bulk-clear'))
    await user.click(await screen.findByTestId('select-file-20'))
    await user.click(screen.getByTestId('bulk-move'))
    const picker = await screen.findByTestId('folder-picker')
    await user.click(within(picker).getByTestId('folder-picker-confirm'))
    await waitFor(() => expect(bodies.move).toMatchObject([{ fileIds: [20], folderIds: [] }]))
  })

  // #588: 검색 결과에도 체크박스·전체 선택·벌크 툴바가 있고, 벌크 삭제 뒤 결과를 다시 불러 선택이 풀린다.
  test('검색 결과에서도 전체 선택·벌크 삭제가 되고 삭제 뒤 선택이 풀린다', async () => {
    const deletes: unknown[] = []
    const { user } = await openDrive({ folders: [FOLDER], files: [FILE] }, {
      handlers: [
        http.get(`${API}/spaces/${SPACE_ID}/search`, () =>
          HttpResponse.json({ folders: [{ ...FOLDER, folderPath: null }], files: [{ ...FILE, folderPath: null }] }),
        ),
        http.get(`${API}/search`, () => HttpResponse.json({ hits: [], semantic: false })),
        http.delete(`${API}/spaces/${SPACE_ID}/items`, async ({ request }) => {
          deletes.push(await request.json())
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    await user.click(screen.getByLabelText('파일명 및 콘텐츠 검색'))
    await user.paste('memo')
    const results = await screen.findByTestId('search-results')
    expect(await within(results).findByTestId('select-folder-10')).toBeInTheDocument()
    expect(within(results).getByTestId('select-file-20')).toBeInTheDocument()
    await user.click(screen.getByTestId('select-all'))
    expect(screen.getByTestId('bulk-toolbar')).toHaveTextContent('선택 2개')
    await user.click(screen.getByTestId('bulk-delete'))
    await screen.findByTestId('drive-confirm-dialog')
    await user.click(screen.getByTestId('drive-confirm-confirm'))
    await waitFor(() => expect(deletes).toEqual([{ fileIds: [20], folderIds: [10] }]))
    await waitFor(() => expect(screen.queryByTestId('bulk-toolbar')).not.toBeInTheDocument())
  })
})
