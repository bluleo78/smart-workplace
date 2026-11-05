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
  // WP-1385: 공백만 넣은 비밀번호가 조용히 「비밀번호 없는 링크」로 만들어지지 않게 막는다.
  it('비밀번호에 공백만 넣으면 안내를 보이고 요청을 보내지 않는다', async () => {
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    await screen.findByTestId('share-link-item')

    fireEvent.change(screen.getByLabelText('비밀번호 (선택)'), { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('share-link-create-btn'))

    expect(await screen.findByTestId('share-password-error')).toHaveTextContent(
      '비밀번호에 공백만 넣을 수 없어요. 비밀번호를 입력하거나 칸을 비워 주세요.',
    )
    expect(screen.getByLabelText('비밀번호 (선택)')).toHaveAttribute('aria-invalid', 'true')
    expect(api.createShareLink).not.toHaveBeenCalled()

    // 글자를 넣어 고치면 안내가 사라진다
    fireEvent.change(screen.getByLabelText('비밀번호 (선택)'), { target: { value: ' pw ' } })
    expect(screen.queryByTestId('share-password-error')).toBeNull()
  })

  it('오류가 보이는 동안 다른 문제로 바꾸면 안내도 지금 값에 맞게 바뀐다', async () => {
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    await screen.findByTestId('share-link-item')
    const input = screen.getByLabelText('비밀번호 (선택)')

    fireEvent.change(input, { target: { value: 'a'.repeat(73) } })
    fireEvent.click(screen.getByTestId('share-link-create-btn'))
    expect(await screen.findByTestId('share-password-error')).toHaveTextContent('72바이트')

    // 한도 안이지만 안 보이는 문자(한글 채움 문자)만 — 지난 바이트 안내가 남지 않고 공백 안내로 바뀐다
    fireEvent.change(input, { target: { value: '\u3164' } })
    expect(screen.getByTestId('share-password-error')).toHaveTextContent('공백만 넣을 수 없어요')
    expect(api.createShareLink).not.toHaveBeenCalled()
  })

  it('생성 때 모든 칸을 함께 검사해 각 오류를 세우고, 고친 칸의 오류는 지운다', async () => {
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    await screen.findByTestId('share-link-item')

    // 공백만 비밀번호 + 지난 만료일 — 두 안내가 함께 뜬다(비밀번호만 보고 돌아가지 않는다)
    fireEvent.change(screen.getByLabelText('비밀번호 (선택)'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('만료일 (선택)'), { target: { value: '2020-01-01' } })
    fireEvent.click(screen.getByTestId('share-link-create-btn'))
    expect(await screen.findByTestId('share-password-error')).toHaveTextContent('공백만 넣을 수 없어요')
    expect(screen.getByTestId('share-expires-error')).toHaveTextContent('오늘 이후')

    // 비밀번호만 고치고 다시 누르면 비밀번호 오류는 지워지고 만료일 오류만 남는다
    fireEvent.change(screen.getByLabelText('비밀번호 (선택)'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByTestId('share-link-create-btn'))
    await waitFor(() => expect(screen.queryByTestId('share-password-error')).toBeNull())
    expect(screen.getByTestId('share-expires-error')).toBeInTheDocument()
    expect(api.createShareLink).not.toHaveBeenCalled()
  })

  it('비밀번호 칸을 비우면 비밀번호 없이 생성 요청을 보낸다', async () => {
    api.createShareLink.mockResolvedValue({
      id: 8, token: 'sl_x', audience: 'EXTERNAL', hasPassword: false, expiresAt: null,
    })
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    await screen.findByTestId('share-link-item')

    fireEvent.click(screen.getByTestId('share-link-create-btn'))

    await waitFor(() => expect(api.createShareLink).toHaveBeenCalledTimes(1))
    expect(api.createShareLink).toHaveBeenCalledWith(10, {
      audience: 'EXTERNAL', password: undefined, expiresAt: undefined,
    })
    expect(screen.queryByTestId('share-password-error')).toBeNull()
  })

  it('비밀번호를 넣으면 그대로 담아 보낸다', async () => {
    api.createShareLink.mockResolvedValue({
      id: 8, token: 'sl_x', audience: 'EXTERNAL', hasPassword: true, expiresAt: null,
    })
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    await screen.findByTestId('share-link-item')

    fireEvent.change(screen.getByLabelText('비밀번호 (선택)'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByTestId('share-link-create-btn'))

    await waitFor(() =>
      expect(api.createShareLink).toHaveBeenCalledWith(10, expect.objectContaining({ password: 'secret' })),
    )
  })
})
