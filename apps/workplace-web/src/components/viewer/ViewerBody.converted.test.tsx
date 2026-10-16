// ViewerBody 변환 미리보기(WP-431) — 드라이브 HWP·PPT·DOC 를 서버 변환 PDF 로 그릴 때의 상태 화면과 배선.
// 폴링 훅(useConvertedPreview)·PDF 검증·pdf.js 렌더러는 끊고, 상태별로 어떤 화면·버튼이 나오는지만 본다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../test/renderWithProviders'
import type { ConvertedState } from './convertedPreview'
import type { ViewerItem } from './types'

const hook = vi.hoisted(() => ({
  state: { s: 'converting' } as ConvertedState,
  retry: vi.fn(),
  calls: [] as { item: ViewerItem; enabled: boolean }[],
}))
vi.mock('./useConvertedPreview', () => ({
  useConvertedPreview: (item: ViewerItem, enabled: boolean) => {
    hook.calls.push({ item, enabled })
    // 실제 훅처럼 꺼져 있으면 상태가 없다.
    return { state: enabled ? hook.state : null, retry: hook.retry }
  },
}))

const api = vi.hoisted(() => ({
  fetchBlobByPath: vi.fn(),
  fetchConvertedPreview: vi.fn(),
  downloadByPath: vi.fn(),
}))
vi.mock('../../api/drive', () => ({ driveApi: api }))

const verify = vi.hoisted(() => ({ fail: false }))
vi.mock('../../api/blobContent', () => ({
  toVerifiedPdfBlob: async (b: Blob) => {
    if (verify.fail) throw new Error('not a pdf')
    return b
  },
  blobToText: async () => '',
}))
vi.mock('./PdfPages', () => ({
  PdfPages: ({ blob }: { blob: Blob }) => <div data-testid="pdf-pages" data-size={blob.size} />,
}))

const download = vi.hoisted(() => vi.fn())
vi.mock('./downloadViewerItem', () => ({ downloadViewerItem: download }))

import { ViewerBody } from './ViewerBody'

const hwp = (over: Partial<ViewerItem> = {}): ViewerItem => ({
  key: 'drive:7',
  name: '회의 참석안내.hwp',
  mimeType: 'application/x-hwp',
  sizeBytes: 296 * 1024,
  contentPath: '/drive/files/7/content',
  downloadPath: '/drive/files/7/download',
  previewPath: '/drive/files/7/preview',
  ...over,
})

const pdf = new Blob(['%PDF-1.7 test'], { type: 'application/pdf' })

function renderBody(item: ViewerItem, onSource = vi.fn()) {
  renderWithProviders(<ViewerBody item={item} zoom={1} onPage={() => {}} onSource={onSource} />)
  return onSource
}

beforeEach(() => {
  hook.state = { s: 'converting' }
  hook.retry.mockReset()
  hook.calls = []
  api.fetchBlobByPath.mockReset()
  api.fetchConvertedPreview.mockReset()
  download.mockReset()
  verify.fail = false
})

describe('ViewerBody 변환 미리보기', () => {
  it('변환 중이면 문구와 불확정 진행 막대를 보인다', () => {
    renderBody(hwp())
    expect(screen.getByTestId('preview-converting')).toBeInTheDocument()
    expect(screen.getByText('원래 모양으로 여는 중…')).toBeInTheDocument()
    expect(screen.getByText('처음 여는 문서는 몇 초 걸릴 수 있어요')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: '회의 참석안내.hwp 여는 중' })
    expect(bar).not.toHaveAttribute('aria-valuenow')
    // 일반 스켈레톤은 대신 나오지 않는다.
    expect(screen.queryByTestId('preview-loading')).toBeNull()
  })

  it('영구 실패면 다운로드만 있고 다시 시도는 없다', () => {
    hook.state = { s: 'failed', code: 'CONVERT_FAILED', transient: false }
    renderBody(hwp())
    const box = screen.getByTestId('preview-convert-failed')
    expect(box).toHaveAttribute('data-transient', 'false')
    expect(screen.getByText('이 문서는 미리 볼 수 없어요')).toBeInTheDocument()
    expect(screen.getByText('296.0 KB')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '다운로드' }))
    expect(download).toHaveBeenCalledWith(expect.objectContaining({ key: 'drive:7' }), null)
  })

  it('일시 실패면 다시 시도와 다운로드가 있고 다시 시도는 retry 를 부른다', () => {
    hook.state = { s: 'failed', code: 'BUSY', transient: true }
    renderBody(hwp())
    expect(screen.getByTestId('preview-convert-failed')).toHaveAttribute('data-transient', 'true')
    expect(screen.getByText('지금은 미리보기를 준비하지 못했어요. 잠시 뒤 다시 시도해 주세요')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(hook.retry).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '다운로드' }))
    expect(download).toHaveBeenCalledWith(expect.objectContaining({ key: 'drive:7' }), null)
  })

  it('준비되면 PdfPages 로 그린다', async () => {
    hook.state = { s: 'ready', blob: pdf }
    renderBody(hwp())
    expect(await screen.findByTestId('pdf-pages')).toHaveAttribute('data-size', String(pdf.size))
    expect(screen.queryByTestId('preview-converting')).toBeNull()
  })

  it('onSource 에 변환 PDF 를 넘기지 않는다', async () => {
    hook.state = { s: 'ready', blob: pdf }
    const onSource = renderBody(hwp())
    await screen.findByTestId('pdf-pages')
    await waitFor(() => expect(onSource).toHaveBeenCalled())
    expect(onSource.mock.calls.at(-1)?.[0]).toEqual({ blob: null, fetches: false, unplayable: false })
  })

  it('원본 콘텐츠를 받지 않는다', async () => {
    hook.state = { s: 'ready', blob: pdf }
    renderBody(hwp({ sizeBytes: 50 * 1024 * 1024 }))
    await screen.findByTestId('pdf-pages')
    expect(api.fetchBlobByPath).not.toHaveBeenCalled()
    // 변환 항목은 10MB 확인을 건너뛴다.
    expect(screen.queryByTestId('preview-size-confirm')).toBeNull()
  })

  it('변환 PDF 검증에 실패하면 오류 화면이고 다시 시도는 변환 훅 retry 를 부른다', async () => {
    hook.state = { s: 'ready', blob: pdf }
    verify.fail = true
    renderBody(hwp())
    const box = await screen.findByTestId('preview-error')
    fireEvent.click(within(box).getByRole('button', { name: '다시 시도' }))
    expect(hook.retry).toHaveBeenCalledTimes(1)
    expect(api.fetchBlobByPath).not.toHaveBeenCalled()
  })

  it('변환 대상 아님(404)이면 기존 미지원 화면', () => {
    hook.state = { s: 'unsupported' }
    renderBody(hwp())
    expect(screen.getByTestId('preview-unsupported')).toBeInTheDocument()
  })

  it('대상 아님이 아닌 404(error)면 미지원이 아니라 오류 화면이고 다시 시도는 변환 훅 retry 를 부른다', () => {
    hook.state = { s: 'error' }
    renderBody(hwp())
    expect(screen.queryByTestId('preview-unsupported')).toBeNull()
    expect(screen.queryByTestId('preview-converting')).toBeNull()
    const box = screen.getByTestId('preview-error')
    fireEvent.click(within(box).getByRole('button', { name: '다시 시도' }))
    expect(hook.retry).toHaveBeenCalledTimes(1)
  })

  it('previewPath 없는 HWP 는 기존 미지원 화면', () => {
    renderBody(hwp({ previewPath: undefined }))
    expect(screen.getByText('이 형식은 미리 볼 수 없어요')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-converting')).toBeNull()
    expect(api.fetchConvertedPreview).not.toHaveBeenCalled()
    // 훅을 부르더라도 꺼진 채로만 부른다.
    expect(hook.calls.every((c) => !c.enabled)).toBe(true)
  })
})
