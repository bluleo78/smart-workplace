// 메일 첨부 → 통합 첨부 뷰어 모바일(WP-280) — iPhone 13 뷰포트 + chromium(coarse 포인터).
// 전체 화면 뷰어·하단 4칸(드라이브·요약 칸 비움)·스와이프 넘김, 그리고 뒤로가기가 뷰어 → 메일 상세 → 목록 순으로 한 겹씩 닫는지(back-mail.spec 과 같은 기대).
import type { Page } from '@playwright/test'

import { stubMailWithAttachments } from '../../fixtures/mail-viewer-mock'
import { expect, test } from '../../fixtures/mobile.fixture'
import { centerOf, touchDrag } from '../../fixtures/touch'

/** 받은편지함 → 10번 메일 → 첨부 칩을 탭해 뷰어를 연다. */
async function openAttachment(page: Page, id: number) {
  await page.goto('/mail/1')
  await page.getByTestId('mail-row-10').click()
  await expect(page.getByTestId('mail-detail')).toBeVisible()
  await page.getByTestId(`mail-attachment-open-${id}`).tap()
  await expect(page.getByTestId('attachment-viewer')).toBeVisible()
}

test('첨부를 탭하면 전체 화면 뷰어 — 스와이프·‹ 로 넘기고 ⬇ 저장으로 받는다', async ({ authenticatedPage: page }) => {
  await stubMailWithAttachments(page)
  await openAttachment(page, 6)
  await expect(page.getByTestId('pdf-page-1')).toBeVisible()
  // 묶음 = 목록 첨부 2개(본문 인라인 이미지 제외).
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')

  // 하단 4칸: 저장 칸이 있고 드라이브·요약 칸은 비어 있다(위치는 고정). 링크 공유 불가라 ⋯ 도 없다.
  const bar = page.getByTestId('viewer-action-bar')
  await expect(bar.getByTestId('preview-download')).toBeVisible()
  await expect(bar.locator('[data-slot-id="drive"]')).toHaveAttribute('data-state', 'empty')
  await expect(bar.locator('[data-slot-id="summary"]')).toHaveAttribute('data-state', 'empty')
  await expect(page.getByTestId('viewer-top-bar').getByRole('button', { name: '더 보기' })).toHaveCount(0)

  // 왼쪽으로 밀어 다음(텍스트), ‹ 로 이전(PDF).
  const c = await centerOf(page.getByTestId('viewer-stage'))
  await touchDrag(page, c, { x: c.x - 180, y: c.y })
  await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')
  await expect(page.getByTestId('preview-body')).toContainText('회의 메모 본문입니다')

  const download = page.waitForEvent('download')
  await bar.getByTestId('preview-download').tap()
  expect((await download).suggestedFilename()).toBe('memo.txt')

  await page.getByRole('button', { name: '이전 파일' }).tap()
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
})

test('뒤로가기는 뷰어만 닫고 메일 상세에 남는다 — 한 번 더 뒤로가면 받은편지함', async ({ authenticatedPage: page }) => {
  await stubMailWithAttachments(page)
  await openAttachment(page, 7)
  await expect(page).toHaveURL(/\/mail\/1\?messageId=10&preview=mail%3A7$/)

  await page.goBack()
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  await expect(page).toHaveURL(/\/mail\/1\?messageId=10$/)
  await expect(page.getByTestId('mail-detail')).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/mail\/1$/)
  await expect(page.getByTestId('mail-list')).toBeVisible()
})

test('✕ 로 닫아도 메일 상세에 남고, 상세 ‹ 는 받은편지함으로', async ({ authenticatedPage: page }) => {
  await stubMailWithAttachments(page)
  await openAttachment(page, 6)

  await page.getByTestId('viewer-top-bar').getByRole('button', { name: '닫기' }).tap()
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  await expect(page).toHaveURL(/\/mail\/1\?messageId=10$/)
  await expect(page.getByTestId('mail-detail')).toBeVisible()

  await page.getByTestId('mail-back').getByTestId('mobile-back').click()
  await expect(page).toHaveURL(/\/mail\/1$/)
  await expect(page.getByTestId('mail-list')).toBeVisible()
})
