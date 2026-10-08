// 통합 첨부 뷰어 영상·오디오 모바일(WP-281) — iPhone 13 뷰포트 + chromium(coarse 포인터). 터치는 CDP(e2e/fixtures/touch.ts)로만 만든다.
// 확인: 영상 위 탭 = 바 유지(컨트롤 몫)·영상 밖 여백 탭 = 바 토글, 재생 막대 구역 가로 끌기 = 넘기지 않음,
// 오디오 탭 = 바 유지, 재생 3초 뒤 바 자동 숨김, 영상은 하단 액션 바 위 영역에 놓인다.

import type { Locator, Page } from '@playwright/test'

import { audioFile, type DriveStubFile, stubDriveFiles, videoFile } from '../../fixtures/drive-mock'
import { expect, test } from '../../fixtures/mobile.fixture'
import { centerOf, pausePageClock, touchDrag, touchTap } from '../../fixtures/touch'

const SPACE_ID = 1


/** 목록에서 파일명을 탭해 뷰어를 연다(직접 연 항목 = 자동재생). */
async function openViewer(page: Page, name: string) {
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name, exact: true }).tap()
  await expect(page.getByTestId('preview-body')).toBeVisible()
}

/** 재생 상태 스냅숏. */
const media = (el: Locator) => el.evaluate((m: HTMLMediaElement) => ({ paused: m.paused, time: m.currentTime, ready: m.readyState }))

/** 자동재생이 시작된 뒤 멈춘다 — 재생 중 3초 자동 숨김이 바 토글 확인에 끼어들지 않게. */
async function playedThenPaused(el: Locator) {
  await expect.poll(async () => (await media(el)).paused).toBe(false)
  await el.evaluate((m: HTMLMediaElement) => m.pause())
}

/** 바가 숨겨졌는가(inert). */
const topBar = (page: Page) => page.getByTestId('viewer-top-bar')

test('영상은 하단 액션 바 위 영역에 맞춰 놓이고 확대 툴바가 없다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [videoFile(80, 'clip-a.webm')], { spaceId: SPACE_ID })
  await openViewer(page, 'clip-a.webm')
  const video = page.getByTestId('media-video')
  await expect.poll(async () => (await media(video)).ready).toBeGreaterThanOrEqual(1)
  await expect(video).toHaveAttribute('playsinline', '')
  // 맞춤 크기 계산 후 — 영상 아래 끝이 액션 바 위, 위 끝이 상단 바 아래(네이티브 재생 막대가 우리 바에 가리지 않음).
  await expect.poll(async () => (await video.boundingBox())!.width).toBeGreaterThan(300)
  const v = (await video.boundingBox())!
  const bar = (await page.getByTestId('viewer-action-bar').boundingBox())!
  const top = (await topBar(page).boundingBox())!
  expect(v.y + v.height).toBeLessThanOrEqual(bar.y + 1)
  expect(v.y).toBeGreaterThanOrEqual(top.y + top.height - 1)
  await expect(page.getByTestId('viewer-zoom-bar')).toHaveCount(0)
})

test('영상 위 탭은 바를 숨기지 않고, 영상 밖 여백 탭은 바를 토글한다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [videoFile(80, 'clip-a.webm'), videoFile(81, 'clip-b.webm')], { spaceId: SPACE_ID })
  await openViewer(page, 'clip-a.webm')
  const video = page.getByTestId('media-video')
  await playedThenPaused(video)
  // 탭 판정 지연(300ms)을 결정적으로 넘기려고 시계를 멈춘다.
  await pausePageClock(page)
  // 영상 위쪽(재생 막대 구역 밖) 탭 — 네이티브 컨트롤 표시 몫, 바는 그대로.
  const v = (await video.boundingBox())!
  await touchTap(page, { x: v.x + v.width / 2, y: v.y + 20 })
  await page.clock.runFor(400)
  await expect(topBar(page)).not.toHaveAttribute('inert', '')
  // 영상 아래 여백 탭 — 바 토글.
  const body = (await page.getByTestId('preview-body').boundingBox())!
  const gapY = (v.y + v.height + body.y + body.height) / 2
  expect(gapY).toBeGreaterThan(v.y + v.height + 10)
  await touchTap(page, { x: v.x + v.width / 2, y: gapY })
  await page.clock.runFor(400)
  await expect(topBar(page)).toHaveAttribute('inert', '')
})

test('재생 막대 구역(영상 아래 48px)에서 가로로 끌면 넘기지 않고, 영상 위쪽에서 끌면 넘긴다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [videoFile(80, 'clip-a.webm'), videoFile(81, 'clip-b.webm')], { spaceId: SPACE_ID })
  await openViewer(page, 'clip-a.webm')
  const video = page.getByTestId('media-video')
  await playedThenPaused(video)
  const v = (await video.boundingBox())!
  // 재생 막대 높이 안(아래 끝에서 20px) — 좌→우로 길게 끈다.
  const y = v.y + v.height - 20
  const before = (await media(video)).time
  await touchDrag(page, { x: v.x + 60, y }, { x: v.x + v.width - 40, y })
  await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
  // 네이티브 재생 막대 끌기는 살아 있다(무대 touch-action none 이어도 컨트롤이 받는다) — 위치가 앞으로 크게 옮겨졌다.
  await expect.poll(async () => (await media(video)).time).toBeGreaterThan(before + 3)
  // 무대가 손가락을 따라 움직이지도 않았다(넘김으로 잠기지 않음).
  await expect(page.getByTestId('viewer-stage')).not.toHaveAttribute('style', /translate/)
  // 영상 위쪽 — 넘김.
  const c = await centerOf(video)
  await touchDrag(page, { x: c.x + 100, y: v.y + 30 }, { x: c.x - 120, y: v.y + 30 })
  await expect(page.getByTestId('preview-meta')).toHaveText('2 / 2')
  // 넘겨 온 영상은 자동재생하지 않는다.
  await expect.poll(async () => (await media(video)).ready).toBeGreaterThanOrEqual(1)
  expect((await media(video)).paused).toBe(true)
})

test('오디오는 어디를 탭해도 바를 숨기지 않는다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [audioFile(82, 'voice.mp3')], { spaceId: SPACE_ID })
  await openViewer(page, 'voice.mp3')
  const audio = page.getByTestId('media-audio')
  await playedThenPaused(audio)
  await pausePageClock(page)
  // 큰 아이콘 쪽(플레이어 밖)과 무대 빈 곳.
  const view = (await page.getByTestId('media-audio-view').boundingBox())!
  await touchTap(page, { x: view.x + view.width / 2, y: view.y + 10 })
  await page.clock.runFor(400)
  const stage = (await page.getByTestId('viewer-stage').boundingBox())!
  await touchTap(page, { x: stage.x + stage.width / 2, y: stage.y + stage.height - 120 })
  await page.clock.runFor(400)
  await expect(topBar(page)).not.toHaveAttribute('inert', '')
})

test('영상 재생이 시작되고 3초 뒤 바가 자동으로 숨는다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [videoFile(80, 'clip-a.webm')], { spaceId: SPACE_ID })
  await openViewer(page, 'clip-a.webm')
  const video = page.getByTestId('media-video')
  await expect.poll(async () => (await media(video)).paused).toBe(false)
  // 재생 직후엔 보이고, 3초(AUTO_HIDE_BARS_MS) 뒤 숨는다 — 조건 대기(벽시계 3초).
  await expect(topBar(page)).not.toHaveAttribute('inert', '')
  await expect(topBar(page)).toHaveAttribute('inert', '', { timeout: 8000 })
  await expect(page.getByTestId('viewer-action-bar')).toHaveAttribute('inert', '')
  // 재생 중에만 숨는다 — 일시정지하면 바가 돌아온다(사용자 선호를 바꾸지 않음).
  await video.evaluate((m: HTMLMediaElement) => m.pause())
  await expect(topBar(page)).not.toHaveAttribute('inert', '')
})

test('가로 모드에서도 오디오는 바가 보인다(탭으로 되살릴 수 없으므로 숨기지 않음)', async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await stubDriveFiles(page, [audioFile(82, 'voice.mp3')], { spaceId: SPACE_ID })
  await openViewer(page, 'voice.mp3')
  await expect(page.getByTestId('media-audio')).toBeVisible()
  await expect(topBar(page)).not.toHaveAttribute('inert', '')
  await expect(page.getByTestId('viewer-action-bar')).not.toHaveAttribute('inert', '')
  await expect(topBar(page).getByRole('button', { name: '닫기' })).toBeVisible()
})

test('재생할 수 없는 영상은 미디어로 다루지 않는다 — 무대가 문서 규칙(manipulation)', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [{ id: 89, name: 'broken.mov', mimeType: 'video/quicktime', body: Buffer.from('garbage bytes, not a movie') }], {
    spaceId: SPACE_ID,
  })
  await openViewer(page, 'broken.mov')
  await expect(page.getByTestId('preview-unsupported')).toBeVisible()
  await expect(page.getByTestId('viewer-stage')).toHaveAttribute('data-viewer-stage', 'manipulation')
})

test('가로 모드 — 넘침 없이 영상이 화면 안에 들어온다(영상 높이 비율 기록)', async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await stubDriveFiles(page, [videoFile(80, 'clip-a.webm')], { spaceId: SPACE_ID })
  await openViewer(page, 'clip-a.webm')
  const video = page.getByTestId('media-video')
  await expect.poll(async () => (await media(video)).ready).toBeGreaterThanOrEqual(1)
  // 가로는 바 기본 숨김(WP-278) — 여백(M8)은 유지하므로 영상은 바 자리를 비운 높이에 맞춰진다.
  await expect(topBar(page)).toHaveAttribute('inert', '')
  await expect.poll(async () => (await video.boundingBox())!.height).toBeGreaterThan(100)
  const v = (await video.boundingBox())!
  expect(v.y).toBeGreaterThanOrEqual(0)
  expect(v.y + v.height).toBeLessThanOrEqual(390)
  // 가로 넘침 없음(문서·본문 모두).
  const overflow = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="preview-body"]') as HTMLElement
    return { doc: document.documentElement.scrollWidth > window.innerWidth, body: b.scrollWidth > b.clientWidth || b.scrollHeight > b.clientHeight }
  })
  expect(overflow).toEqual({ doc: false, body: false })
  test.info().annotations.push({ type: 'landscape-video-height-ratio', description: (v.height / 390).toFixed(2) })
})

for (const width of [360, 390]) {
  test(`폭 ${width}px — 영상 요소가 맞춤 상자와 같고(변형 없음) ‹ › 가 영상을 덮지 않는다`, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width, height: 780 })
    await stubDriveFiles(page, [videoFile(80, 'clip-a.webm'), videoFile(81, 'clip-b.webm')], { spaceId: SPACE_ID })
    await openViewer(page, 'clip-a.webm')
    const video = page.getByTestId('media-video')
    await expect(video).toBeVisible()
    const m = await video.evaluate((v: HTMLVideoElement) => {
      const p = v.parentElement!
      const cs = getComputedStyle(p)
      const cw = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const ch = p.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      const scale = Math.min(cw / v.videoWidth, ch / v.videoHeight)
      const r = v.getBoundingClientRect()
      return { w: r.width, h: r.height, ew: Math.floor(v.videoWidth * scale), eh: Math.floor(v.videoHeight * scale), tr: getComputedStyle(v).transform }
    })
    expect(m.tr).toBe('none')
    expect(Math.abs(m.w - m.ew)).toBeLessThanOrEqual(1)
    expect(Math.abs(m.h - m.eh)).toBeLessThanOrEqual(1)
    const v = (await video.boundingBox())!
    const next = (await page.getByRole('button', { name: '다음 파일' }).boundingBox())!
    expect(next.width).toBeGreaterThanOrEqual(44)
    // 화살표는 영상 오른쪽 바깥(겹치지 않음).
    expect(next.x).toBeGreaterThanOrEqual(v.x + v.width)
  })
}

test('오디오도 ‹ › 가 플레이어를 덮지 않는다', async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await stubDriveFiles(page, [audioFile(82, 'voice.mp3'), videoFile(80, 'clip-a.webm')], { spaceId: SPACE_ID })
  await openViewer(page, 'voice.mp3')
  const a = (await page.getByTestId('media-audio').boundingBox())!
  const next = (await page.getByRole('button', { name: '다음 파일' }).boundingBox())!
  expect(next.x).toBeGreaterThanOrEqual(a.x + a.width)
})
