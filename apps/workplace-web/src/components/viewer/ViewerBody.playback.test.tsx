// ViewerBody 영상·오디오 바로 재생(WP-1532) — 드라이브 파일은 서명 재생 주소를 미디어 요소에 바로 넣고(blob 받기·받는 중 %·10MB 확인 없음),
// 드라이브 파일이 아닌 첨부는 지금처럼 blob 으로 받는다. 실제 디코드·Range 재생은 E2E(attachment-viewer-media.spec)가 본다.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../test/renderWithProviders'
import type { ViewerItem } from './types'

const api = vi.hoisted(() => ({
  fetchBlobByPath: vi.fn(),
  fetchConvertedPreview: vi.fn(),
  issuePlaybackUrl: vi.fn(),
}))
vi.mock('../../api/drive', () => ({ driveApi: api }))

const download = vi.hoisted(() => vi.fn())
vi.mock('./downloadViewerItem', () => ({ downloadViewerItem: download }))

import { ViewerBody } from './ViewerBody'

const SIGNED = '/api/v1/public/drive/playback/abc'
const SIGNED_2 = '/api/v1/public/drive/playback/xyz'

/** 드라이브 화면의 500MB 영상 — 10MB 를 훌쩍 넘지만 확인 없이 바로 재생해야 한다. */
const driveVideo = (over: Partial<ViewerItem> = {}): ViewerItem => ({
  key: 'drive:70',
  name: '발표.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 500 * 1024 * 1024,
  contentPath: '/drive/files/70/content',
  downloadPath: '/drive/files/70/download',
  playback: { driveFileId: 70, versionFileId: 700 },
  ...over,
})

/** 이슈 첨부 영상 — 재생 주소 대상이 아니므로 blob 으로 받는다. */
const issueVideo = (over: Partial<ViewerItem> = {}): ViewerItem => ({
  key: 'file:5',
  name: 'clip.webm',
  mimeType: 'video/webm',
  sizeBytes: 2 * 1024 * 1024,
  contentPath: '/projects/WP/issues/1/attachments/5/content',
  downloadPath: '/projects/WP/issues/1/attachments/5/content',
  ...over,
})

function renderBody(item: ViewerItem, onSource = vi.fn()) {
  renderWithProviders(<ViewerBody item={item} zoom={1} onPage={() => {}} onSource={onSource} />)
  return onSource
}

beforeEach(() => {
  api.fetchBlobByPath.mockReset()
  api.issuePlaybackUrl.mockReset()
  download.mockReset()
  // jsdom 은 미디어 재생을 구현하지 않는다 — 플레이어 정리(pause·load)가 콘솔 오류를 내지 않게 빈 구현으로.
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

describe('드라이브 영상·오디오 — 서명 재생 주소로 바로 재생', () => {
  it('10MB 확인·받는 중 % 없이 재생 주소를 영상 src 로 넣고 원본 blob 은 받지 않는다', async () => {
    api.issuePlaybackUrl.mockResolvedValue({ url: SIGNED, expiresAt: '2026-11-12T10:00:00Z', mimeType: 'video/mp4' })
    renderBody(driveVideo())
    const video = await screen.findByTestId('media-video')
    await waitFor(() => expect((video as HTMLVideoElement).getAttribute('src')).toBe(SIGNED))
    expect(api.issuePlaybackUrl).toHaveBeenCalledTimes(1)
    expect(api.issuePlaybackUrl).toHaveBeenCalledWith(70)
    expect(api.fetchBlobByPath).not.toHaveBeenCalled()
    expect(screen.queryByTestId('preview-size-confirm')).toBeNull()
    expect(screen.queryByTestId('media-progress')).toBeNull()
    expect(screen.getByTestId('media-status-live')).toHaveTextContent('발표.mp4 재생 준비됨')
  })

  it('주소를 받는 동안은 % 없는 로딩이고 진행 막대·확인 화면이 없다', async () => {
    api.issuePlaybackUrl.mockReturnValue(new Promise(() => {}))
    renderBody(driveVideo())
    expect(await screen.findByTestId('preview-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('media-progress')).toBeNull()
    expect(screen.queryByTestId('media-progress-label')).toBeNull()
    expect(screen.queryByTestId('preview-size-confirm')).toBeNull()
  })

  it('오디오도 재생 주소를 audio src 로 넣는다', async () => {
    api.issuePlaybackUrl.mockResolvedValue({ url: SIGNED, expiresAt: '2026-11-12T10:00:00Z', mimeType: 'audio/mpeg' })
    renderBody(driveVideo({ name: '녹음.mp3', mimeType: 'audio/mpeg' }))
    const audio = await screen.findByTestId('media-audio')
    await waitFor(() => expect(audio.getAttribute('src')).toBe(SIGNED))
    expect(api.fetchBlobByPath).not.toHaveBeenCalled()
  })

  it('blob 을 받지 않으므로 모바일 공유 대상이 아니라고 알린다(fetches 거짓)', async () => {
    api.issuePlaybackUrl.mockResolvedValue({ url: SIGNED, expiresAt: '2026-11-12T10:00:00Z', mimeType: 'video/mp4' })
    const onSource = renderBody(driveVideo())
    await screen.findByTestId('media-video')
    expect(onSource).toHaveBeenLastCalledWith({ blob: null, fetches: false, unplayable: false })
  })

  it('주소 발급 실패면 오류 화면 — 다시 시도는 다시 발급하고, 다운로드는 감사 경로로 받는다', async () => {
    api.issuePlaybackUrl.mockRejectedValueOnce(new Error('404'))
    api.issuePlaybackUrl.mockResolvedValue({ url: SIGNED, expiresAt: '2026-11-12T10:00:00Z', mimeType: 'video/mp4' })
    renderBody(driveVideo())
    const err = await screen.findByTestId('preview-error')
    const user = userEvent.setup()
    await user.click(within(err).getByRole('button', { name: '다운로드' }))
    expect(download).toHaveBeenCalledWith(expect.objectContaining({ downloadPath: '/drive/files/70/download' }), null)
    await user.click(within(err).getByRole('button', { name: '다시 시도' }))
    const video = await screen.findByTestId('media-video')
    await waitFor(() => expect(video.getAttribute('src')).toBe(SIGNED))
    expect(api.issuePlaybackUrl).toHaveBeenCalledTimes(2)
  })

  it('미디어 오류면 주소를 한 번 다시 받아 이어 재생한다(만료·새 버전 등)', async () => {
    api.issuePlaybackUrl
      .mockResolvedValueOnce({ url: SIGNED, expiresAt: '2026-11-12T10:00:00Z', mimeType: 'video/mp4' })
      .mockResolvedValueOnce({ url: SIGNED_2, expiresAt: '2026-11-12T14:00:00Z', mimeType: 'video/mp4' })
    renderBody(driveVideo())
    const video = await screen.findByTestId('media-video')
    await waitFor(() => expect(video.getAttribute('src')).toBe(SIGNED))
    video.dispatchEvent(new Event('error'))
    await waitFor(() => expect(screen.getByTestId('media-video').getAttribute('src')).toBe(SIGNED_2))
    expect(api.issuePlaybackUrl).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('preview-unsupported')).toBeNull()
  })

  it('다시 받은 주소로도 오류면(코덱 미지원) 미지원 화면과 다운로드 — 더 다시 받지 않는다', async () => {
    api.issuePlaybackUrl
      .mockResolvedValueOnce({ url: SIGNED, expiresAt: '2026-11-12T10:00:00Z', mimeType: 'video/quicktime' })
      .mockResolvedValueOnce({ url: SIGNED_2, expiresAt: '2026-11-12T14:00:00Z', mimeType: 'video/quicktime' })
    renderBody(driveVideo({ name: 'hevc.mov', mimeType: 'video/quicktime' }))
    const first = await screen.findByTestId('media-video')
    await waitFor(() => expect(first.getAttribute('src')).toBe(SIGNED))
    first.dispatchEvent(new Event('error'))
    await waitFor(() => expect(screen.getByTestId('media-video').getAttribute('src')).toBe(SIGNED_2))
    screen.getByTestId('media-video').dispatchEvent(new Event('error'))
    const notice = await screen.findByTestId('preview-unsupported')
    expect(within(notice).getByRole('button', { name: '다운로드' })).toBeInTheDocument()
    expect(screen.queryByTestId('media-video')).toBeNull()
    expect(api.issuePlaybackUrl).toHaveBeenCalledTimes(2)
  })

  it('새 버전(versionFileId 변경)이면 이전 버전 주소를 쓰지 않고 새로 발급한다', async () => {
    api.issuePlaybackUrl
      .mockResolvedValueOnce({ url: SIGNED, expiresAt: '2026-11-12T10:00:00Z', mimeType: 'video/mp4' })
      .mockResolvedValueOnce({ url: SIGNED_2, expiresAt: '2026-11-12T14:00:00Z', mimeType: 'video/mp4' })
    const { rerender } = renderWithProviders(<ViewerBody item={driveVideo()} zoom={1} onPage={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('media-video').getAttribute('src')).toBe(SIGNED))
    rerender(<ViewerBody item={driveVideo({ playback: { driveFileId: 70, versionFileId: 701 } })} zoom={1} onPage={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('media-video').getAttribute('src')).toBe(SIGNED_2))
    expect(api.issuePlaybackUrl).toHaveBeenCalledTimes(2)
  })

  it('서버가 발급하지 않는 형식(avi)은 재생 주소를 묻지 않고 blob 으로 받는다', () => {
    api.fetchBlobByPath.mockReturnValue(new Promise(() => {}))
    renderBody(driveVideo({ name: 'old.avi', mimeType: 'video/x-msvideo', sizeBytes: 2 * 1024 * 1024 }))
    expect(api.issuePlaybackUrl).not.toHaveBeenCalled()
    expect(api.fetchBlobByPath).toHaveBeenCalled()
  })

  it('휴지통 등으로 쓸 수 없는 항목은 주소를 발급하지 않는다', () => {
    renderBody(driveVideo({ unavailable: true }))
    expect(screen.getByTestId('preview-unavailable')).toBeInTheDocument()
    expect(api.issuePlaybackUrl).not.toHaveBeenCalled()
  })
})

describe('드라이브 파일이 아닌 영상 — 지금처럼 blob 으로 받는다', () => {
  it('재생 주소를 발급하지 않고 원본 blob 을 받아 받는 중 % 를 보인다', async () => {
    api.fetchBlobByPath.mockReturnValue(new Promise(() => {}))
    renderBody(issueVideo())
    expect(await screen.findByTestId('media-progress-label')).toHaveTextContent('영상 받는 중… 0%')
    expect(api.fetchBlobByPath).toHaveBeenCalledWith('/projects/WP/issues/1/attachments/5/content', expect.anything())
    expect(api.issuePlaybackUrl).not.toHaveBeenCalled()
  })

  it('10MB 를 넘으면 여전히 먼저 확인을 받는다', () => {
    renderBody(issueVideo({ sizeBytes: 50 * 1024 * 1024 }))
    expect(screen.getByTestId('preview-size-confirm')).toBeInTheDocument()
    expect(api.fetchBlobByPath).not.toHaveBeenCalled()
  })

  it('드라이브 파일이라도 영상·오디오가 아니면 재생 주소를 쓰지 않는다', async () => {
    api.fetchBlobByPath.mockResolvedValue(new Blob(['hello'], { type: 'text/plain' }))
    renderBody(driveVideo({ name: 'a.txt', mimeType: 'text/plain', sizeBytes: 5 }))
    expect(await screen.findByText('hello')).toBeInTheDocument()
    expect(api.issuePlaybackUrl).not.toHaveBeenCalled()
  })
})
