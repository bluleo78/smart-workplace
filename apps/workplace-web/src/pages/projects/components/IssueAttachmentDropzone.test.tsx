// 이슈 첨부 드롭존(WP-2118) — 업로드 중에는 「· n개 남음」을 숨기고 드롭·클릭을 막는다.
import { createEvent, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { BLOCKED_UPLOAD_TOAST_ID } from '../../../lib/issueAttachmentUpload'
import { IssueAttachmentDropzone } from './IssueAttachmentDropzone'

const { toastInfo } = vi.hoisted(() => ({ toastInfo: vi.fn() }))
vi.mock('sonner', () => ({ toast: { info: toastInfo } }))
const { mutate, state } = vi.hoisted(() => ({ mutate: vi.fn(), state: { isPending: false } }))
vi.mock('@/hooks/queries/useUploadIssueAttachments', () => ({
  useUploadIssueAttachments: () => ({ mutate, isPending: state.isPending }),
}))

const drop = (files: File[]) =>
  fireEvent.drop(screen.getByTestId('attachment-dropzone'), { dataTransfer: { files } })

const dragEvt = (type: 'dragOver' | 'drop', files: File[] = []) => {
  const ev = createEvent[type](screen.getByTestId('attachment-dropzone'), { dataTransfer: { files } })
  fireEvent(screen.getByTestId('attachment-dropzone'), ev)
  return ev as Event & { dataTransfer?: { dropEffect?: string } }
}

describe('IssueAttachmentDropzone — 막힌 때에도 브라우저 기본 동작(파일 열기)을 막는다', () => {
  beforeEach(() => {
    mutate.mockClear()
    state.isPending = false
  })

  it.each([
    ['업로드 중', true, 17],
    ['한도 도달', false, 20],
  ])('%s: dragover·drop 모두 defaultPrevented, 업로드 호출 없음', (_n, pending, count) => {
    state.isPending = pending
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={count} disabled={count >= 20} />)
    expect(dragEvt('dragOver').defaultPrevented).toBe(true)
    expect(dragEvt('drop', [new File(['x'], 'a.log')]).defaultPrevented).toBe(true)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('업로드 중에는 cursor-not-allowed', () => {
    state.isPending = true
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    const cls = screen.getByTestId('attachment-dropzone').className
    expect(cls).toContain('cursor-not-allowed')
    expect(cls).not.toContain('cursor-pointer')
  })
})

// 막힌 안내 토스트는 고정 id 로 띄운다(반복해도 쌓이지 않게).
const BLOCKED_OPTS = { id: BLOCKED_UPLOAD_TOAST_ID }

describe('IssueAttachmentDropzone — 막힌 드롭 안내(WP-2118)', () => {
  beforeEach(() => {
    mutate.mockClear()
    toastInfo.mockClear()
    state.isPending = false
  })

  it('업로드 중 드롭하면 안내 토스트, 업로드 없음', () => {
    state.isPending = true
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    drop([new File(['x'], 'a.log')])
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('업로드 중'), BLOCKED_OPTS)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('한도 도달에서 드롭하면 한도 안내 토스트', () => {
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={20} disabled />)
    drop([new File(['x'], 'a.log')])
    expect(toastInfo).toHaveBeenCalledWith('한도 도달 · 최대 20개', BLOCKED_OPTS)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('업로드 중 클릭하면 드롭과 같은 안내 토스트, 한도 도달 클릭도 한도 안내', () => {
    state.isPending = true
    const { unmount } = renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    fireEvent.click(screen.getByTestId('attachment-dropzone'))
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('업로드 중'), BLOCKED_OPTS)
    unmount()
    toastInfo.mockClear()
    state.isPending = false
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={20} disabled />)
    fireEvent.click(screen.getByTestId('attachment-dropzone'))
    expect(toastInfo).toHaveBeenCalledWith('한도 도달 · 최대 20개', BLOCKED_OPTS)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('막히지 않았을 땐 클릭해도 토스트가 없다', () => {
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    fireEvent.click(screen.getByTestId('attachment-dropzone'))
    expect(toastInfo).not.toHaveBeenCalled()
  })

  it('막히면 dragover 의 dropEffect 가 none, 평소엔 copy', () => {
    state.isPending = true
    const { unmount } = renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    expect(dragEvt('dragOver').dataTransfer?.dropEffect).toBe('none')
    unmount()
    state.isPending = false
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    expect(dragEvt('dragOver').dataTransfer?.dropEffect).toBe('copy')
  })
})

describe('IssueAttachmentDropzone — 업로드 중', () => {
  beforeEach(() => {
    mutate.mockClear()
    state.isPending = false
  })

  it('평소에는 「n개 남음」이 보이고 드롭하면 업로드한다', () => {
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={17} disabled={false} />)
    expect(screen.getByTestId('attachment-dropzone')).toHaveTextContent('3개 남음')
    drop([new File(['x'], 'a.log')])
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('업로드 중에는 「n개 남음」을 숨기고 드롭을 무시한다', () => {
    state.isPending = true
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={17} disabled={false} />)
    const zone = screen.getByTestId('attachment-dropzone')
    expect(zone).toHaveTextContent('업로드 중')
    expect(zone).not.toHaveTextContent('남음')
    drop([new File(['x'], 'a.log')])
    expect(mutate).not.toHaveBeenCalled()
  })
})
