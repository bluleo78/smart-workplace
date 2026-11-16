// ShareLinkModal 화면 분기 — API 모듈은 끊고 화면만 본다.
// - 보관 공간(WP-527): 생성 폼·「+ 새 링크 만들기」 대신 안내, 기존 링크 복사·폐기는 남긴다. 목록 조회 실패는 안내 + 폼.
// - 링크 목록 먼저(WP-1528): 살아 있는 링크는 URL·[복사]·[폐기] 카드, 새 링크는 「+ 새 링크 만들기」로 그 자리에 폼을 펼친다.
//   링크가 없으면 폼이 바로 보이고, 폐기·만료 링크는 「지난 링크 n개」로 접힌다. 예전(토큰 없는) 링크는 URL 대신 안내.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ShareTargetRef } from '../../api/drive'
import { renderWithProviders } from '../../test/renderWithProviders'
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

const fileTarget: ShareTargetRef = { kind: 'file', id: 10, name: 'report.txt' }
const folderTarget: ShareTargetRef = { kind: 'folder', id: 20, name: '견적' }
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
    renderWithProviders(<ShareLinkModal target={fileTarget} archived onClose={() => {}} />)

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
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
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
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
    expect(await screen.findByTestId('share-link-form')).toBeInTheDocument()
    expect(screen.getByTestId('share-link-create-btn')).toBeEnabled()
    expect(screen.queryByTestId('share-link-form-cancel')).toBeNull()
    expect(screen.queryByTestId('share-link-new-btn')).toBeNull()
    expect(screen.queryByTestId('share-link-past-toggle')).toBeNull()
  })

  it('폐기한 링크만 있으면 폼이 바로 보이고 지난 링크는 접혀 있다가 펼치면 복사 없이 보인다', async () => {
    api.listShareLinks.mockResolvedValue([{ ...activeLink, revoked: true, active: false, token: null }])
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
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
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
    fireEvent.click(await screen.findByTestId('share-link-past-toggle'))
    expect(screen.getByTestId('share-link-past-item')).toHaveTextContent('만료됨')
    expect(screen.getAllByTestId('share-link-item')).toHaveLength(1)
  })

  it('예전에 만든(토큰 없는) 링크는 URL 칸 대신 안내를 보이고 폐기할 수 있다', async () => {
    api.listShareLinks.mockResolvedValue([{ ...activeLink, token: null }])
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
    const item = await screen.findByTestId('share-link-item')
    expect(within(item).getByTestId('share-link-legacy-notice')).toHaveTextContent('예전에 만든 링크라 URL을 다시 볼 수 없습니다.')
    expect(within(item).queryByRole('textbox')).toBeNull()
    expect(within(item).queryByTestId('share-link-copy-btn')).toBeNull()

    fireEvent.click(within(item).getByTestId('share-link-revoke-btn'))
    await waitFor(() => expect(api.revokeShareLink).toHaveBeenCalledWith(7))
  })

  it('비밀번호 링크는 「비밀번호」 배지로 보이고 예전 표기·이모지는 없다', async () => {
    api.listShareLinks.mockResolvedValue([{ ...activeLink, hasPassword: true }])
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
    const item = await screen.findByTestId('share-link-item')
    expect(within(item).getByText('비밀번호')).toBeInTheDocument()
    expect(item.textContent).not.toContain('비번')
    expect(item.textContent).not.toContain('🔒')
  })

  it('파일 이름이 제목 아래 보이고 「지금만 확인」 안내는 없다', async () => {
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
    const name = screen.getByTestId('share-link-file-name')
    expect(name).toHaveTextContent('report.txt')
    expect(name).not.toHaveClass('sr-only')
    await screen.findByTestId('share-link-item')
    expect(screen.queryByText(/이 URL은 지금만/)).toBeNull()
  })

  it('기존 링크 목록 조회가 실패하면 비어 보이게 두지 않고 안내하고 폼을 연다', async () => {
    api.listShareLinks.mockRejectedValue(new Error('403'))
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
    expect(await screen.findByTestId('share-link-list-error')).toHaveTextContent('기존 링크를 불러오지 못했습니다')
    expect(screen.queryByTestId('share-link-list')).toBeNull()
    expect(screen.getByTestId('share-link-form')).toBeInTheDocument()
  })

  // 목록 조회가 계속 실패해도 링크를 만들면 새 링크가 살아 있으므로 폼은 닫혀야 한다(listFailed 가 폼을 붙잡지 않음).
  it('목록 조회가 실패한 채 링크를 만들면 폼이 닫히고 새 링크가 강조돼 보인다', async () => {
    api.listShareLinks.mockRejectedValue(new Error('403'))
    api.createShareLink.mockResolvedValue({ ...activeLink, id: 9, token: 'sl_new', hasPassword: false })
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
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
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
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
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
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
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
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
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
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
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
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
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
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
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
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
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
    await openForm()

    fireEvent.click(screen.getByTestId('share-link-create-btn'))

    await waitFor(() => expect(api.createShareLink).toHaveBeenCalledTimes(1))
    expect(api.createShareLink).toHaveBeenCalledWith({ kind: 'file', id: 10 }, {
      audience: 'EXTERNAL', password: undefined, expiresAt: undefined,
    })
    expect(screen.queryByTestId('share-password-error')).toBeNull()
  })

  it('비밀번호를 넣으면 그대로 담아 보낸다', async () => {
    api.createShareLink.mockResolvedValue({ ...activeLink, id: 8, token: 'sl_x', hasPassword: true })
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
    await openForm()

    fireEvent.change(screen.getByLabelText('비밀번호 (선택)'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByTestId('share-link-create-btn'))

    await waitFor(() =>
      expect(api.createShareLink).toHaveBeenCalledWith({ kind: 'file', id: 10 }, expect.objectContaining({ password: 'secret' })),
    )
  })
})

// WP-1538 — 폴더 대상: 폴더 이름·아이콘, 외부 경고, 만료 30일 기본값(웹 전용, 만지기 전까지만 따라간다).
describe('ShareLinkModal — 폴더 대상', () => {
  const WARNING = '링크를 가진 누구나 이 폴더와 하위 폴더를 볼 수 있습니다. 나중에 넣는 파일도 함께 보입니다.'
  const INTERNAL_NOTICE = '같은 워크스페이스 직원이 로그인해서 엽니다. 하위 폴더와 나중에 넣은 파일도 보입니다.'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 13, 9, 0, 0))
    api.listShareLinks.mockResolvedValue([])
  })
  afterEach(() => vi.useRealTimers())

  const expiry = () => screen.getByLabelText('만료일 (선택)') as HTMLInputElement

  it('folder: shows folder name with folder icon', async () => {
    renderWithProviders(<ShareLinkModal target={folderTarget} onClose={() => {}} />)
    expect(await screen.findByText('견적')).toBeTruthy()
    expect(screen.getByTestId('share-target-folder-icon')).toBeTruthy()
    expect(api.listShareLinks).toHaveBeenCalledWith({ kind: 'folder', id: 20 })
  })

  it('folder external: warning + expiry prefilled 30d', async () => {
    renderWithProviders(<ShareLinkModal target={folderTarget} onClose={() => {}} />)
    await screen.findByTestId('share-link-form')
    expect(screen.getByTestId('share-folder-external-warning').textContent).toBe(WARNING)
    expect(screen.getByTestId('share-folder-external-warning').getAttribute('role')).toBeNull()
    expect(expiry().value).toBe('2026-12-13')
    expect(screen.getByText('외부 폴더 링크는 30일 뒤로 미리 채웁니다.')).toBeTruthy()
  })

  it('clearing expiry sends no expiresAt', async () => {
    api.createShareLink.mockResolvedValue({ ...activeLink, id: 9, token: 'sl_new' })
    renderWithProviders(<ShareLinkModal target={folderTarget} onClose={() => {}} />)
    await screen.findByTestId('share-link-form')
    fireEvent.change(expiry(), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('share-link-create-btn'))
    await waitFor(() => expect(api.createShareLink).toHaveBeenCalledTimes(1))
    expect(api.createShareLink).toHaveBeenCalledWith({ kind: 'folder', id: 20 }, {
      audience: 'EXTERNAL', password: undefined, expiresAt: undefined,
    })
  })

  it('untouched default is sent as an ISO expiresAt', async () => {
    api.createShareLink.mockResolvedValue({ ...activeLink, id: 9, token: 'sl_new' })
    renderWithProviders(<ShareLinkModal target={folderTarget} onClose={() => {}} />)
    await screen.findByTestId('share-link-form')
    fireEvent.click(screen.getByTestId('share-link-create-btn'))
    await waitFor(() => expect(api.createShareLink).toHaveBeenCalledTimes(1))
    const body = api.createShareLink.mock.calls[0][1]
    expect(body.expiresAt).toBe(new Date('2026-12-13T23:59:59').toISOString())
  })

  it('internal: warning gone, internal notice, expiry empty', async () => {
    renderWithProviders(<ShareLinkModal target={folderTarget} onClose={() => {}} />)
    await screen.findByTestId('share-link-form')
    fireEvent.click(screen.getByLabelText('사내 전용'))
    expect(screen.queryByTestId('share-folder-external-warning')).toBeNull()
    expect(screen.getByTestId('share-folder-internal-notice').textContent).toBe(INTERNAL_NOTICE)
    expect(expiry().value).toBe('')
  })

  it('back to external refills when untouched', async () => {
    renderWithProviders(<ShareLinkModal target={folderTarget} onClose={() => {}} />)
    await screen.findByTestId('share-link-form')
    fireEvent.click(screen.getByLabelText('사내 전용'))
    fireEvent.click(screen.getByLabelText(/^외부/))
    expect(expiry().value).toBe('2026-12-13')
  })

  it('touched expiry survives audience switch', async () => {
    renderWithProviders(<ShareLinkModal target={folderTarget} onClose={() => {}} />)
    await screen.findByTestId('share-link-form')
    fireEvent.change(expiry(), { target: { value: '2027-01-05' } })
    fireEvent.click(screen.getByLabelText('사내 전용'))
    expect(expiry().value).toBe('2027-01-05')
  })

  it('file target has no expiry default (regression)', async () => {
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
    await screen.findByTestId('share-link-form')
    expect(expiry().value).toBe('')
    expect(screen.queryByTestId('share-folder-external-warning')).toBeNull()
    expect(screen.queryByTestId('share-target-folder-icon')).toBeNull()
  })
})

// WP-1624 — 생성 폼의 비밀번호 칸에서 Enter 는 「링크 생성」 단추를 누른 것과 같다.
// 한글 조합 Enter 는 글자 확정용이라 제출하지 않고, 요청이 나가 있는 동안엔 Enter 를 몇 번 눌러도 링크를 하나만 만든다.
describe('Enter 로 생성 (WP-1624)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 링크가 없으면 폼이 바로 보인다.
    api.listShareLinks.mockResolvedValue([])
    clip.copyToClipboard.mockResolvedValue(true)
  })

  const created = { ...activeLink, id: 8, token: 'sl_x' }
  const passwordInput = () => document.getElementById('share-password') as HTMLInputElement
  const expiresInput = () => document.getElementById('share-expires') as HTMLInputElement

  /** 링크가 없는 파일의 창을 띄워 생성 폼이 보일 때까지 기다린다. */
  async function renderForm() {
    renderWithProviders(<ShareLinkModal target={fileTarget} onClose={() => {}} />)
    await screen.findByTestId('share-link-form')
  }

  /** 「일어나지 않음」 확인 — 요청이 나갔다면 들어갈 만큼 한 틱 기다린 뒤 생성 요청이 없음을 본다. */
  async function expectNoCreate() {
    await new Promise((r) => setTimeout(r, 0))
    expect(api.createShareLink).not.toHaveBeenCalled()
  }

  it('비밀번호 칸 Enter 는 링크 생성과 같다', async () => {
    api.createShareLink.mockResolvedValue(created)
    await renderForm()

    fireEvent.change(passwordInput(), { target: { value: 'pw47Test!' } })
    fireEvent.keyDown(passwordInput(), { key: 'Enter' })

    await waitFor(() => expect(api.createShareLink).toHaveBeenCalledTimes(1))
    expect(api.createShareLink).toHaveBeenCalledWith({ kind: 'file', id: 10 }, {
      audience: 'EXTERNAL', password: 'pw47Test!', expiresAt: undefined,
    })
  })

  // 날짜를 다 넣기 전엔 값이 비어 올라와, Enter 가 만료 없는 링크를 만들 수 있다 — 만료일 칸 Enter 는 만들지 않는다.
  it('만료일 칸 Enter 는 링크를 만들지 않는다', async () => {
    await renderForm()

    fireEvent.keyDown(expiresInput(), { key: 'Enter' })

    await expectNoCreate()
  })

  it('공백만 비밀번호는 Enter 해도 만들지 않고 오류를 보인다', async () => {
    await renderForm()

    fireEvent.change(passwordInput(), { target: { value: '   ' } })
    fireEvent.keyDown(passwordInput(), { key: 'Enter' })

    expect(await screen.findByTestId('share-password-error')).toHaveTextContent('공백만 넣을 수 없어요')
    expect(api.createShareLink).not.toHaveBeenCalled()
  })

  it('한글 조합 중 Enter 는 만들지 않는다', async () => {
    await renderForm()

    fireEvent.change(passwordInput(), { target: { value: '비밀' } })
    fireEvent.keyDown(passwordInput(), { key: 'Enter', isComposing: true, keyCode: 229 })

    await expectNoCreate()
  })

  it('처리 중 같은 틱 Enter 두 번은 한 번만 만들고, 실패하면 다시 Enter 로 만들 수 있다', async () => {
    const first = deferred<typeof created>()
    api.createShareLink.mockReturnValueOnce(first.promise)
    await renderForm()

    const el = passwordInput()
    // fireEvent 는 매번 다시 그려 두 번째 Enter 가 isPending 에 막히므로, 같은 틱에 직접 보낸다.
    act(() => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await waitFor(() => expect(api.createShareLink).toHaveBeenCalledTimes(1))

    // 처리 중 Enter 는 다시 그린 뒤에도 만들지 않는다.
    fireEvent.keyDown(el, { key: 'Enter' })
    expect(api.createShareLink).toHaveBeenCalledTimes(1)

    // 요청이 실패하면 막이 풀려 다시 Enter 로 요청이 나간다.
    api.createShareLink.mockResolvedValueOnce(created)
    await act(async () => {
      first.reject(new Error('500'))
      await first.promise.catch(() => {})
    })
    await waitFor(() => expect(screen.getByTestId('share-link-create-btn')).toBeEnabled())
    fireEvent.keyDown(el, { key: 'Enter' })
    await waitFor(() => expect(api.createShareLink).toHaveBeenCalledTimes(2))
  })
})

// WP-1625 — 만료일을 덜 넣은 채(예: '2026-12-' 까지만) 「링크 생성」을 누르면 만료 없는 링크가 만들어졌다.
// <input type="date"> 는 덜 넣은 날짜를 값 '' 로 올려 「비움」과 같아 보이므로, 입력 요소의 validity.badInput 을 직접 읽어 막는다.
// jsdom 은 덜 넣은 날짜를 칠 수 없어, 입력 요소의 validity 를 badInput: true 로 덮어 흉내 낸다(실제 Chromium 은 라이브 검증).
describe('덜 넣은 만료일 (WP-1625)', () => {
  const MESSAGE = '만료일을 끝까지 입력하거나 칸을 비워 주세요.'

  beforeEach(() => {
    vi.clearAllMocks()
    // 링크가 없으면 폼이 바로 보인다.
    api.listShareLinks.mockResolvedValue([])
    clip.copyToClipboard.mockResolvedValue(true)
  })

  const expiresInput = () => screen.getByLabelText('만료일 (선택)') as HTMLInputElement
  const passwordInput = () => screen.getByLabelText('비밀번호 (선택)') as HTMLInputElement

  /** 입력 요소가 「덜 넣은 날짜」라고 답하게 덮는다 — 값은 건드리지 않는다(실제로도 '' 로 올라온다). */
  function markIncomplete(input: HTMLInputElement) {
    Object.defineProperty(input, 'validity', {
      configurable: true,
      value: { badInput: true, valid: false },
    })
  }

  async function renderForm(target: ShareTargetRef) {
    renderWithProviders(<ShareLinkModal target={target} onClose={() => {}} />)
    await screen.findByTestId('share-link-form')
  }

  /** 안내가 서고 칸이 오류 표시이며 요청이 나가지 않았음을 본다. */
  async function expectBlocked() {
    expect(await screen.findByTestId('share-expires-error')).toHaveTextContent(MESSAGE)
    expect(expiresInput()).toHaveAttribute('aria-invalid', 'true')
    // 요청이 나갔다면 들어갈 만큼 한 틱 기다린 뒤 없음을 본다.
    await new Promise((r) => setTimeout(r, 0))
    expect(api.createShareLink).not.toHaveBeenCalled()
  }

  // Review Focus 1 — 빈 칸에서 일부만 친 경우: 값은 '' 그대로라 change 이벤트가 없다.
  it('빈 칸에서 덜 넣고(이벤트 없음) 생성을 누르면 안내를 보이고 요청을 보내지 않는다', async () => {
    await renderForm(fileTarget)

    markIncomplete(expiresInput())
    fireEvent.click(screen.getByTestId('share-link-create-btn'))

    await expectBlocked()
  })

  // Review Focus 2 — 미리 채운 기본 만료(폴더 외부)를 고치다 덜 지운 경우: 값 '' + badInput.
  it('미리 채운 만료일을 고치다 덜 지운 채 생성을 누르면 링크를 만들지 않는다', async () => {
    await renderForm(folderTarget)
    expect(expiresInput().value).not.toBe('')

    fireEvent.change(expiresInput(), { target: { value: '' } })
    markIncomplete(expiresInput())
    fireEvent.click(screen.getByTestId('share-link-create-btn'))

    await expectBlocked()
  })

  // Review Focus 3 — 칸을 완전히 비운 경우(badInput 아님)는 지금처럼 만료 없이 만든다.
  it('칸을 완전히 비우면 지금처럼 만료 없는 링크를 만든다', async () => {
    api.createShareLink.mockResolvedValue({ ...activeLink, id: 9, token: 'sl_new' })
    await renderForm(folderTarget)

    fireEvent.change(expiresInput(), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('share-link-create-btn'))

    await waitFor(() => expect(api.createShareLink).toHaveBeenCalledTimes(1))
    expect(api.createShareLink).toHaveBeenCalledWith({ kind: 'folder', id: 20 }, {
      audience: 'EXTERNAL', password: undefined, expiresAt: undefined,
    })
    expect(screen.queryByTestId('share-expires-error')).toBeNull()
  })

  // Review Focus 4 — 비밀번호 오류와 함께: 두 안내가 함께 서고 요청은 없다(모든 칸을 함께 검사).
  it('비밀번호 오류와 함께 있으면 두 안내가 함께 서고 요청은 없다', async () => {
    await renderForm(fileTarget)

    fireEvent.change(passwordInput(), { target: { value: '   ' } })
    markIncomplete(expiresInput())
    fireEvent.click(screen.getByTestId('share-link-create-btn'))

    expect(await screen.findByTestId('share-password-error')).toHaveTextContent('공백만 넣을 수 없어요')
    expect(screen.getByTestId('share-expires-error')).toHaveTextContent(MESSAGE)
    expect(api.createShareLink).not.toHaveBeenCalled()
  })

  // Review Focus 5 — 비밀번호 칸 Enter(WP-1624)도 onCreate 하나를 지나므로 같이 막힌다.
  it('비밀번호 칸 Enter 로 생성할 때도 덜 넣은 만료일이면 만들지 않는다', async () => {
    await renderForm(fileTarget)

    fireEvent.change(passwordInput(), { target: { value: 'pw47Test!' } })
    markIncomplete(expiresInput())
    fireEvent.keyDown(passwordInput(), { key: 'Enter' })

    await expectBlocked()
  })

  it('칸을 고치면 안내가 사라지고, 덜 넣은 상태가 풀리면 다시 눌러 만들 수 있다', async () => {
    api.createShareLink.mockResolvedValue({ ...activeLink, id: 9, token: 'sl_new' })
    await renderForm(fileTarget)

    markIncomplete(expiresInput())
    fireEvent.click(screen.getByTestId('share-link-create-btn'))
    expect(await screen.findByTestId('share-expires-error')).toBeInTheDocument()

    // 날짜를 끝까지 넣어 고친다 — 안내가 사라지고, 다시 누르면 그 날짜로 요청이 나간다.
    Object.defineProperty(expiresInput(), 'validity', { configurable: true, value: { badInput: false, valid: true } })
    fireEvent.change(expiresInput(), { target: { value: '2099-12-31' } })
    expect(screen.queryByTestId('share-expires-error')).toBeNull()
    fireEvent.click(screen.getByTestId('share-link-create-btn'))

    await waitFor(() => expect(api.createShareLink).toHaveBeenCalledTimes(1))
    expect(api.createShareLink.mock.calls[0][1].expiresAt).toBe(new Date('2099-12-31T23:59:59').toISOString())
  })

  /** 덜 넣은 상태를 풀어 「비움」으로 되돌린다 — 값은 계속 '' 라 change 이벤트가 없다. */
  function clearIncomplete(input: HTMLInputElement) {
    Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: false, valid: true } })
  }

  // 안내대로 덜 넣은 날짜를 지워 칸을 비우면 값은 '' 그대로라 change 가 오지 않는다 — keyUp 에서 다시 확인해 안내를 거둔다.
  it('덜 넣은 날짜를 지워 비우면(change 없음) keyUp 에서 안내와 오류 표시가 사라진다', async () => {
    await renderForm(fileTarget)
    markIncomplete(expiresInput())
    fireEvent.click(screen.getByTestId('share-link-create-btn'))
    expect(await screen.findByTestId('share-expires-error')).toBeInTheDocument()

    clearIncomplete(expiresInput())
    fireEvent.keyUp(expiresInput(), { key: 'Backspace' })

    expect(screen.queryByTestId('share-expires-error')).toBeNull()
    expect(expiresInput()).not.toHaveAttribute('aria-invalid', 'true')
  })

  // 같은 확인을 칸을 벗어날 때(blur)도 한다 — 마우스로 지우고 다른 곳을 누른 경우.
  it('덜 넣은 날짜를 지우고 칸을 벗어나면(blur) 안내가 사라지고, 아직 덜 넣었으면 남는다', async () => {
    await renderForm(fileTarget)
    markIncomplete(expiresInput())
    fireEvent.click(screen.getByTestId('share-link-create-btn'))
    expect(await screen.findByTestId('share-expires-error')).toBeInTheDocument()

    // 아직 덜 넣은 채 벗어나면 안내는 남는다
    fireEvent.blur(expiresInput())
    expect(screen.getByTestId('share-expires-error')).toBeInTheDocument()

    clearIncomplete(expiresInput())
    fireEvent.blur(expiresInput())
    expect(screen.queryByTestId('share-expires-error')).toBeNull()
  })

  // 다른 안내(지난 날짜 등)는 keyUp·blur 가 건드리지 않는다 — 덜 넣은 안내만 거둔다.
  it('지난 만료일 안내는 keyUp 으로 지워지지 않는다', async () => {
    await renderForm(fileTarget)
    fireEvent.change(expiresInput(), { target: { value: '2020-01-01' } })
    fireEvent.click(screen.getByTestId('share-link-create-btn'))
    expect(await screen.findByTestId('share-expires-error')).toHaveTextContent('오늘 이후')

    fireEvent.keyUp(expiresInput(), { key: 'Shift' })
    expect(screen.getByTestId('share-expires-error')).toHaveTextContent('오늘 이후')
  })

  // 사내 전용 폴더는 기본값이 '' 이고 덜 넣으면 change 가 없어 touched 가 false 로 남는다 — 키를 누른 것을 사용자의 손길로 센다.
  it('사내 전용 폴더에서 덜 넣은 뒤 외부로 바꿔도 만료일 칸을 기본값으로 덮지 않는다', async () => {
    await renderForm(folderTarget)
    fireEvent.click(screen.getByLabelText('사내 전용'))
    expect(expiresInput().value).toBe('')

    fireEvent.keyDown(expiresInput(), { key: '1' })
    markIncomplete(expiresInput())
    fireEvent.click(screen.getByLabelText(/^외부/))

    expect(expiresInput().value).toBe('')
    // 만졌으니 기본값 안내도 보이지 않는다
    expect(screen.queryByText('외부 폴더 링크는 30일 뒤로 미리 채웁니다.')).toBeNull()
  })
})
