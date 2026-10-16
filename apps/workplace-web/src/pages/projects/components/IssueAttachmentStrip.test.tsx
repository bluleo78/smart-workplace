// IssueAttachmentStrip 첨부 추가 권한 분기(WP-202) — 본문 편집 권한(canEditContent)이 있을 때만
// 드롭존·드라이브 링크 버튼(모바일은 「＋ 첨부」)을 보이고, 없으면 숨겨 403 을 미리 막는다.
// 실제 업로드 POST 배선은 E2E(open-issue-permissions: OPEN reporter 드롭존 업로드)가 맡는다(WP-413).
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { IssueAttachmentStrip } from './IssueAttachmentStrip'

// 데이터 훅·하위 목록은 끊는다 — 이 테스트의 관심사는 권한에 따른 버튼 노출뿐.
const useDriveSpaces = vi.fn()
vi.mock('@/hooks/queries/useDriveSpaces', () => ({ useDriveSpaces: (o: unknown) => useDriveSpaces(o) }))
vi.mock('@/hooks/queries/useIssueDriveLinks', () => ({ useAddIssueDriveLink: () => ({ mutate: vi.fn() }) }))
vi.mock('@/hooks/queries/useUploadIssueAttachments', () => ({
  useUploadIssueAttachments: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./IssueAttachmentList', () => ({ IssueAttachmentList: () => null }))
vi.mock('./useIssueAttachmentViewer', () => ({
  useIssueAttachmentViewer: () => ({ onPreview: vi.fn(), viewerNode: null }),
}))
let mobile = false
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile }))

function renderStrip(canEditContent: boolean) {
  return renderWithProviders(
    <IssueAttachmentStrip
      projectKey="OPNQA"
      number={1}
      attachmentCount={0}
      currentUserId={1}
      isOwner={false}
      canEditContent={canEditContent}
    />,
  )
}

describe('IssueAttachmentStrip — 첨부 추가 권한', () => {
  beforeEach(() => {
    mobile = false
    useDriveSpaces.mockReset()
    useDriveSpaces.mockReturnValue({
      isSuccess: true,
      isError: false,
      data: [{ id: 9, type: 'PERSONAL', name: '내 드라이브' }],
    })
  })

  it('편집 가능(멤버·OPEN reporter): 드롭존과 드라이브 링크 버튼을 보인다', () => {
    renderStrip(true)
    expect(screen.getByTestId('attachment-dropzone')).toBeInTheDocument()
    expect(screen.getByTestId('issue-drive-link-add-btn')).toBeEnabled()
    expect(useDriveSpaces).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
  })

  it('편집 불가 열람자: 첨부 스트립은 있지만 드롭존·드라이브 링크 버튼이 없고, 스페이스 조회도 하지 않는다', () => {
    renderStrip(false)
    expect(screen.getByTestId('issue-attachment-strip')).toBeInTheDocument()
    expect(screen.queryByTestId('attachment-dropzone')).not.toBeInTheDocument()
    expect(screen.queryByTestId('issue-drive-link-add-btn')).not.toBeInTheDocument()
    // 버튼이 숨겨지는 열람자는 불필요한 요청·실패 토스트를 피하려 스페이스 조회를 끈다.
    expect(useDriveSpaces).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  })

  it('모바일: 편집 가능하면 「＋ 첨부」 버튼, 편집 불가면 없음 (WP-196)', () => {
    mobile = true
    const { unmount } = renderStrip(true)
    expect(screen.getByTestId('mobile-attach-add')).toBeInTheDocument()
    expect(screen.queryByTestId('attachment-dropzone')).not.toBeInTheDocument()
    unmount()

    renderStrip(false)
    expect(screen.queryByTestId('mobile-attach-add')).not.toBeInTheDocument()
  })
})
