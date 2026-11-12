// FolderPickerModal — 경로 표시(WP-530)·공간 이름 첫 단계·「폴더 없음」·저장 모드(WP-1526).
// 폴더 내용·공간 훅은 끊고 폴더 id 별 고정 목록을 돌려준다. Radix Select 는 userEvent 로 연다.
import { QueryClient } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { saveTargetSpaces } from '../../lib/driveSpaces'
import { server } from '../../test/msw/server'
import { renderWithProviders } from '../../test/renderWithProviders'
import type { DriveSpace } from '../../types/drive'
import { FolderPickerModal } from './FolderPickerModal'

const tree: Record<string, { id: number; name: string }[]> = {
  root: [{ id: 1, name: '2026 마케팅 캠페인 기획 자료 모음' }],
  '1': [{ id: 2, name: '분기별 보고서' }],
  '2': [{ id: 3, name: '최종본' }],
  '3': [],
  '10': [{ id: 11, name: '보고서' }],
  '11': [],
}
let itemsError = false
vi.mock('../../hooks/queries/useDriveItems', () => ({
  useDriveItems: (_spaceId: number, folderId?: number) => ({
    data: itemsError ? undefined : { folders: tree[folderId == null ? 'root' : String(folderId)] ?? [], files: [] },
    isLoading: false,
    isError: itemsError,
  }),
}))

const SPACES: DriveSpace[] = [
  { id: 1, type: 'PERSONAL', name: 'u-123', ownerId: 1, role: 'OWNER', archived: false, createdAt: '' },
  { id: 5, type: 'TEAM', name: '마케팅팀', ownerId: 1, role: 'OWNER', archived: false, createdAt: '' },
]

// Radix Select 는 jsdom 에 없는 포인터 캡처·scrollIntoView 를 부른다 — 빈 구현으로 채운다.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})
beforeEach(() => {
  itemsError = false
})

const FILE = { fileName: '2026 3분기 매출 보고서.pdf', mimeType: 'application/pdf' }

describe('FolderPickerModal 이동/복사 모드', () => {
  const MOVE = { title: '이동할 위치', onClose: () => {} }

  it('들어간 폴더를 이름으로 보이고, 중간 단계로 돌아가 그 위치를 대상으로 확정한다', () => {
    const onConfirm = vi.fn()
    renderWithProviders(<FolderPickerModal spaceId={1} rootLabel="내 드라이브" onConfirm={onConfirm} {...MOVE} />)
    const path = () => screen.getByTestId('folder-picker-path')

    fireEvent.click(screen.getByRole('button', { name: '2026 마케팅 캠페인 기획 자료 모음' }))
    fireEvent.click(screen.getByRole('button', { name: '분기별 보고서' }))
    fireEvent.click(screen.getByRole('button', { name: '최종본' }))

    expect(path()).toHaveTextContent('내 드라이브/2026 마케팅 캠페인 기획 자료 모음/분기별 보고서/최종본')
    expect(path()).not.toHaveTextContent('폴더 3')
    expect(within(path()).getByText('최종본')).toHaveAttribute('aria-current', 'location')
    // 이동 모드는 제목·「여기로」 그대로, 저장 모드 요소 없음
    expect(screen.getByRole('heading', { name: '이동할 위치' })).toBeInTheDocument()
    expect(screen.getByTestId('folder-picker-confirm')).toHaveTextContent('여기로')
    expect(screen.queryByTestId('folder-picker-space-select')).not.toBeInTheDocument()
    expect(screen.queryByTestId('folder-picker-location')).not.toBeInTheDocument()
    // 빈 폴더 → 예전 문구 「하위 폴더 없음」(저장 모드만 「폴더 없음」)
    expect(screen.getByText('하위 폴더 없음')).toBeInTheDocument()

    fireEvent.click(within(path()).getByRole('button', { name: '분기별 보고서' }))
    expect(path()).not.toHaveTextContent('최종본')
    expect(screen.getByRole('button', { name: '최종본' })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('folder-picker-confirm'))
    // 두 번째 인자는 확정한 공간, 세 번째는 루트 → 대상 폴더 이름(저장 위치 토스트에 쓴다, WP-1525).
    expect(onConfirm).toHaveBeenCalledWith(2, 1, ['2026 마케팅 캠페인 기획 자료 모음', '분기별 보고서'])

    fireEvent.click(within(path()).getByTestId('folder-picker-space-root'))
    expect(screen.getByTestId('folder-picker-space-root')).toHaveAttribute('aria-current', 'location')
  })

  it('호출부가 넘긴 rootLabel 이 첫 단계 이름이다', () => {
    renderWithProviders(<FolderPickerModal spaceId={5} rootLabel="마케팅팀" onConfirm={() => {}} {...MOVE} />)
    expect(screen.getByTestId('folder-picker-path')).toHaveTextContent('마케팅팀')
  })

  it('rootLabel 을 안 넘기면 예전처럼 「루트」', () => {
    renderWithProviders(<FolderPickerModal spaceId={5} onConfirm={() => {}} {...MOVE} />)
    expect(screen.getByTestId('folder-picker-space-root')).toHaveTextContent('루트')
  })

  it('폴더 조회가 오류여도 이동·복사 모드는 경로를 유지한다', () => {
    const ui = <FolderPickerModal spaceId={1} onConfirm={() => {}} {...MOVE} />
    const view = renderWithProviders(ui)
    fireEvent.click(screen.getByRole('button', { name: '2026 마케팅 캠페인 기획 자료 모음' }))
    itemsError = true
    view.rerender(ui)
    expect(screen.getByTestId('folder-picker-path')).toHaveTextContent('2026 마케팅 캠페인 기획 자료 모음')
  })
})

describe('FolderPickerModal 저장 모드', () => {
  const renderSave = (spaces: DriveSpace[] = SPACES, extra: Record<string, unknown> = {}, onConfirm = vi.fn()) => {
    renderWithProviders(
      <FolderPickerModal
        spaceId={1}
        title="드라이브에 저장"
        save={{ ...FILE, spaces: saveTargetSpaces(spaces), ...extra }}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )
    return onConfirm
  }

  it('제목·파일 이름·위치 줄·확정 단추를 보인다', () => {
    renderSave()
    expect(screen.getByText('드라이브에 저장')).toBeInTheDocument()
    expect(screen.getByTestId('folder-picker-file')).toHaveTextContent('2026 3분기 매출 보고서.pdf')
    expect(screen.getByRole('button', { name: '여기에 저장' })).toBe(screen.getByTestId('folder-picker-confirm'))

    fireEvent.click(screen.getByRole('button', { name: '2026 마케팅 캠페인 기획 자료 모음' }))
    expect(screen.getByTestId('folder-picker-location').textContent?.replace(/\s/g, '')).toBe(
      '내드라이브›2026마케팅캠페인기획자료모음',
    )
  })

  it('빈 폴더에서 「폴더 없음」과 위치 줄을 함께 보인다', () => {
    renderSave(SPACES, { initialTrail: [{ id: 10, name: '보고서' }] })
    fireEvent.click(screen.getByRole('button', { name: '보고서' }))
    expect(screen.getByText('폴더 없음')).toBeInTheDocument()
    expect(screen.getByTestId('folder-picker-location')).toBeInTheDocument()
  })

  it('폴더에 들어가면 위치 줄이 「내 드라이브›보고서」', () => {
    renderSave(SPACES, { initialTrail: [{ id: 10, name: '보고서' }] })
    expect(screen.getByTestId('folder-picker-location').textContent?.replace(/\s/g, '')).toBe('내드라이브›보고서')
  })

  it('▾ 트리거가 현재 공간 이름을 읽어 준다', async () => {
    renderSave(SPACES)
    const trigger = screen.getByTestId('folder-picker-space-select')
    expect(trigger).toHaveTextContent('내 드라이브')
    // 값은 화면에 두 번 보이지 않게 sr-only 래퍼 안에 있어야 한다 — SelectValue 자체에 sr-only 를 주면
    // 트리거의 *:data-[slot=select-value]:flex 가 덮어 공간 이름이 ▾ 옆에 한 번 더 보였다(라이브 검증 결함).
    const value = trigger.querySelector('[data-slot="select-value"]')
    expect(value?.parentElement).toHaveClass('sr-only')
    expect(value?.parentElement).not.toBe(trigger)
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('option', { name: '마케팅팀' }))
    expect(screen.getByTestId('folder-picker-space-select')).toHaveTextContent('마케팅팀')
  })

  it('▾ 에서 공간을 바꾸면 경로가 비고 그 공간 루트로 확정한다', async () => {
    const onConfirm = renderSave(SPACES, { initialTrail: [{ id: 10, name: '보고서' }] })
    await userEvent.click(screen.getByTestId('folder-picker-space-select'))
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['내 드라이브', '마케팅팀'])
    expect(screen.getByText('개인')).toBeInTheDocument()
    expect(screen.getByText('팀 스페이스')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('option', { name: '마케팅팀' }))
    const path = screen.getByTestId('folder-picker-path')
    expect(path).toHaveTextContent('마케팅팀')
    expect(path).not.toHaveTextContent('보고서')
    expect(screen.getByTestId('folder-picker-space-root')).toHaveAttribute('aria-current', 'location')
    fireEvent.click(screen.getByTestId('folder-picker-confirm'))
    expect(onConfirm).toHaveBeenCalledWith(null, 5, [])
  })

  it('공간이 하나뿐이면 ▾ 가 없다', () => {
    renderSave([SPACES[0]])
    expect(screen.queryByTestId('folder-picker-space-select')).not.toBeInTheDocument()
  })

  it('initialTrail 이 있으면 그 폴더 안에서 열린다', () => {
    const onConfirm = renderSave(SPACES, { initialTrail: [{ id: 1, name: '2026 마케팅 캠페인 기획 자료 모음' }] })
    expect(screen.getByTestId('folder-picker-path')).toHaveTextContent('2026 마케팅 캠페인 기획 자료 모음')
    fireEvent.click(screen.getByTestId('folder-picker-confirm'))
    expect(onConfirm).toHaveBeenCalledWith(1, 1, ['2026 마케팅 캠페인 기획 자료 모음'])
  })

  it('폴더 조회가 오류면 루트로 돌아간다', () => {
    itemsError = true
    renderSave(SPACES, { initialTrail: [{ id: 1, name: '2026 마케팅 캠페인 기획 자료 모음' }] })
    expect(screen.getByTestId('folder-picker-space-root')).toHaveAttribute('aria-current', 'location')
  })
})

// WP-1527 — 폴더 선택 창의 「새 폴더」. 만들기 API 는 MSW 로, 목록 조회는 위 vi.mock 으로 끊어 둔다.
describe('FolderPickerModal 새 폴더', () => {
  const URL = '/api/v1/drive/spaces/1/folders'
  const MOVE = { title: '이동할 위치', onClose: () => {} }
  let posts: unknown[]

  /** 만들기 핸들러 — 요청 body 를 모으고 id 99 폴더를 돌려준다. respond 로 응답을 바꾼다(오류·지연). */
  const useCreate = (respond?: (body: { name: string; parentId?: number | null }) => Response | Promise<Response>) => {
    posts = []
    server.use(
      http.post(URL, async ({ request }) => {
        const body = (await request.json()) as { name: string; parentId?: number | null }
        posts.push(body)
        return respond ? respond(body) : HttpResponse.json({ id: 99, name: body.name, parentId: body.parentId ?? null })
      }),
    )
  }
  const open = async () => {
    await userEvent.click(screen.getByTestId('folder-picker-new'))
    return screen.getByTestId('folder-picker-new-input')
  }
  /** 이동 모드 렌더 — 새 폴더 버튼을 켜고 extra 로 prop 을 덮는다. */
  const renderMove = (extra: Record<string, unknown> = {}) =>
    renderWithProviders(<FolderPickerModal spaceId={1} canCreateFolder onConfirm={() => {}} {...MOVE} {...extra} />)
  /** 저장 위치 요약 글자(공백 제거). */
  const readText = (testId: string) => screen.getByTestId(testId).textContent?.replace(/\s/g, '')
  /** 만들기 응답을 붙잡아 두는 핸들러 — release() 로 풀면 id 99 폴더를 돌려준다. */
  const useGatedCreate = () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    useCreate(async (body) => {
      await gate
      return HttpResponse.json({ id: 99, name: body.name })
    })
    return () => release()
  }
  const renderSave = (onClose = vi.fn()) =>
    renderWithProviders(
      <FolderPickerModal
        spaceId={1}
        title="드라이브에 저장"
        save={{ ...FILE, spaces: saveTargetSpaces(SPACES) }}
        onConfirm={() => {}}
        onClose={onClose}
      />,
    )

  beforeEach(() => useCreate())

  it('새 폴더를 만들면 그 안으로 들어가고 목록 요청이 다시 간다', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    renderSave()
    fireEvent.click(screen.getByRole('button', { name: '2026 마케팅 캠페인 기획 자료 모음' }))
    const input = await open()
    await userEvent.type(input, '회의록{Enter}')

    await waitFor(() => expect(screen.queryByTestId('folder-picker-new-input')).not.toBeInTheDocument())
    expect(posts).toEqual([{ name: '회의록', parentId: 1 }])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['drive', 'items', 1] })
    expect(within(screen.getByTestId('folder-picker-path')).getByText('회의록')).toHaveAttribute('aria-current', 'location')
    expect(readText('folder-picker-location')).toBe('내드라이브›2026마케팅캠페인기획자료모음›회의록')
    invalidate.mockRestore()
  })

  it('저장 모드 루트에서 만들면 위치 요약이 「내 드라이브 › 회의록」', async () => {
    renderSave()
    await userEvent.type(await open(), '회의록{Enter}')
    await waitFor(() => expect(readText('folder-picker-location')).toBe('내드라이브›회의록'))
    expect(posts).toEqual([{ name: '회의록', parentId: null }])
  })

  it('같은 이름이면 서버 문구가 입력 줄 아래 보이고 입력과 창이 남는다', async () => {
    const msg = "같은 폴더에 이미 '회의록' 이름이 있습니다."
    useCreate(() => HttpResponse.json({ message: msg }, { status: 409 }))
    const onClose = vi.fn()
    renderMove({ onClose })
    const input = await open()
    await userEvent.type(input, '회의록{Enter}')

    expect(await screen.findByTestId('folder-picker-new-error')).toHaveTextContent(msg)
    expect(screen.getByTestId('folder-picker-new-error')).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('folder-picker-new-input')).toHaveValue('회의록')
    expect(screen.getByTestId('folder-picker')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.type(screen.getByTestId('folder-picker-new-input'), '2')
    expect(screen.queryByTestId('folder-picker-new-error')).not.toBeInTheDocument()
  })

  it('Esc 는 입력 줄만 닫고 창은 남는다, 닫힌 상태의 Esc 는 창을 닫는다', async () => {
    const onClose = vi.fn()
    renderMove({ onClose })
    await open()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('folder-picker-new-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('folder-picker')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it.each([
    ['조합 중(isComposing)', { isComposing: true }],
    ['keyCode 229(Safari 조합 확정)', { keyCode: 229 }],
  ])('%s Enter 는 만들지 않는다', async (_label, init) => {
    renderMove()
    const input = await open()
    fireEvent.change(input, { target: { value: '회의' } })
    fireEvent.keyDown(input, { key: 'Enter', ...init })
    await new Promise((r) => setTimeout(r, 30))
    expect(posts).toHaveLength(0)
    expect(screen.getByTestId('folder-picker-new-input')).toBeInTheDocument()
  })

  it('조합이 끝난 직후 따라오는 Enter 는 만들지 않는다 (macOS Chrome 꼬리 Enter)', async () => {
    renderMove()
    const input = await open()
    fireEvent.change(input, { target: { value: '회의' } })
    // 조합 Enter → compositionend → 조합 아닌 Enter 가 몇 ms 안에 연달아 온다
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 30))
    expect(posts).toHaveLength(0)
    // 꼬리 Enter 는 한 번만 거른다 — 다음 Enter 는 만든다
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(posts).toHaveLength(1))
  })

  it('공백 이름은 요청하지 않고 안내 문구를 보이며 입력 줄을 유지한다', async () => {
    renderMove()
    await userEvent.type(await open(), '   {Enter}')
    expect(await screen.findByTestId('folder-picker-new-error')).toHaveTextContent('폴더 이름을 입력해주세요.')
    expect(posts).toHaveLength(0)
    expect(screen.getByTestId('folder-picker-new-input')).toBeInTheDocument()
  })

  it('조합 중 Esc 는 입력 줄도 창도 닫지 않는다', async () => {
    const onClose = vi.fn()
    renderMove({ onClose })
    const input = await open()
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    expect(screen.getByTestId('folder-picker-new-input')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('실패 뒤에도 입력에 포커스가 남아 바로 고쳐 다시 만들 수 있다', async () => {
    useCreate(() => HttpResponse.json({ message: '중복' }, { status: 409 }))
    renderMove()
    const input = await open()
    await userEvent.type(input, '회의록{Enter}')
    await screen.findByTestId('folder-picker-new-error')
    expect(input).toHaveFocus()
  })

  it('오류가 남은 채 닫았다 다시 열면 이전 오류·이름이 비어 있다', async () => {
    useCreate(() => HttpResponse.json({ message: '중복' }, { status: 409 }))
    renderMove()
    await userEvent.type(await open(), '회의록{Enter}')
    await screen.findByTestId('folder-picker-new-error')
    await userEvent.keyboard('{Escape}')
    expect(await open()).toHaveValue('')
    expect(screen.queryByTestId('folder-picker-new-error')).not.toBeInTheDocument()
  })

  it('이동·복사 모드에서 canCreateFolder 를 생략하면 버튼이 없고, 저장 모드는 있다', () => {
    const view = renderWithProviders(<FolderPickerModal spaceId={1} onConfirm={() => {}} {...MOVE} />)
    expect(screen.queryByTestId('folder-picker-new')).not.toBeInTheDocument()
    view.unmount()
    renderSave()
    expect(screen.getByTestId('folder-picker-new')).toBeInTheDocument()
  })

  it('요청 중 다시 Enter 해도 한 번만 요청한다', async () => {
    const release = useGatedCreate()
    renderMove()
    const input = await open()
    fireEvent.change(input, { target: { value: '회의록' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('folder-picker-confirm')).toBeDisabled()
    // 요청 중 Esc 는 입력 줄도 창도 닫지 않는다
    await userEvent.keyboard('{Escape}')
    expect(screen.getByTestId('folder-picker-new-input')).toBeInTheDocument()
    expect(screen.getByTestId('folder-picker')).toBeInTheDocument()
    release()
    await waitFor(() => expect(screen.queryByTestId('folder-picker-new-input')).not.toBeInTheDocument())
    expect(posts).toHaveLength(1)
  })

  it('요청 중 다른 폴더를 눌러도 엉뚱한 곳으로 가지 않는다', async () => {
    const release = useGatedCreate()
    renderMove()
    const input = await open()
    fireEvent.change(input, { target: { value: '회의록' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(posts).toHaveLength(1))
    // 요청 중 폴더 행을 눌러도 위치가 바뀌지 않는다
    fireEvent.click(screen.getByRole('button', { name: '2026 마케팅 캠페인 기획 자료 모음' }))
    expect(screen.getByTestId('folder-picker-path')).not.toHaveTextContent('2026 마케팅')
    release()
    await waitFor(() => expect(screen.queryByTestId('folder-picker-new-input')).not.toBeInTheDocument())
    // 요청을 시작한 위치(루트) 아래 만든 폴더로만 들어간다
    expect(screen.getByTestId('folder-picker-path')).toHaveTextContent('루트/회의록')
  })

  it('다른 폴더로 들어가면 입력 줄이 닫힌다', async () => {
    renderMove()
    await userEvent.type(await open(), '임시')
    fireEvent.click(screen.getByRole('button', { name: '2026 마케팅 캠페인 기획 자료 모음' }))
    expect(screen.queryByTestId('folder-picker-new-input')).not.toBeInTheDocument()
    // 다시 열면 비어 있다
    expect(await open()).toHaveValue('')
  })

  it('입력 줄이 열려 있으면 버튼이 비활성이고 빈 목록 문구가 보이지 않는다', async () => {
    renderMove()
    fireEvent.click(screen.getByRole('button', { name: '2026 마케팅 캠페인 기획 자료 모음' }))
    fireEvent.click(screen.getByRole('button', { name: '분기별 보고서' }))
    fireEvent.click(screen.getByRole('button', { name: '최종본' }))
    expect(screen.getByText('하위 폴더 없음')).toBeInTheDocument()
    await open()
    expect(screen.queryByText('하위 폴더 없음')).not.toBeInTheDocument()
    expect(screen.getByTestId('folder-picker-new')).toBeDisabled()
  })

  it('canCreateFolder=false 면 버튼이 없다', () => {
    renderMove({ canCreateFolder: false })
    expect(screen.queryByTestId('folder-picker-new')).not.toBeInTheDocument()
  })

  it("mode='file' 이면 버튼이 없다", () => {
    renderWithProviders(<FolderPickerModal spaceId={1} mode="file" canCreateFolder {...MOVE} />)
    expect(screen.queryByTestId('folder-picker-new')).not.toBeInTheDocument()
  })

  it('만든 폴더 안에서도 disabledFolderId 규칙은 그대로다 — 이동 중인 폴더 자신은 들어갈 수 없다', async () => {
    renderMove({ disabledFolderId: 1 })
    expect(screen.getByRole('button', { name: '2026 마케팅 캠페인 기획 자료 모음' })).toBeDisabled()
    await userEvent.type(await open(), '회의록{Enter}')
    await waitFor(() => expect(screen.queryByTestId('folder-picker-new-input')).not.toBeInTheDocument())
    // 만든 폴더(99)는 disabledFolderId 가 아니므로 「여기로」가 활성
    expect(screen.getByTestId('folder-picker-confirm')).toBeEnabled()
  })
})
