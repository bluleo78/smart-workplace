// 드라이브 문서 변환 미리보기(WP-431) — HWP·PPTX 등은 원본 대신 서버 변환 PDF(/preview)를 폴링해 그린다.
// 변환 완료·변환 중 → 완료·영구 실패·일시 실패 후 다시 시도, 목록 아이콘(발표), 구형 엑셀(XLS) 시트 미리보기.
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

test('변환이 끝난 HWP 는 바로 PDF 로 보이고 원본 콘텐츠는 받지 않는다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [hwp(80, [{ status: 200 }])], { spaceId: SPACE_ID })
  const req = track(page, 80)
  await openViewer(page, HWP_NAME)
  await expectConvertedPdf(page)
  await expect(page.getByTestId('preview-converting')).toHaveCount(0)
  expect(req.preview.urls()[0].searchParams.get('start')).toBe('true')
  // 변환 항목은 원본을 받지 않는다(변환 PDF 만).
  await expectStays(page, req.content.count, 0)
})

test('변환 중이면 진행 화면을 보이다가 끝나면 PDF 로 바뀐다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [hwp(81, [{ status: 202 }, { status: 202 }, { status: 200 }])], { spaceId: SPACE_ID })
  const req = track(page, 81)
  await openViewer(page, HWP_NAME)
  const converting = page.getByTestId('preview-converting')
  await expect(converting).toContainText('원래 모양으로 여는 중…')
  await expect(converting).toContainText('처음 여는 문서는 몇 초 걸릴 수 있어요')
  await expectConvertedPdf(page)
  await expect(converting).toHaveCount(0)
  // 시도의 첫 요청만 start=true, 이어지는 폴링은 start 없이 — 폴링이 실패 행을 다시 선점하지 않게.
  const starts = req.preview.urls().map((u) => u.searchParams.get('start'))
  expect(starts.at(-1)).toBeNull()
  expect(starts.at(-2)).toBeNull()
  expect(starts[0]).toBe('true')
  await expectStays(page, req.content.count, 0)
})

test('영구 실패면 미리 볼 수 없다는 안내와 원본 다운로드', async ({ authenticatedPage: page }) => {
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

test('일시 실패에서 다시 시도하면 다시 요청해 PDF 를 보인다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [hwp(83, [{ status: 422, code: 'BUSY', transient: true }, { status: 200 }])], {
    spaceId: SPACE_ID,
  })
  const req = track(page, 83)
  await openViewer(page, HWP_NAME)
  const failed = page.getByTestId('preview-convert-failed')
  await expect(failed).toHaveAttribute('data-transient', 'true')
  await expect(failed).toContainText('지금은 미리보기를 준비하지 못했어요. 잠시 뒤 다시 시도해 주세요')
  const before = req.preview.count()
  await failed.getByRole('button', { name: '다시 시도' }).click()
  await expectConvertedPdf(page)
  await expect(failed).toHaveCount(0)
  // 다시 시도는 새 시도라 첫 요청에 start=true 를 붙인다 — 그래야 서버가 일시 실패 행을 다시 선점한다.
  const retried = req.preview.urls().slice(before)
  expect(retried).toHaveLength(1)
  expect(retried[0].searchParams.get('start')).toBe('true')
})

test('NOT_APPLICABLE 이 아닌 404(휴지통·권한·원본 유실)는 미지원 안내가 아니라 오류 화면', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [hwp(86, [{ status: 404, notApplicable: false }])], { spaceId: SPACE_ID })
  const req = track(page, 86)
  await openViewer(page, HWP_NAME)
  const error = page.getByTestId('preview-error')
  await expect(error).toContainText('미리보기를 불러오지 못했습니다.')
  await expect(page.getByTestId('preview-unsupported')).toHaveCount(0)
  await expect(page.getByTestId('preview-converting')).toHaveCount(0)
  // 다시 시도는 새 시도(start=true)로 다시 묻는다.
  const before = req.preview.count()
  await error.getByRole('button', { name: '다시 시도' }).click()
  await expect.poll(() => req.preview.count()).toBeGreaterThan(before)
  expect(req.preview.urls().at(-1)?.searchParams.get('start')).toBe('true')
})

test('NOT_APPLICABLE 404 는 기존 미지원 안내', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [hwp(87, [{ status: 404, notApplicable: true }])], { spaceId: SPACE_ID })
  await openViewer(page, HWP_NAME)
  await expect(page.getByTestId('preview-unsupported')).toBeVisible()
  await expect(page.getByTestId('preview-error')).toHaveCount(0)
})

test('PPTX 는 발표 아이콘으로 목록에 보인다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(
    page,
    [
      {
        id: 84,
        name: '분기 보고.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        body: 'PK',
      },
      // 대소문자·파라미터가 섞인 형식도 정규화(canonicalMime)해 같은 아이콘으로.
      {
        id: 88,
        name: '옛 발표.ppt',
        mimeType: 'Application/VND.MS-PowerPoint; charset=binary',
        body: 'PK',
      },
    ],
    { spaceId: SPACE_ID },
  )
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-row-file-84').locator('svg.lucide-presentation')).toBeVisible()
  await expect(page.getByTestId('drive-row-file-88').locator('svg.lucide-presentation')).toBeVisible()
})

test('XLS 는 시트 표로 렌더된다', async ({ authenticatedPage: page }) => {
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
