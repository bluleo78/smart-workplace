// IssueAttachmentStrip 첨부 추가 권한 분기(WP-202) — 본문 편집 권한(canEditContent)이 있을 때만
// 드롭존·드라이브 링크 버튼(모바일은 「＋ 첨부」)을 보이고, 없으면 숨겨 403 을 미리 막는다.
// 실제 업로드 POST 배선은 E2E(open-issue-permissions: OPEN reporter 드롭존 업로드)가 맡는다(WP-413).
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { IssueAttachmentStrip } from './IssueAttachmentStrip'

// 데이터 훅·하위 목록은 끊는다 — 이 테스트의 관심사는 권한에 따른 버튼 노출뿐.
const useDriveSpaces = vi.fn()
vi.mock('@/hooks/queries/useDriveSpaces', () => ({ useDriveSpaces: (o: unknown) => useDriveSpaces(o) }))
vi.mock('@/hooks/queries/useIssueDriveLinks', () => ({ useAddIssueDriveLink: () => ({ mutate: vi.fn() }) }))
const { uploadMutate, uploadState, toastInfo } = vi.hoisted(() => ({ uploadMutate: vi.fn(), uploadState: { isPending: false }, toastInfo: vi.fn() }))
vi.mock('@/hooks/queries/useUploadIssueAttachments', () => ({
  useUploadIssueAttachments: () => ({ mutate: uploadMutate, isPending: uploadState.isPending }),
}))
vi.mock('sonner', () => ({ toast: { info: toastInfo, error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('./IssueAttachmentList', () => ({ IssueAttachmentList: () => null }))
vi.mock('./useIssueAttachmentViewer', () => ({
  useIssueAttachmentViewer: () => ({ onPreview: vi.fn(), viewerNode: null }),
}))
let mobile = false
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile }))

function renderStrip(canEditContent: boolean, attachmentCount = 0) {
  return renderWithProviders(
    <IssueAttachmentStrip
      projectKey="OPNQA"
      number={1}
      attachmentCount={attachmentCount}
      currentUserId={1}
      isOwner={false}
      canEditContent={canEditContent}
    />,
  )
}

describe('IssueAttachmentStrip — 첨부 추가 권한', () => {
  beforeEach(() => {
    mobile = false
    uploadState.isPending = false
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

describe('IssueAttachmentStrip — 한도 20 표시(WP-2118)', () => {
  beforeEach(() => {
    mobile = false
    uploadState.isPending = false
    useDriveSpaces.mockReset()
    useDriveSpaces.mockReturnValue({ isSuccess: true, isError: false, data: [] })
  })

  it('편집 가능하면 0개여도 「첨부 0/20」, 열람자는 0개면 안 보인다', () => {
    const { unmount } = renderStrip(true, 0)
    expect(screen.getByText('첨부')).toBeInTheDocument()
    expect(screen.getByText('0/20')).toBeInTheDocument()
    unmount()
    renderStrip(false, 0)
    expect(screen.queryByText('0/20')).not.toBeInTheDocument()
  })

  it('드롭존: 15개면 「· 5개 남음」, 14개면 없음', () => {
    const { unmount } = renderStrip(true, 15)
    expect(screen.getByTestId('attachment-dropzone')).toHaveTextContent('· 5개 남음')
    unmount()
    renderStrip(true, 14)
    expect(screen.getByTestId('attachment-dropzone')).not.toHaveTextContent('남음')
  })

  it('20개면 「한도 도달 · 최대 20개」이고 클릭해도 파일 입력이 열리지 않는다', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    renderStrip(true, 20)
    const zone = screen.getByTestId('attachment-dropzone')
    expect(zone).toHaveTextContent('한도 도달 · 최대 20개')
    await userEvent.click(zone)
    expect(click).not.toHaveBeenCalled()
    click.mockRestore()
  })
})

describe('IssueAttachmentStrip — 모바일 한도 표시(WP-2118)', () => {
  beforeEach(() => {
    mobile = true
    uploadState.isPending = false
    useDriveSpaces.mockReset()
    useDriveSpaces.mockReturnValue({ isSuccess: true, isError: false, data: [] })
  })

  it('15개면 「· 5개 남음」, 14개면 없음', () => {
    const { unmount } = renderStrip(true, 15)
    expect(screen.getByTestId('mobile-attach-limit')).toHaveTextContent('· 5개 남음')
    unmount()
    renderStrip(true, 14)
    expect(screen.queryByTestId('mobile-attach-limit')).not.toBeInTheDocument()
  })

  it('20개면 「한도 도달 · 최대 20개」', () => {
    renderStrip(true, 20)
    expect(screen.getByTestId('mobile-attach-limit')).toHaveTextContent('한도 도달 · 최대 20개')
  })

  it('편집 불가 열람자는 안 보인다', () => {
    renderStrip(false, 20)
    expect(screen.queryByTestId('mobile-attach-limit')).not.toBeInTheDocument()
  })
})

describe('IssueAttachmentStrip — 모바일 업로드 중 파일 선택(WP-2118)', () => {
  beforeEach(() => {
    mobile = true
    uploadState.isPending = false
    uploadMutate.mockClear()
    toastInfo.mockClear()
    useDriveSpaces.mockReturnValue({ isSuccess: true, isError: false, data: [] })
  })

  it('업로드 중 고른 파일은 말없이 버리지 않고 안내 토스트를 띄운다', () => {
    uploadState.isPending = true
    renderStrip(true, 3)
    fireEvent.change(screen.getByTestId('mobile-attach-input'), { target: { files: [new File(['x'], 'a.log')] } })
    expect(uploadMutate).not.toHaveBeenCalled()
    expect(toastInfo).toHaveBeenCalledTimes(1)
  })

  it('업로드 중에는 시트에서 「파일」 항목이 빠지고, 아니면 보인다', async () => {
    useDriveSpaces.mockReturnValue({ isSuccess: true, isError: false, data: [{ id: 1, type: 'PERSONAL' }] })
    uploadState.isPending = true
    const { unmount } = renderStrip(true, 3)
    await userEvent.setup().click(screen.getByTestId('mobile-attach-add'))
    expect(screen.getByText('드라이브에서 링크')).toBeInTheDocument()
    expect(screen.queryByText('파일')).not.toBeInTheDocument()
    unmount()
    uploadState.isPending = false
    renderStrip(true, 3)
    await userEvent.setup().click(screen.getByTestId('mobile-attach-add'))
    expect(screen.getByText('파일')).toBeInTheDocument()
  })

  it('평소에는 업로드한다', () => {
    uploadState.isPending = false
    renderStrip(true, 3)
    fireEvent.change(screen.getByTestId('mobile-attach-input'), { target: { files: [new File(['x'], 'a.log')] } })
    expect(uploadMutate).toHaveBeenCalledTimes(1)
    expect(toastInfo).not.toHaveBeenCalled()
  })
})
