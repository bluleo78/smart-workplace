// 드라이브 파일 미리보기(통합 첨부 뷰어) route 모킹 — 데스크톱(e2e/pages/drive/attachment-viewer)·모바일(attachment-viewer-mobile) spec 이 공유한다(WP-278).
// 공간·목록·파일별 콘텐츠/썸네일(404)/요약/참조된 곳을 page.route 로 막는다. 두 spec 의 기본값 차이(요약 기본·다운로드 경로)는 옵션으로 고른다.
import type { Page } from '@playwright/test'

import { createSpace, personalSpace } from '../factories/drive.factory'

/** 요약 응답 본문. */
export interface DriveSummaryStub {
  summary: string | null
  status: string
  reason?: string
}

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
    if (opts.download) {
      await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/download`, (r) =>
        r.fulfill({ status: 200, contentType: f.mimeType, body: f.body }),
      )
    }
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/thumbnail`, (r) => r.fulfill({ status: 404 }))
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/summary`, (r) =>
      typeof f.summary === 'number'
        ? r.fulfill({ status: f.summary, body: '' })
        : r.fulfill({ json: f.summary ?? defaultSummary }),
    )
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/backlinks`, (r) => r.fulfill({ json: f.backlinks ?? [] }))
  }
}
