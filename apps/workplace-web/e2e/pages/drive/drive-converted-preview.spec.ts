// 드라이브 문서 변환 미리보기(WP-431) — HWP·PPTX 등은 원본 대신 서버 변환 PDF(/preview)를 폴링해 그린다.
// 실제 PDF 렌더·다운로드 파일명·시트 파싱이 필요한 것만 남긴다(@platform): 변환 완료 PDF, 영구 실패 원본 다운로드, 구형 엑셀(XLS) 시트.
// 변환 중·일시 실패 다시 시도·404 구분과 start 파라미터는 src/components/viewer/useConvertedPreview.test.tsx·ViewerBody.converted.test.tsx,
// 목록 발표 아이콘은 src/pages/drive/drivePreview.test.tsx 가 지킨다(WP-984).
// 드라이브 route 모킹은 공용 fixture(e2e/fixtures/drive-mock.ts) — /preview 응답 순서는 파일의 preview 배열로 준다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { type DriveStubFile, type PreviewStub, stubDriveFiles } from '../../fixtures/drive-mock'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'

const SPACE_ID = 1
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 시안의 긴 한글 파일명 — 긴 이름이 상태 화면·다운로드 파일명에 그대로 남는지도 함께 본다. */
const HWP_NAME = '2026년 언택트 AI R&D 과제기획 전담반 회의 참석안내.hwp'

/** 변환 대상 HWP 파일 — 원본 본문은 받지 않아야 하므로 아무 바이트나 둔다. */
const hwp = (id: number, preview: PreviewStub[]): DriveStubFile => ({
  id,
  name: HWP_NAME,
  mimeType: 'application/x-hwp',
  body: Buffer.from('HWP Document File'),
  preview,
})

/** 원본 콘텐츠·변환 미리보기 요청을 센다 — goto 전에 만든다. */
function track(page: Page, id: number) {
  return {
    content: trackRequests(page, 'GET', `/api/v1/drive/files/${id}/content`),
    preview: trackRequests(page, 'GET', `/api/v1/drive/files/${id}/preview`),
  }
}

/** 목록에서 파일명을 눌러 뷰어를 연다. */
async function openViewer(page: Page, name: string) {
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByTestId('preview-body')).toBeVisible()
}

/** 변환 PDF(3쪽 샘플)가 pdf.js 캔버스로 다 그려졌는지. */
async function expectConvertedPdf(page: Page) {
  await expect(page.getByTestId('pdf-page-1')).toBeVisible()
  await expect(page.getByTestId('pdf-document').locator('canvas')).toHaveCount(3)
  await expect(page.getByTestId('preview-meta')).toContainText('p.1 / 3')
}

test('변환이 끝난 HWP 는 바로 PDF 로 보이고 원본 콘텐츠는 받지 않는다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [hwp(80, [{ status: 200 }])], { spaceId: SPACE_ID })
  const req = track(page, 80)
  await openViewer(page, HWP_NAME)
  await expectConvertedPdf(page)
  await expect(page.getByTestId('preview-converting')).toHaveCount(0)
  expect(req.preview.urls()[0].searchParams.get('start')).toBe('true')
  // 변환 항목은 원본을 받지 않는다(변환 PDF 만).
  await expectStays(page, req.content.count, 0)
})

test('영구 실패면 미리 볼 수 없다는 안내와 원본 다운로드', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [hwp(82, [{ status: 422, code: 'CONVERT_FAILED', transient: false }])], {
    spaceId: SPACE_ID,
    download: true,
  })
  const req = track(page, 82)
  const downloads = trackRequests(page, 'GET', '/api/v1/drive/files/82/download')
  await openViewer(page, HWP_NAME)
  const failed = page.getByTestId('preview-convert-failed')
  await expect(failed).toHaveAttribute('data-transient', 'false')
  await expect(failed).toContainText('이 문서는 미리 볼 수 없어요')
  await expect(failed.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
  // 다운로드는 원본(.hwp) — /download(감사 로그 경로)로 받는다.
  const download = page.waitForEvent('download')
  await failed.getByRole('button', { name: '다운로드' }).click()
  expect((await download).suggestedFilename()).toBe(HWP_NAME)
  expect(downloads.count()).toBeGreaterThanOrEqual(1)
  expect(req.content.count()).toBe(0)
})

test('XLS 는 시트 표로 렌더된다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  // SheetJS 는 형식을 내용으로 판별하므로 XLSX 바이트를 구형 엑셀 mime 으로 내려도 시트로 읽힌다.
  const xlsx = fs.readFileSync(path.join(HERE, '../../fixtures/sample.xlsx'))
  await stubDriveFiles(page, [{ id: 85, name: '명단.xls', mimeType: 'application/vnd.ms-excel', body: xlsx }], {
    spaceId: SPACE_ID,
  })
  const req = track(page, 85)
  await openViewer(page, '명단.xls')
  const table = page.getByTestId('preview-body').getByTestId('xlsx-table')
  await expect(table.getByRole('cell', { name: '이름' })).toBeVisible()
  await expect(table.getByRole('cell', { name: '홍길동' })).toBeVisible()
  // XLS 는 변환 대상이 아니다 — 원본을 받아 그리고 /preview 는 묻지 않는다.
  expect(req.content.count()).toBeGreaterThanOrEqual(1)
  expect(req.preview.count()).toBe(0)
})
