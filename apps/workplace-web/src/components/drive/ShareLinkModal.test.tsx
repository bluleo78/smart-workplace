// ShareLinkModal 화면 분기 — API 모듈은 끊고 화면만 본다.
// - 보관 공간(WP-527): 생성 폼·「+ 새 링크 만들기」 대신 안내, 기존 링크 복사·폐기는 남긴다. 목록 조회 실패는 안내 + 폼.
// - 링크 목록 먼저(WP-1528): 살아 있는 링크는 URL·[복사]·[폐기] 카드, 새 링크는 「+ 새 링크 만들기」로 그 자리에 폼을 펼친다.
//   링크가 없으면 폼이 바로 보이고, 폐기·만료 링크는 「지난 링크 n개」로 접힌다. 예전(토큰 없는) 링크는 URL 대신 안내.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
const clip = vi.hoisted(() => ({ copyToClipboard: vi.fn() }))
vi.mock('@/lib/copyToClipboard', () => clip)
const apiError = vi.hoisted(() => ({ handleApiError: vi.fn() }))
vi.mock('@/lib/api-error', () => apiError)

/** 손으로 풀고 거절하는 약속 — 응답 도착 순서를 테스트가 정한다. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const file = { id: 10, name: 'report.txt' } as DriveFile
const activeLink = {
  id: 7,
  audience: 'EXTERNAL',
  expiresAt: null,
  hasPassword: false,
  revoked: false,
  active: true,
  createdAt: '2026-10-19T00:00:00Z',
  createdBy: 2,
  token: 'sl_a',
  createdByName: '양동희',
}

/** 「+ 새 링크 만들기」로 생성 폼을 연다 — 살아 있는 링크가 있으면 폼은 접혀 있다. */
async function openForm() {
  fireEvent.click(await screen.findByTestId('share-link-new-btn'))
  await screen.findByTestId('share-link-form')
}

describe('ShareLinkModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listShareLinks.mockResolvedValue([activeLink])
    api.revokeShareLink.mockResolvedValue(undefined)
    clip.copyToClipboard.mockResolvedValue(true)
  })

  it('보관 공간이면 생성 폼·새 링크 단추 대신 안내를 보이고 기존 링크는 복사·폐기할 수 있다', async () => {
    renderWithProviders(<ShareLinkModal file={file} archived onClose={() => {}} />)

    expect(screen.getByTestId('share-link-archived-notice')).toHaveTextContent('새 링크를 만들 수 없습니다')
    expect(screen.queryByTestId('share-link-create-btn')).toBeNull()
    expect(screen.queryByLabelText('비밀번호 (선택)')).toBeNull()

    await screen.findByTestId('share-link-item')
    expect(screen.queryByTestId('share-link-new-btn')).toBeNull()

    fireEvent.click(screen.getByTestId('share-link-copy-btn'))
    // 실패 문구는 넘기지 않는다 — copyToClipboard 의 공용 실패 안내(직접 선택해 복사)를 쓴다.
    await waitFor(() => expect(clip.copyToClipboard).toHaveBeenCalledWith('/s/sl_a', { success: '링크를 복사했습니다' }))

    api.listShareLinks.mockResolvedValue([{ ...activeLink, revoked: true, active: false, token: null }])
    fireEvent.click(screen.getByTestId('share-link-revoke-btn'))
    await waitFor(() => expect(api.revokeShareLink).toHaveBeenCalledWith(7))
    // 폐기한 링크는 「지난 링크」로 옮겨 가고, 보관 공간이라 폼은 여전히 없다
    expect(await screen.findByTestId('share-link-past-toggle')).toHaveTextContent('지난 링크 1개 (폐기·만료)')
    expect(screen.queryByTestId('share-link-item')).toBeNull()
    expect(screen.queryByTestId('share-link-form')).toBeNull()
  })

  it('살아 있는 링크가 있으면 URL·[복사] 카드가 먼저 보이고 폼은 「+ 새 링크 만들기」로 연다', async () => {
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    const item = await screen.findByTestId('share-link-item')
    expect(within(item).getByRole('textbox', { name: '공유 링크 URL' })).toHaveValue('/s/sl_a')
    expect(within(item).getByRole('button', { name: '공유 링크 복사' })).toHaveTextContent('복사')
    expect(item).toHaveTextContent('양동희')
    expect(item).toHaveTextContent('만료 없음')
    expect(screen.queryByTestId('share-link-create-btn')).toBeNull()
    expect(screen.queryByTestId('share-link-archived-notice')).toBeNull()

    await openForm()
    expect(screen.getByTestId('share-link-form')).toHaveTextContent('새 링크')
    expect(screen.getByTestId('share-link-create-btn')).toBeEnabled()
    expect(screen.queryByTestId('share-link-new-btn')).toBeNull()

    fireEvent.click(screen.getByTestId('share-link-form-cancel'))
    expect(screen.queryByTestId('share-link-form')).toBeNull()
    expect(screen.getByTestId('share-link-new-btn')).toHaveTextContent('+ 새 링크 만들기')
  })

  it('링크가 없으면 폼이 바로 보이고 폼 [취소]·「+ 새 링크 만들기」는 없다', async () => {
    api.listShareLinks.mockResolvedValue([])
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    expect(await screen.findByTestId('share-link-form')).toBeInTheDocument()
    expect(screen.getByTestId('share-link-create-btn')).toBeEnabled()
    expect(screen.queryByTestId('share-link-form-cancel')).toBeNull()
    expect(screen.queryByTestId('share-link-new-btn')).toBeNull()
    expect(screen.queryByTestId('share-link-past-toggle')).toBeNull()
  })

  it('폐기한 링크만 있으면 폼이 바로 보이고 지난 링크는 접혀 있다가 펼치면 복사 없이 보인다', async () => {
    api.listShareLinks.mockResolvedValue([{ ...activeLink, revoked: true, active: false, token: null }])
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    expect(await screen.findByTestId('share-link-form')).toBeInTheDocument()
    const toggle = screen.getByTestId('share-link-past-toggle')
    expect(toggle).toHaveTextContent('지난 링크 1개 (폐기·만료)')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('share-link-past-item')).toBeNull()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const past = screen.getByTestId('share-link-past-item')
    expect(past).toHaveTextContent('폐기됨')
    expect(within(past).queryByRole('button', { name: '공유 링크 복사' })).toBeNull()
    expect(within(past).queryByRole('textbox')).toBeNull()
    expect(within(past).queryByTestId('share-link-revoke-btn')).toBeNull()
  })

  it('만료된 링크는 지난 링크에 「만료됨」으로 보인다', async () => {
    api.listShareLinks.mockResolvedValue([activeLink, { ...activeLink, id: 8, expiresAt: '2020-01-01T00:00:00Z', active: false, token: null }])
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    fireEvent.click(await screen.findByTestId('share-link-past-toggle'))
    expect(screen.getByTestId('share-link-past-item')).toHaveTextContent('만료됨')
    expect(screen.getAllByTestId('share-link-item')).toHaveLength(1)
  })

  it('예전에 만든(토큰 없는) 링크는 URL 칸 대신 안내를 보이고 폐기할 수 있다', async () => {
    api.listShareLinks.mockResolvedValue([{ ...activeLink, token: null }])
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    const item = await screen.findByTestId('share-link-item')
    expect(within(item).getByTestId('share-link-legacy-notice')).toHaveTextContent('예전에 만든 링크라 URL을 다시 볼 수 없습니다.')
    expect(within(item).queryByRole('textbox')).toBeNull()
    expect(within(item).queryByTestId('share-link-copy-btn')).toBeNull()

    fireEvent.click(within(item).getByTestId('share-link-revoke-btn'))
    await waitFor(() => expect(api.revokeShareLink).toHaveBeenCalledWith(7))
  })

  it('비밀번호 링크는 「비밀번호」 배지로 보이고 예전 표기·이모지는 없다', async () => {
    api.listShareLinks.mockResolvedValue([{ ...activeLink, hasPassword: true }])
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    const item = await screen.findByTestId('share-link-item')
    expect(within(item).getByText('비밀번호')).toBeInTheDocument()
    expect(item.textContent).not.toContain('비번')
    expect(item.textContent).not.toContain('🔒')
  })

  it('파일 이름이 제목 아래 보이고 「지금만 확인」 안내는 없다', async () => {
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    const name = screen.getByTestId('share-link-file-name')
    expect(name).toHaveTextContent('report.txt')
    expect(name).not.toHaveClass('sr-only')
    await screen.findByTestId('share-link-item')
    expect(screen.queryByText(/이 URL은 지금만/)).toBeNull()
  })

  it('기존 링크 목록 조회가 실패하면 비어 보이게 두지 않고 안내하고 폼을 연다', async () => {
    api.listShareLinks.mockRejectedValue(new Error('403'))
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    expect(await screen.findByTestId('share-link-list-error')).toHaveTextContent('기존 링크를 불러오지 못했습니다')
    expect(screen.queryByTestId('share-link-list')).toBeNull()
    expect(screen.getByTestId('share-link-form')).toBeInTheDocument()
  })

  // 목록 조회가 계속 실패해도 링크를 만들면 새 링크가 살아 있으므로 폼은 닫혀야 한다(listFailed 가 폼을 붙잡지 않음).
  it('목록 조회가 실패한 채 링크를 만들면 폼이 닫히고 새 링크가 강조돼 보인다', async () => {
    api.listShareLinks.mockRejectedValue(new Error('403'))
    api.createShareLink.mockResolvedValue({ ...activeLink, id: 9, token: 'sl_new', hasPassword: false })
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    await screen.findByTestId('share-link-list-error')
    fireEvent.click(screen.getByTestId('share-link-create-btn'))

    await waitFor(() => expect(screen.queryByTestId('share-link-create-btn')).toBeNull())
    const items = screen.getAllByTestId('share-link-item')
    expect(items[0]).toHaveAttribute('data-highlighted', 'true')
    expect(screen.getByTestId('share-link-new-btn')).toHaveTextContent('+ 새 링크 만들기')
    // 서버 목록은 여전히 못 받았으니 안내는 남는다(만든 링크만 보이는 것이지 기존 링크가 없는 게 아니다).
    expect(screen.getByTestId('share-link-list-error')).toBeInTheDocument()
  })

  // 코드 리뷰: 폐기 요청이 성공하면 재조회를 기다리지 않고 그 카드를 바로 「지난 링크」로 옮긴다(복사 단추도 사라짐).
  it('폐기에 성공하면 재조회 전에도 그 링크가 바로 지난 링크로 옮겨 간다', async () => {
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    await screen.findByTestId('share-link-item')
    api.listShareLinks.mockReturnValue(new Promise(() => {})) // 재조회는 끝나지 않는다

    fireEvent.click(screen.getByTestId('share-link-revoke-btn'))
    expect(await screen.findByTestId('share-link-past-toggle')).toHaveTextContent('지난 링크 1개 (폐기·만료)')
    expect(screen.queryByTestId('share-link-item')).toBeNull()
    expect(screen.queryByTestId('share-link-copy-btn')).toBeNull()
    expect(apiError.handleApiError).not.toHaveBeenCalled()
  })

  // 코드 리뷰: 폐기는 성공했는데 재조회만 실패하면 「폐기 실패」라고 말하지 않는다 — 링크는 실제로 끊겼다.
  it('폐기 뒤 재조회만 실패하면 폐기 실패 안내 없이 지난 링크로 옮긴다', async () => {
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    await screen.findByTestId('share-link-item')
    api.listShareLinks.mockRejectedValue(new Error('500'))

    fireEvent.click(screen.getByTestId('share-link-revoke-btn'))
    await waitFor(() => expect(api.listShareLinks).toHaveBeenCalledTimes(2))
    expect(await screen.findByTestId('share-link-past-toggle')).toBeInTheDocument()
    expect(screen.queryByTestId('share-link-item')).toBeNull()
    expect(apiError.handleApiError).not.toHaveBeenCalled()
  })

  it('폐기 요청 자체가 실패하면 폐기 실패 안내를 보이고 링크는 살아 있는 채로 둔다', async () => {
    api.revokeShareLink.mockRejectedValue(new Error('500'))
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    await screen.findByTestId('share-link-item')

    fireEvent.click(screen.getByTestId('share-link-revoke-btn'))
    await waitFor(() => expect(apiError.handleApiError).toHaveBeenCalledWith(expect.any(Error), '공유 링크 폐기에 실패했습니다.'))
    expect(screen.getByTestId('share-link-item')).toBeInTheDocument()
    expect(screen.queryByTestId('share-link-past-toggle')).toBeNull()
  })

  // 코드 리뷰: 폐기 재조회와 생성 재조회가 겹칠 때, 먼저 보낸(오래된) 응답이 늦게 와도 새 응답을 덮지 않는다
  // (생성 뒤 재조회가 앞선 재조회를 대신한다 — 늦게 온 앞선 응답은 버려진다).
  it('겹친 재조회에서 늦게 도착한 오래된 응답은 새 목록을 덮지 않는다', async () => {
    const other = { ...activeLink, id: 8, token: 'sl_b' }
    api.listShareLinks.mockResolvedValueOnce([activeLink, other])
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    await waitFor(() => expect(screen.getAllByTestId('share-link-item')).toHaveLength(2))

    // ① 폐기 → 재조회 A(늦게 도착, 새 링크가 없는 예전 목록)
    const older = deferred<unknown[]>()
    api.listShareLinks.mockReturnValueOnce(older.promise)
    fireEvent.click(screen.getAllByTestId('share-link-revoke-btn')[0])
    await waitFor(() => expect(api.listShareLinks).toHaveBeenCalledTimes(2))

    // ② 생성 → 재조회 B(먼저 도착, 새 링크 포함)
    const newer = deferred<unknown[]>()
    api.listShareLinks.mockReturnValueOnce(newer.promise)
    api.createShareLink.mockResolvedValue({ ...activeLink, id: 9, token: 'sl_new', hasPassword: false })
    await openForm()
    fireEvent.click(screen.getByTestId('share-link-create-btn'))
    await waitFor(() => expect(api.listShareLinks).toHaveBeenCalledTimes(3))

    const revoked = { ...activeLink, revoked: true, active: false, token: null }
    newer.resolve([{ ...activeLink, id: 9, token: 'sl_new' }, revoked, other])
    await waitFor(() => expect(screen.getAllByTestId('share-link-item')).toHaveLength(2))
    older.resolve([revoked, other])
    await older.promise
    await new Promise((r) => setTimeout(r, 0))

    const urls = screen.getAllByRole('textbox', { name: '공유 링크 URL' }).map((el) => (el as HTMLInputElement).value)
    expect(urls).toEqual(['/s/sl_new', '/s/sl_b'])
  })

  // WP-1385: 공백만 넣은 비밀번호가 조용히 「비밀번호 없는 링크」로 만들어지지 않게 막는다.
  it('비밀번호에 공백만 넣으면 안내를 보이고 요청을 보내지 않는다', async () => {
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    await openForm()

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
    await openForm()
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
    await openForm()

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
    api.createShareLink.mockResolvedValue({ ...activeLink, id: 8, token: 'sl_x', hasPassword: false })
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    await openForm()

    fireEvent.click(screen.getByTestId('share-link-create-btn'))

    await waitFor(() => expect(api.createShareLink).toHaveBeenCalledTimes(1))
    expect(api.createShareLink).toHaveBeenCalledWith(10, {
      audience: 'EXTERNAL', password: undefined, expiresAt: undefined,
    })
    expect(screen.queryByTestId('share-password-error')).toBeNull()
  })

  it('비밀번호를 넣으면 그대로 담아 보낸다', async () => {
    api.createShareLink.mockResolvedValue({ ...activeLink, id: 8, token: 'sl_x', hasPassword: true })
    renderWithProviders(<ShareLinkModal file={file} onClose={() => {}} />)
    await openForm()

    fireEvent.change(screen.getByLabelText('비밀번호 (선택)'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByTestId('share-link-create-btn'))

    await waitFor(() =>
      expect(api.createShareLink).toHaveBeenCalledWith(10, expect.objectContaining({ password: 'secret' })),
    )
  })
})
