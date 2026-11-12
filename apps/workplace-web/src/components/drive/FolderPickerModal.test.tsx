// FolderPickerModal — 경로 표시(WP-530)·공간 이름 첫 단계·「폴더 없음」·저장 모드(WP-1526).
// 폴더 내용·공간 훅은 끊고 폴더 id 별 고정 목록을 돌려준다. Radix Select 는 userEvent 로 연다.
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { saveTargetSpaces } from '../../lib/driveSpaces'
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
