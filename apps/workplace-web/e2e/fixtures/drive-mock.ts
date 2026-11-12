// 드라이브 파일 미리보기(통합 첨부 뷰어) route 모킹 — 데스크톱(e2e/pages/drive/attachment-viewer)·모바일(attachment-viewer-mobile) spec 이 공유한다(WP-278).
// 공간·목록·파일별 콘텐츠/썸네일(404)/요약/참조된 곳을 page.route 로 막는다. 두 spec 의 기본값 차이(요약 기본·다운로드 경로)는 옵션으로 고른다.
import type { Page, Route } from '@playwright/test'

import { createSpace, personalSpace } from '../factories/drive.factory'
import { type PreviewStub, routePreviewSequence } from './preview-stub'
import { SAMPLE_MP3, SAMPLE_WEBM } from './samples'

/** 요약 응답 본문. */
export interface DriveSummaryStub {
  summary: string | null
  status: string
  reason?: string
}

/** 변환 미리보기 응답 순서 — 공용 fixture(preview-stub)로 옮겼고, 기존 import 경로를 위해 다시 내보낸다. */
export type { PreviewStub }

/** 모킹할 드라이브 파일 하나. */
export interface DriveStubFile {
  id: number
  name: string
  mimeType: string
  /** 콘텐츠(·다운로드) 응답 본문. */
  body: string | Buffer
  /** 목록에 보일 크기 — 없으면 본문 바이트 수. 본문과 다른 크기(10MB 확인 등)를 흉내 낼 때 준다. */
  sizeBytes?: number
  /** 요약 응답 — 숫자면 그 HTTP 상태(403 = ✨ 숨김), 없으면 옵션의 기본 요약. */
  summary?: number | DriveSummaryStub
  /** 콘텐츠 응답 지연(ms) — 늦게 도착한 응답·공유 "받는 중" 확인용. */
  delayMs?: number
  /** 참조된 곳 응답 — 없으면 빈 목록. */
  backlinks?: unknown[]
  /**
   * 변환 미리보기 응답 순서(WP-431) — 있으면 /preview 를 요청마다 차례로 응답하고 마지막 값을 반복한다.
   * 없으면 /preview 를 막지 않는다(변환 대상이 아닌 형식).
   */
  preview?: PreviewStub[]
  /** 재생 주소 발급(WP-1532) 응답 상태 — 없으면 200(영상·오디오만). 404 등으로 발급 실패를 흉내 낸다. */
  playbackStatus?: number
  /**
   * 재생 주소 범위 응답 한 번에 보낼 최대 바이트(WP-1532) — 서버가 요청보다 짧은 구간을 돌려줄 수 있다는 HTTP 계약을 이용해
   * 영상을 여러 번의 범위 요청으로 나눠 받게 한다(다 받기 전에 재생이 시작되는지 보려고). 없으면 요청한 구간 전부.
   */
  rangeChunkBytes?: number
}

/** 재생 주소 경로 접두(WP-1532) — 실제 서버처럼 공개 경로 + 토큰. 파일마다 다르고, 발급마다 뒤에 순번이 붙는다(서버도 발급마다 다른 값). */
export const playbackPrefix = (id: number) => `/api/v1/public/drive/playback/e2e-token-${id}-`
/** 이 파일의 재생 주소 요청인가(어느 발급분이든). */
export const isPlaybackPath = (pathname: string, id: number) => pathname.startsWith(playbackPrefix(id))

/**
 * Range 를 해석해 206 으로 그 구간만 내준다(WP-1532) — 서버(스프링 ResourceRegion)와 같은 계약.
 * Range 가 없으면 200 전체 + Accept-Ranges. `bytes=a-b`·`bytes=a-`·`bytes=-n` 하나만 다룬다(브라우저 미디어 요청 모양).
 */
export async function fulfillRange(route: Route, body: Buffer, contentType: string, maxChunk?: number) {
  const range = route.request().headers()['range']
  const total = body.length
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (!m) {
    await route.fulfill({ status: 200, contentType, headers: { 'Accept-Ranges': 'bytes' }, body }).catch(() => {})
    return
  }
  let start = m[1] === '' ? Math.max(0, total - Number(m[2])) : Number(m[1])
  let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : total - 1
  end = Math.min(end, total - 1)
  if (maxChunk) end = Math.min(end, start + maxChunk - 1)
  if (start > end) start = end
  await route
    .fulfill({
      status: 206,
      contentType,
      headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` },
      body: body.subarray(start, end + 1),
    })
    .catch(() => {})
}

export interface StubDriveOptions {
  /** 목록을 돌려줄 공간 id(기본 1). */
  spaceId?: number
  /** 파일에 요약이 없을 때의 기본 요약 응답(기본 PENDING). */
  defaultSummary?: DriveSummaryStub
  /** /download 경로도 콘텐츠로 막을지 — ⬇ 저장(감사 로그 경로)을 쓰는 spec 만 켠다(기본 꺼짐). */
  download?: boolean
}

/** 공간·목록·파일별 콘텐츠·(선택) 다운로드·썸네일(404)·요약·참조된 곳을 route 로 막는다. */
export async function stubDriveFiles(page: Page, files: DriveStubFile[], opts: StubDriveOptions = {}) {
  const spaceId = opts.spaceId ?? 1
  const defaultSummary = opts.defaultSummary ?? { summary: null, status: 'PENDING' }
  await page.route(
    (u) => u.pathname === '/api/v1/drive/spaces',
    (r) => (r.request().method() === 'GET' ? r.fulfill({ json: [personalSpace(), createSpace()] }) : r.fallback()),
  )
  await page.route(
    (u) => u.pathname === '/api/v1/drive/quota',
    (r) => r.fulfill({ json: { usedBytes: 0, quotaBytes: 10737418240 } }),
  )
  await page.route(
    (u) => u.pathname === `/api/v1/drive/spaces/${spaceId}/items`,
    (r) =>
      r.fulfill({
        json: {
          folders: [],
          files: files.map((f) => ({
            id: f.id,
            folderId: null,
            fileId: f.id + 1000,
            name: f.name,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes ?? Buffer.byteLength(f.body),
            category: 'TEXT',
            createdAt: '2026-01-01T00:00:00Z',
          })),
        },
      }),
  )
  for (const f of files) {
    await page.route(
      (u) => u.pathname === `/api/v1/drive/files/${f.id}/content`,
      async (r) => {
        if (f.delayMs) await new Promise((res) => setTimeout(res, f.delayMs))
        // 지연 중 테스트가 끝나 route 가 닫혀도 실패로 치지 않는다.
        await r.fulfill({ status: 200, contentType: f.mimeType, body: f.body }).catch(() => {})
      },
    )
    // 영상·오디오는 원본 blob 대신 재생 주소 발급(POST) → 공개 경로 Range 재생(WP-1532).
    if (/^(video|audio)\//.test(f.mimeType)) {
      let issued = 0
      await page.route(
        (u) => u.pathname === `/api/v1/drive/files/${f.id}/playback-url`,
        (r) =>
          f.playbackStatus && f.playbackStatus !== 200
            ? r.fulfill({ status: f.playbackStatus, json: { message: '드라이브 파일을 찾을 수 없습니다' } })
            : r.fulfill({ json: { url: `${playbackPrefix(f.id)}${++issued}`, expiresAt: '2099-01-01T00:00:00Z', mimeType: f.mimeType } }),
      )
      const bytes = Buffer.isBuffer(f.body) ? f.body : Buffer.from(f.body)
      await page.route(
        (u) => isPlaybackPath(u.pathname, f.id),
        async (r) => {
          if (f.delayMs) await new Promise((res) => setTimeout(res, f.delayMs))
          await fulfillRange(r, bytes, f.mimeType, f.rangeChunkBytes)
        },
      )
    }
    if (opts.download) {
      await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/download`, (r) =>
        r.fulfill({ status: 200, contentType: f.mimeType, body: f.body }),
      )
    }
    if (f.preview?.length) await routePreviewSequence(page, `/api/v1/drive/files/${f.id}/preview`, f.preview)
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/thumbnail`, (r) => r.fulfill({ status: 404 }))
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/summary`, (r) =>
      typeof f.summary === 'number'
        ? r.fulfill({ status: f.summary, body: '' })
        : r.fulfill({ json: f.summary ?? defaultSummary }),
    )
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/backlinks`, (r) => r.fulfill({ json: f.backlinks ?? [] }))
  }
}

/** 실제 webm 영상 드라이브 파일(WP-281) — extra 로 크기·지연 등을 덮는다. */
export const videoFile = (id: number, name: string, extra: Partial<DriveStubFile> = {}): DriveStubFile => ({
  id,
  name,
  mimeType: 'video/webm',
  body: SAMPLE_WEBM,
  ...extra,
})
/** 실제 mp3 오디오 드라이브 파일(WP-281). */
export const audioFile = (id: number, name: string): DriveStubFile => ({ id, name, mimeType: 'audio/mpeg', body: SAMPLE_MP3 })
