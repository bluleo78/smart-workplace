// 메일 첨부 문서 변환 미리보기(WP-432, 데스크톱) — HWP 등 변환 대상 첨부는 원본 대신 서버 변환 PDF(/mail/attachments/{id}/preview)를 폴링해 그린다.
// 변환 완료·변환 중 → 완료·영구 실패(원본 다운로드)·일시 실패 후 다시 시도·404(오류 vs 미지원).
// 모바일 배선 1건은 e2e/pages/mobile/mail-attachment-viewer-mobile.spec.ts.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { DOC_MAIL_ID, stubMailWithDocAttachments } from '../../fixtures/mail-viewer-mock'
import type { PreviewStub } from '../../fixtures/preview-stub'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'

/** 시안의 긴 한글 파일명 — 긴 이름이 상태 화면·다운로드 파일명에 그대로 남는지도 함께 본다. */
const HWP_NAME = '2026년 언택트 AI R&D 과제기획 전담반 회의 참석안내.hwp'

/** HWP 첨부 하나를 담은 13번 메일을 모킹하고 /content·/preview 요청 tracker 를 돌려준다 — goto 전에 부른다. */
async function stubHwp(page: Page, id: number, preview: PreviewStub[]) {
  const content = await stubMailWithDocAttachments(page, [
    { id, filename: HWP_NAME, contentType: 'application/x-hwp', preview },
  ])
  const previews = trackRequests(page, 'GET', `/api/v1/mail/attachments/${id}/preview`)
  return { content, preview: previews }
}

/** 받은편지함 → 13번 메일 → 첨부 칩을 눌러 뷰어를 연다. */
async function openViewer(page: Page, id: number) {
  await page.goto('/mail/1')
  await page.getByTestId(`mail-row-${DOC_MAIL_ID}`).click()
  await page.getByTestId(`mail-attachment-open-${id}`).click()
  await expect(page.getByTestId('attachment-viewer')).toHaveAccessibleName(`${HWP_NAME} 미리보기`)
}

/** 변환 PDF(3쪽 샘플)가 pdf.js 캔버스로 다 그려졌는지. */
async function expectConvertedPdf(page: Page) {
  await expect(page.getByTestId('pdf-page-1')).toBeVisible()
  await expect(page.getByTestId('pdf-document').locator('canvas')).toHaveCount(3)
}

test.describe('메일 첨부 문서 변환 미리보기', () => {
  test('변환이 끝난 HWP 첨부는 바로 PDF 로 보이고 원본은 받지 않는다', async ({ authenticatedPage: page }) => {
    const req = await stubHwp(page, 40, [{ status: 200 }])
    await openViewer(page, 40)
    await expectConvertedPdf(page)
    await expect(page.getByTestId('preview-converting')).toHaveCount(0)
    expect(req.preview.urls()[0].searchParams.get('start')).toBe('true')
    // 변환 항목은 원본(/content)을 받지 않는다 — 변환 PDF 만.
    await expectStays(page, req.content.count, 0)
  })

  test('변환 중이면 진행 화면을 보이다가 끝나면 PDF 로 바뀐다', async ({ authenticatedPage: page }) => {
    const req = await stubHwp(page, 41, [{ status: 202 }, { status: 202 }, { status: 200 }])
    await openViewer(page, 41)
    const converting = page.getByTestId('preview-converting')
    await expect(converting).toContainText('원래 모양으로 여는 중…')
    await expectConvertedPdf(page)
    await expect(converting).toHaveCount(0)
    // 시도의 첫 요청만 start=true, 이어지는 폴링은 start 없이 — 폴링이 실패 행을 다시 선점하지 않게.
    const starts = req.preview.urls().map((u) => u.searchParams.get('start'))
    expect(starts[0]).toBe('true')
    expect(starts.at(-1)).toBeNull()
    expect(starts.at(-2)).toBeNull()
    await expectStays(page, req.content.count, 0)
  })

  test('영구 실패면 안내와 원본 다운로드', async ({ authenticatedPage: page }) => {
    const req = await stubHwp(page, 42, [{ status: 422, code: 'CONVERT_FAILED', transient: false }])
    await openViewer(page, 42)
    const failed = page.getByTestId('preview-convert-failed')
    await expect(failed).toHaveAttribute('data-transient', 'false')
    await expect(failed).toContainText('이 문서는 미리 볼 수 없어요')
    await expect(failed.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
    expect(req.content.count()).toBe(0)
    // 다운로드는 원본(.hwp) — 메일 첨부 콘텐츠 경로로 받아 원본 파일명으로 저장한다.
    const download = page.waitForEvent('download')
    await failed.getByRole('button', { name: '다운로드' }).click()
    expect((await download).suggestedFilename()).toBe(HWP_NAME)
    expect(req.content.urls().map((u) => u.pathname)).toEqual(['/api/v1/mail/attachments/42/content'])
  })

  test('일시 실패에서 다시 시도하면 start=true 로 다시 요청해 PDF 를 보인다', async ({ authenticatedPage: page }) => {
    const req = await stubHwp(page, 43, [{ status: 422, code: 'BUSY', transient: true }, { status: 200 }])
    await openViewer(page, 43)
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
    await expectStays(page, req.content.count, 0)
  })

  test('NOT_APPLICABLE 이 아닌 404(남의 첨부·없음)는 미지원 안내가 아니라 오류 화면', async ({ authenticatedPage: page }) => {
    const req = await stubHwp(page, 44, [{ status: 404, notApplicable: false }])
    await openViewer(page, 44)
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

  test('NOT_APPLICABLE 404(변환 꺼짐·레거시 첨부)는 기존 미지원 안내', async ({ authenticatedPage: page }) => {
    await stubHwp(page, 45, [{ status: 404, notApplicable: true }])
    await openViewer(page, 45)
    await expect(page.getByTestId('preview-unsupported')).toBeVisible()
    await expect(page.getByTestId('preview-error')).toHaveCount(0)
  })
})
