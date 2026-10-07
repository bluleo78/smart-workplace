// 통합 첨부 뷰어 모바일 배치·제스처(WP-278) — iPhone 13 뷰포트 + chromium(coarse 포인터).
// 터치는 CDP(e2e/fixtures/touch.ts)로만 만든다 — page.mouse 는 Touch Events·touch-action 경로를 타지 않는다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Page } from '@playwright/test'

import { createSpace, personalSpace } from '../../factories/drive.factory'
import { json } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'
import { solidPng } from '../../fixtures/png'

const SPACE_ID = 1
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PDF = fs.readFileSync(path.join(HERE, '../../fixtures/sample-3p.pdf'))

interface StubFile {
  id: number
  name: string
  mimeType: string
  body: string | Buffer
  /** 요약 응답 — 숫자면 그 HTTP 상태(403 = ✨ 숨김), 없으면 DONE 요약. */
  summary?: number | { summary: string | null; status: string }
  /** 콘텐츠 응답 지연(ms) — 공유 "받는 중" 확인용. */
  delayMs?: number
}

/** 드라이브 공간·목록·파일별 콘텐츠/썸네일/요약/참조된 곳을 막는다. */
async function stubDriveFiles(page: Page, files: StubFile[]) {
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json([personalSpace(), createSpace()])) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/drive/quota', (r) => r.fulfill(json({ usedBytes: 0, quotaBytes: 10737418240 })))
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`, (r) =>
    r.fulfill(json({
      folders: [],
      files: files.map((f) => ({
        id: f.id, folderId: null, fileId: f.id + 1000, name: f.name, mimeType: f.mimeType,
        sizeBytes: Buffer.byteLength(f.body), category: 'TEXT', createdAt: '2026-01-01T00:00:00Z',
      })),
    })))
  for (const f of files) {
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/content`, async (r) => {
      if (f.delayMs) await new Promise((res) => setTimeout(res, f.delayMs))
      await r.fulfill({ status: 200, contentType: f.mimeType, body: f.body }).catch(() => {})
    })
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/download`, (r) =>
      r.fulfill({ status: 200, contentType: f.mimeType, body: f.body }))
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/thumbnail`, (r) => r.fulfill({ status: 404 }))
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/summary`, (r) =>
      typeof f.summary === 'number'
        ? r.fulfill({ status: f.summary, body: '' })
        : r.fulfill(json(f.summary ?? { summary: '핵심 요약입니다.', status: 'DONE' })))
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/backlinks`, (r) => r.fulfill(json([])))
  }
}

/** 목록에서 파일명을 탭해 뷰어를 연다. */
async function openViewer(page: Page, name: string) {
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name, exact: true }).tap()
  await expect(page.getByTestId('preview-body')).toBeVisible()
}

const IMG = (id: number, name = `사진${id}.png`): StubFile => ({ id, name, mimeType: 'image/png', body: solidPng(800, 600) })
const MD = (id: number, name = `메모${id}.md`, body = '# 제목\n\n본문'): StubFile => ({ id, name, mimeType: 'text/markdown', body })

test.describe('모바일 배치', () => {
  for (const width of [360, 390]) {
    test(`폭 ${width}px — 상단 바(✕·이름·순번·⋯)와 하단 4칸, 가로 넘침 없음`, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width, height: 800 })
      await stubDriveFiles(page, [IMG(70), IMG(71), MD(72)])
      await openViewer(page, '사진70.png')
      const top = page.getByTestId('viewer-top-bar')
      await expect(top.getByRole('button', { name: '닫기' })).toBeVisible()
      await expect(page.getByTestId('preview-meta')).toHaveText('1 / 3')
      // 4칸 순서·폭 — 각 칸이 바 폭의 1/4.
      const bar = page.getByTestId('viewer-action-bar')
      const ids = await bar.locator('[data-slot-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-slot-id')))
      expect(ids).toEqual(['save', 'share', 'drive', 'summary'])
      for (const id of ids) {
        const b = (await bar.locator(`[data-slot-id="${id}"]`).boundingBox())!
        expect(Math.abs(b.width - width / 4)).toBeLessThan(2)
      }
      // 드라이브 파일은 ☁ 없음(빈칸), ✨ 있음.
      await expect(bar.locator('[data-slot-id="drive"]')).toHaveAttribute('data-state', 'empty')
      await expect(page.getByTestId('viewer-slot-summary')).toBeEnabled()
      // 모바일은 플로팅 확대 툴바가 없다(판정 R8).
      await expect(page.getByRole('button', { name: '확대' })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  test('가로 모드(844×390)도 넘침 없이 전체 화면', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await stubDriveFiles(page, [IMG(70)])
    await openViewer(page, '사진70.png')
    const box = (await page.getByTestId('attachment-viewer').boundingBox())!
    expect(Math.round(box.width)).toBe(844)
    expect(Math.round(box.height)).toBe(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('넘겨도 하단 칸 위치가 변하지 않는다 — ✨ 가 없는 파일은 그 칸만 비운다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), { ...IMG(71), summary: 403 }])
    await openViewer(page, '사진70.png')
    const bar = page.getByTestId('viewer-action-bar')
    await expect(page.getByTestId('viewer-slot-summary')).toBeVisible()
    const before = await Promise.all(['save', 'share', 'drive', 'summary'].map((id) => bar.locator(`[data-slot-id="${id}"]`).boundingBox()))
    await page.getByRole('button', { name: '다음 파일' }).tap()
    await expect(page.getByTestId('preview-meta')).toHaveText('2 / 2')
    await expect(bar.locator('[data-slot-id="summary"]')).toHaveAttribute('data-state', 'empty')
    const after = await Promise.all(['save', 'share', 'drive', 'summary'].map((id) => bar.locator(`[data-slot-id="${id}"]`).boundingBox()))
    for (let k = 0; k < 4; k++) {
      expect(after[k]!.x).toBeCloseTo(before[k]!.x, 0)
      expect(after[k]!.width).toBeCloseTo(before[k]!.width, 0)
    }
  })

  test('⬇ 저장은 파일을 내려받는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(72, 'note.md')])
    await openViewer(page, 'note.md')
    const download = page.waitForEvent('download')
    await page.getByTestId('preview-download').tap()
    expect((await download).suggestedFilename()).toBe('note.md')
  })

  test('열린 동안 상태바(theme-color)는 검정, 닫으면 원래 색으로 돌아온다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70)])
    const color = () => page.locator('meta[name="theme-color"]').getAttribute('content')
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    const original = await color()
    await page.getByRole('button', { name: '사진70.png', exact: true }).tap()
    await expect(page.getByTestId('preview-body')).toBeVisible()
    await expect.poll(color).toBe('#000000')
    await page.getByTestId('viewer-top-bar').getByRole('button', { name: '닫기' }).tap()
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
    await expect.poll(color).toBe(original)
  })
})
