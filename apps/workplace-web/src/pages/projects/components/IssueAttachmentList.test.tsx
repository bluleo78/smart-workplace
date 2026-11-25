// 이슈 드라이브 링크 제거 확인창(WP-1871 리뷰 후속)·업로드 첨부 삭제 확인창(WP-1919) — 여러 개여도 확인창에서 어느 파일을 빼거나 지우는지 다시 확인할 수 있다.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'
import type { IssueAttachment } from '@/types/attachment'
import type { DriveLink } from '@/types/drive'

import { IssueAttachmentList } from './IssueAttachmentList'

/** 테스트용 드라이브 링크 — ACTIVE 상태 기본값에 필요한 필드만 덮어쓴다. */
function makeLink(driveFileId: number, name: string): DriveLink {
  return {
    driveFileId,
    fileId: driveFileId + 100,
    name,
    mimeType: 'application/octet-stream',
    sizeBytes: 1024,
    hasThumbnail: false,
    spaceId: 1,
    spaceName: '팀 공간',
    availability: 'ACTIVE',
    createdById: 1,
    createdAt: '2026-01-01T00:00:00Z',
  }
}

// 데이터 훅은 끊는다 — 이 테스트의 관심사는 확인창이 고른 링크를 보여 주는지와 그 링크로 제거하는지뿐.
// vi.mock 이 파일 맨 위로 끌어올려지므로 목 함수도 vi.hoisted 로 함께 올린다.
// 업로드 첨부 목록은 테스트별로 바꿀 수 있게 hoisted 값으로 둔다(기본 빈 목록).
const { removeMutate, deleteMutate, attachmentsData } = vi.hoisted(() => ({
  removeMutate: vi.fn(),
  deleteMutate: vi.fn(),
  attachmentsData: { current: [] as IssueAttachment[] },
}))
vi.mock('@/hooks/queries/useIssueAttachments', () => ({
  useIssueAttachments: () => ({ isLoading: false, data: attachmentsData.current }),
}))
vi.mock('@/hooks/queries/useDeleteIssueAttachment', () => ({ useDeleteIssueAttachment: () => ({ mutate: deleteMutate }) }))
vi.mock('@/hooks/queries/useIssueDriveLinks', () => ({
  useIssueDriveLinks: () => ({ isLoading: false, data: [makeLink(11, '회의록.docx'), makeLink(12, '예산.xlsx')] }),
  useRemoveIssueDriveLink: () => ({ mutate: removeMutate }),
}))

describe('IssueAttachmentList — 드라이브 링크 제거 확인창', () => {
  beforeEach(() => {
    removeMutate.mockClear()
    // 첨부 목록은 다른 describe 가 채운다 — 순서와 상관없이 이 묶음은 첨부 없이 시작한다.
    attachmentsData.current = []
  })

  it('× 를 누른 링크의 파일 이름을 확인창 설명에 넣고, 제거하면 그 링크를 뺀다', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <IssueAttachmentList projectKey="LNK" number={1} currentUserId={1} isOwner={false} onPreview={vi.fn()} driveLinksOnly />,
    )

    await user.click(screen.getByRole('button', { name: '예산.xlsx 드라이브 링크 제거' }))
    const dialog = screen.getByTestId('drive-link-remove-dialog')
    expect(within(dialog).getByText(/「예산\.xlsx」/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/회의록\.docx/)).not.toBeInTheDocument()

    await user.click(within(dialog).getByTestId('drive-link-remove-confirm'))
    expect(removeMutate).toHaveBeenCalledWith(12)
  })
})

/** 테스트용 업로드 첨부 — 작성자는 현재 사용자(1)로 둔다. */
function makeAttachment(fileId: number, originalName: string): IssueAttachment {
  return {
    fileId,
    issueId: 1,
    originalName,
    mimeType: 'application/octet-stream',
    sizeBytes: 1024,
    attachedById: 1,
    attachedByName: '나',
    attachedAt: '2026-01-01T00:00:00Z',
  }
}

describe('IssueAttachmentList — 첨부 삭제 확인창', () => {
  beforeEach(() => {
    deleteMutate.mockClear()
    attachmentsData.current = [makeAttachment(21, '회의록.pdf'), makeAttachment(22, '예산.xlsx')]
  })

  it('× 를 누른 첨부의 파일 이름을 확인창 설명에 넣고, 삭제하면 그 첨부만 지운다(WP-1919)', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <IssueAttachmentList projectKey="LNK" number={1} currentUserId={1} isOwner={false} onPreview={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: '예산.xlsx 삭제' }))
    const dialog = screen.getByTestId('attachment-delete-dialog')
    expect(within(dialog).getByText(/「예산\.xlsx」/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/회의록/)).not.toBeInTheDocument()

    await user.click(within(dialog).getByTestId('attachment-delete-confirm'))
    expect(deleteMutate).toHaveBeenCalledWith(22)
  })

  it('취소하면 삭제하지 않는다', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <IssueAttachmentList projectKey="LNK" number={1} currentUserId={1} isOwner={false} onPreview={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: '예산.xlsx 삭제' }))
    await user.click(within(screen.getByTestId('attachment-delete-dialog')).getByRole('button', { name: '취소' }))
    expect(deleteMutate).not.toHaveBeenCalled()
  })
})

describe('IssueAttachmentList — strip 접기(WP-2118)', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => makeAttachment(100 + i, `file-${i}.txt`))
  const chips = () => screen.getByTestId('attachment-list').querySelectorAll('li').length
  const renderStrip = () =>
    renderWithProviders(
      <IssueAttachmentList projectKey="LNK" number={1} currentUserId={1} isOwner={false} layout="strip" onPreview={vi.fn()} />,
    )

  it('13개면 칩 12개 + 「1개 더 보기」, 누르면 13개 + 「접기」, 다시 누르면 12개', async () => {
    attachmentsData.current = many(13)
    const user = userEvent.setup()
    renderStrip()
    expect(chips()).toBe(12)
    expect(screen.getByRole('button', { name: '1개 더 보기' })).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: '1개 더 보기' }))
    expect(chips()).toBe(13)
    const fold = screen.getByRole('button', { name: '접기' })
    expect(fold).toHaveAttribute('aria-expanded', 'true')
    expect(fold).toHaveAttribute('aria-controls', screen.getByTestId('attachment-list').id)
    await user.click(fold)
    expect(chips()).toBe(12)
  })

  it('펼친 뒤 11개로 줄었다가 14개가 되면 접힌 상태로 12개 + 「2개 더 보기」', async () => {
    attachmentsData.current = many(13)
    const user = userEvent.setup()
    const { rerender } = renderStrip()
    await user.click(screen.getByRole('button', { name: '1개 더 보기' }))
    expect(chips()).toBe(13)
    attachmentsData.current = many(11)
    rerender(<IssueAttachmentList projectKey="LNK" number={1} currentUserId={1} isOwner={false} layout="strip" onPreview={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /더 보기|접기/ })).not.toBeInTheDocument()
    attachmentsData.current = many(14)
    rerender(<IssueAttachmentList projectKey="LNK" number={1} currentUserId={1} isOwner={false} layout="strip" onPreview={vi.fn()} />)
    expect(chips()).toBe(12)
    expect(screen.getByRole('button', { name: '2개 더 보기' })).toBeInTheDocument()
  })

  it('12개면 단추가 없다', () => {
    attachmentsData.current = many(12)
    renderStrip()
    expect(chips()).toBe(12)
    expect(screen.queryByRole('button', { name: /더 보기|접기/ })).not.toBeInTheDocument()
  })
})
