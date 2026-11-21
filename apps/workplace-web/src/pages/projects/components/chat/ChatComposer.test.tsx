// WP-1868 회귀 테스트 — 이슈 챗 입력창은 전송이 끝나면 "보낸 첨부만" 초안에서 빼야 한다.
// 전송이 대기 중인 동안 붙인 첨부까지 reset() 으로 지워지던 결함을 고정한다.
// 업로드(chatApi.uploadAttachments)는 모듈 mock 으로 대체하고, 개인 스페이스 조회 훅은 네트워크 없이 빈 결과로 끊는다.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { chatApi } from '@/api/chat'
import type { PendingFile } from '@/hooks/useAttachmentDraft'
import { renderWithProviders } from '@/test/renderWithProviders'

import { ChatComposer } from './ChatComposer'

vi.mock('@/hooks/queries/useDriveSpaces', () => ({
  useDriveSpaces: () => ({ data: undefined, isSuccess: false, isError: false }),
}))

vi.mock('@/api/chat', () => ({
  chatApi: { uploadAttachments: vi.fn() },
}))

/** 파일 이름마다 고유 fileId 를 주는 업로드 이중 — 즉시 완료한다. */
function mockUpload() {
  const ids: Record<string, number> = { 'a.txt': 101, 'b.txt': 102 }
  vi.mocked(chatApi.uploadAttachments).mockImplementation((async (_threadId: number, files: File[]) => ({
    data: files.map(
      (f): PendingFile => ({ fileId: ids[f.name], originalName: f.name, mimeType: 'text/plain', sizeBytes: 1 }),
    ),
  })) as never)
}

/** 숨은 파일 입력으로 파일을 붙인다(＋ 메뉴 경로와 같은 onFiles). */
function attach(name: string) {
  const input = screen.getByTestId('chat-composer-file-input')
  fireEvent.change(input, { target: { files: [new File(['x'], name, { type: 'text/plain' })] } })
}

describe('ChatComposer 첨부 초안 정리', () => {
  beforeEach(() => {
    mockUpload()
  })

  it('전송 중 붙인 첨부는 전송이 끝나도 남는다', async () => {
    let resolveSubmit: () => void = () => {}
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { resolveSubmit = resolve }))
    renderWithProviders(<ChatComposer threadId={1} members={[]} onSubmit={onSubmit} />)

    attach('a.txt')
    await screen.findByLabelText('a.txt 첨부 제거')
    fireEvent.click(screen.getByTestId('chat-composer-submit'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]).toEqual(['', [101], []])

    // 전송이 아직 풀리지 않은 사이에 B 를 붙인다.
    attach('b.txt')
    await screen.findByLabelText('b.txt 첨부 제거')

    resolveSubmit()
    await waitFor(() => expect(screen.queryByLabelText('a.txt 첨부 제거')).toBeNull())
    expect(screen.getByLabelText('b.txt 첨부 제거')).toBeTruthy()
  })

  it('전송 실패면 초안이 그대로 남는다', async () => {
    const onSubmit = vi.fn(() => Promise.reject(new Error('fail')))
    renderWithProviders(<ChatComposer threadId={1} members={[]} onSubmit={onSubmit} />)

    attach('a.txt')
    await screen.findByLabelText('a.txt 첨부 제거')
    fireEvent.click(screen.getByTestId('chat-composer-submit'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    // 거절이 처리될 마이크로태스크를 비운 뒤에도 칩이 남아야 한다(고정 대기 없이 결정적으로).
    await act(async () => {})
    expect(screen.getByLabelText('a.txt 첨부 제거')).toBeTruthy()
  })

  it('본문만 보낸 전송 중 붙인 첨부도 전송이 끝나도 남는다', async () => {
    let resolveSubmit: () => void = () => {}
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { resolveSubmit = resolve }))
    renderWithProviders(<ChatComposer threadId={1} members={[]} onSubmit={onSubmit} />)

    const user = userEvent.setup()
    await user.type(screen.getByTestId('chat-composer-input'), 'hello')
    fireEvent.click(screen.getByTestId('chat-composer-submit'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]).toEqual(['hello', [], []])

    attach('a.txt')
    await screen.findByLabelText('a.txt 첨부 제거')

    await act(async () => { resolveSubmit() })
    expect(screen.getByLabelText('a.txt 첨부 제거')).toBeTruthy()
  })
})
