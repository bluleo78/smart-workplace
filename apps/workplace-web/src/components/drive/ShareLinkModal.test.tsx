// ShareLinkModal 보관 공간 분기(WP-527) — 보관 공간에선 생성 폼 대신 안내를 보이고, 기존 링크 확인·폐기는 남긴다.
// 목록 조회가 실패하면 「없음」처럼 비워 두지 않고 안내한다. API 모듈은 끊고 화면 분기만 본다.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../test/renderWithProviders'
import type { DriveFile } from '../../types/drive'
import { ShareLinkModal } from './ShareLinkModal'

const api = vi.hoisted(() => ({
  listShareLinks: vi.fn(),
  revokeShareLink: vi.fn(),
  createShareLink: vi.fn(),
}))
vi.mock('@/api/drive', () => ({
  ...api,
  shareLandingUrl: (t: string) => `/s/${t}`,
}))

const file = { id: 10, name: 'report.txt' } as DriveFile
const activeLink = {
  id: 7,
  audience: 'EXTERNAL',
  expiresAt: null,
  hasPassword: false,
  revoked: false,
  createdAt: '2026-10-19T00:00:00Z',
}

describe('ShareLinkModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listShareLinks.mockResolvedValue([activeLink])
    api.revokeShareLink.mockResolvedValue(undefined)
  })

  it('보관 공간이면 생성 폼 대신 안내를 보이고 기존 링크는 폐기할 수 있다', async () => {
    renderWithProviders(<ShareLinkModal file={file} archived onClose={() => {}} />)

    expect(screen.getByTestId('share-link-archived-notice')).toHaveTextContent('새 링크를 만들 수 없습니다')
    expect(screen.queryByTestId('share-link-create-btn')).toBeNull()
    expect(screen.queryByLabelText('비밀번호 (선택)')).toBeNull()

    await screen.findByTestId('share-link-item')
    api.listShareLinks.mockResolvedValue([{ ...activeLink, revoked: true }])
    fireEvent.click(screen.getByTestId('share-link-revoke-btn'))
    await waitFor(() => expect(api.revokeShareLink).toHaveBeenCalledWith(7))
    expect(await screen.findByText('폐기됨')).toBeInTheDocument()
  })

  it('보관 공간이 아니면 생성 폼이 그대로 보인다', async () => {
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    expect(screen.getByTestId('share-link-create-btn')).toBeEnabled()
    expect(screen.queryByTestId('share-link-archived-notice')).toBeNull()
    await screen.findByTestId('share-link-item')
  })

  it('기존 링크 목록 조회가 실패하면 비어 보이게 두지 않고 안내한다', async () => {
    api.listShareLinks.mockRejectedValue(new Error('403'))
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    expect(await screen.findByTestId('share-link-list-error')).toHaveTextContent('기존 링크를 불러오지 못했습니다')
    expect(screen.queryByTestId('share-link-list')).toBeNull()
  })
})
