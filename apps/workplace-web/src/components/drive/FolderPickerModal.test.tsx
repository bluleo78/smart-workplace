// FolderPickerModal 경로 표시(WP-530) — 들어간 폴더를 이름으로 보이고, 중간 단계로 돌아가며, 그 위치를 대상으로 확정한다.
// 폴더 내용 훅은 끊고 폴더 id 별 고정 목록을 돌려준다.
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../test/renderWithProviders'
import { FolderPickerModal } from './FolderPickerModal'

const tree: Record<string, { id: number; name: string }[]> = {
  root: [{ id: 1, name: '2026 마케팅 캠페인 기획 자료 모음' }],
  '1': [{ id: 2, name: '분기별 보고서' }],
  '2': [{ id: 3, name: '최종본' }],
  '3': [],
}
vi.mock('../../hooks/queries/useDriveItems', () => ({
  useDriveItems: (_spaceId: number, folderId?: number) => ({
    data: { folders: tree[folderId == null ? 'root' : String(folderId)], files: [] },
    isLoading: false,
  }),
}))

describe('FolderPickerModal 경로', () => {
  it('들어간 폴더를 이름으로 보이고, 중간 단계로 돌아가 그 위치를 대상으로 확정한다', () => {
    const onConfirm = vi.fn()
    renderWithProviders(
      <FolderPickerModal spaceId={1} title="이동할 위치" onConfirm={onConfirm} onClose={() => {}} />,
    )
    const path = () => screen.getByTestId('folder-picker-path')

    fireEvent.click(screen.getByRole('button', { name: '2026 마케팅 캠페인 기획 자료 모음' }))
    fireEvent.click(screen.getByRole('button', { name: '분기별 보고서' }))
    fireEvent.click(screen.getByRole('button', { name: '최종본' }))

    // 내부 id(「폴더 3」) 대신 이름 경로
    expect(path()).toHaveTextContent('루트/2026 마케팅 캠페인 기획 자료 모음/분기별 보고서/최종본')
    expect(path()).not.toHaveTextContent('폴더 3')
    expect(within(path()).getByText('최종본')).toHaveAttribute('aria-current', 'location')

    // 중간 단계(분기별 보고서)로 돌아가기 → 그 아래 목록이 다시 보이고, 확정 대상도 그 폴더
    fireEvent.click(within(path()).getByRole('button', { name: '분기별 보고서' }))
    expect(path()).not.toHaveTextContent('최종본')
    expect(screen.getByRole('button', { name: '최종본' })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('folder-picker-confirm'))
    expect(onConfirm).toHaveBeenCalledWith(2)

    // 루트로 돌아가기
    fireEvent.click(within(path()).getByRole('button', { name: '루트' }))
    expect(within(path()).getByText('루트')).toHaveAttribute('aria-current', 'location')
  })
})
