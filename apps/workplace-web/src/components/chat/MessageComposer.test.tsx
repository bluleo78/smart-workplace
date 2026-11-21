// WP-1868 회귀 테스트 — 팀 채팅 입력창은 전송이 끝나면 "보낸 첨부만" 초안에서 빼야 한다.
// 전송이 대기 중인 동안 붙인 첨부까지 reset() 으로 지워지던 결함을 고정한다.
// 업로드는 uploadFn 주입으로 대체하고, 개인 스페이스 조회 훅은 네트워크 없이 빈 결과로 끊는다.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PendingFile } from '@/hooks/useAttachmentDraft'
import { renderWithProviders } from '@/test/renderWithProviders'

import { MessageComposer } from './MessageComposer'

vi.mock('@/hooks/queries/useDriveSpaces', () => ({
  useDriveSpaces: () => ({ data: undefined, isSuccess: false, isError: false }),
}))

/** 파일 이름마다 고유 fileId 를 주는 업로드 이중 — 즉시 완료한다. */
function makeUpload() {
  const ids: Record<string, number> = { 'a.txt': 101, 'b.txt': 102 }
  return vi.fn(async (files: File[]) => ({
    data: files.map(
      (f): PendingFile => ({ fileId: ids[f.name], originalName: f.name, mimeType: 'text/plain', sizeBytes: 1 }),
    ),
  }))
}

/** 숨은 파일 입력으로 파일을 붙인다(＋ 메뉴 경로와 같은 onFiles). */
function attach(name: string) {
  const input = screen.getByTestId('composer-file-input')
  fireEvent.change(input, { target: { files: [new File(['x'], name, { type: 'text/plain' })] } })
}

describe('MessageComposer 첨부 초안 정리', () => {
  it('전송 중 붙인 첨부는 전송이 끝나도 남는다', async () => {
    let resolveSend: () => void = () => {}
    const onSend = vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve }))
    renderWithProviders(<MessageComposer channelId={1} members={[]} onSend={onSend} uploadFn={makeUpload()} />)

    attach('a.txt')
    await screen.findByLabelText('a.txt 첨부 제거')
    fireEvent.click(screen.getByTestId('message-composer-submit'))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(onSend.mock.calls[0]).toEqual(['', [101], []])

    // 전송이 아직 풀리지 않은 사이에 B 를 붙인다.
    attach('b.txt')
    await screen.findByLabelText('b.txt 첨부 제거')

    resolveSend()
    await waitFor(() => expect(screen.queryByLabelText('a.txt 첨부 제거')).toBeNull())
    expect(screen.getByLabelText('b.txt 첨부 제거')).toBeTruthy()
  })

  it('전송 실패면 초안이 그대로 남는다', async () => {
    const onSend = vi.fn(() => Promise.reject(new Error('fail')))
    renderWithProviders(<MessageComposer channelId={1} members={[]} onSend={onSend} uploadFn={makeUpload()} />)

    attach('a.txt')
    await screen.findByLabelText('a.txt 첨부 제거')
    fireEvent.click(screen.getByTestId('message-composer-submit'))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    // 거절이 처리될 마이크로태스크를 비운 뒤에도 칩이 남아야 한다(고정 대기 없이 결정적으로).
    await act(async () => {})
    expect(screen.getByLabelText('a.txt 첨부 제거')).toBeTruthy()
  })

  it('본문만 보낸 전송 중 붙인 첨부도 전송이 끝나도 남는다', async () => {
    let resolveSend: () => void = () => {}
    const onSend = vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve }))
    renderWithProviders(<MessageComposer channelId={1} members={[]} onSend={onSend} uploadFn={makeUpload()} />)

    const user = userEvent.setup()
    await user.type(screen.getByTestId('message-composer-input'), 'hello')
    fireEvent.click(screen.getByTestId('message-composer-submit'))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(onSend.mock.calls[0]).toEqual(['hello', [], []])

    attach('a.txt')
    await screen.findByLabelText('a.txt 첨부 제거')

    await act(async () => { resolveSend() })
    expect(screen.getByLabelText('a.txt 첨부 제거')).toBeTruthy()
  })
})
