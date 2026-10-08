// 통합 첨부 뷰어 영상·오디오(WP-281) — 데스크톱(chromium). 드라이브 묶음에서 실제 webm·mp3 를 열어 브라우저 기본 플레이어로 재생한다.
// 픽스처: e2e/fixtures/sample-10s.webm(VP8+Opus 160×120 10초)·sample-10s.mp3(10초). 재생 불가 = 쓰레기 바이트 .mov
// (실제 HEVC 는 macOS Chromium 이 하드웨어 디코더로 틀 수 있어 "재생 불가" 를 결정적으로 만들지 못한다).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Locator, Page } from '@playwright/test'

import { type DriveStubFile, stubDriveFiles } from '../../fixtures/drive-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { pausePageClock } from '../../fixtures/touch'

const SPACE_ID = 1
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEBM = fs.readFileSync(path.join(HERE, '../../fixtures/sample-10s.webm'))
const MP3 = fs.readFileSync(path.join(HERE, '../../fixtures/sample-10s.mp3'))

const VID = (id: number, name: string, extra: Partial<DriveStubFile> = {}): DriveStubFile => ({ id, name, mimeType: 'video/webm', body: WEBM, ...extra })
const AUD = (id: number, name: string): DriveStubFile => ({ id, name, mimeType: 'audio/mpeg', body: MP3 })
const BROKEN: DriveStubFile = { id: 89, name: 'broken.mov', mimeType: 'video/quicktime', body: Buffer.from('not a movie at all — garbage bytes') }

/** 목록에서 파일명을 눌러 뷰어를 연다(직접 연 항목 = 자동재생 대상). */
async function openViewer(page: Page, name: string) {
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByTestId('preview-body')).toBeVisible()
}

/** 미디어 요소의 재생 상태 스냅숏. */
const state = (el: Locator) =>
  el.evaluate((m: HTMLMediaElement) => ({ paused: m.paused, time: m.currentTime, ready: m.readyState, src: m.src }))

/** 메타데이터를 받을 때까지 기다린다(위치 복원·자동재생 판정이 끝난 뒤를 보려고). */
async function waitReady(el: Locator) {
  await expect.poll(async () => (await state(el)).ready).toBeGreaterThanOrEqual(1)
}

/** 일시정지하고 지정 위치로 옮긴 뒤 seeked 를 기다린다. */
async function pauseAt(el: Locator, t: number) {
  await el.evaluate(
    (m: HTMLMediaElement, at) =>
      new Promise<void>((res) => {
        m.pause()
        m.addEventListener('seeked', () => res(), { once: true })
        m.currentTime = at
      }),
    t,
  )
}

test('직접 연 영상은 자동재생되고 확대 툴바가 없다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [VID(80, 'clip-a.webm'), VID(81, 'clip-b.webm')], { spaceId: SPACE_ID })
  await openViewer(page, 'clip-a.webm')
  const video = page.getByTestId('media-video')
  await expect(video).toHaveAttribute('playsinline', '')
  await expect.poll(async () => (await state(video)).paused).toBe(false)
  await expect.poll(async () => (await state(video)).time).toBeGreaterThan(0)
  // 영상·오디오는 확대 대상이 아니다(스펙 §4.1).
  await expect(page.getByTestId('viewer-zoom-bar')).toHaveCount(0)
})

test('넘기면 일시정지(위치 기억) — 넘겨 온 영상·되돌아온 영상은 자동재생하지 않는다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [VID(80, 'clip-a.webm'), VID(81, 'clip-b.webm')], { spaceId: SPACE_ID })
  await openViewer(page, 'clip-a.webm')
  const video = page.getByTestId('media-video')
  await expect.poll(async () => (await state(video)).paused).toBe(false)
  // 3초 지점에서 멈춰 둔다(재생 중 위치는 흘러가므로).
  await pauseAt(video, 3)
  await page.getByRole('button', { name: '다음 파일' }).click()
  await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')
  // 넘겨 온 영상 — 자동재생은 마운트 직후 play() 로 걸리므로 메타데이터가 온 시점에 멈춰 있으면 걸리지 않은 것이다.
  await waitReady(video)
  expect(await state(video)).toMatchObject({ paused: true, time: 0 })
  // 뷰어 안 미디어는 하나뿐(이전 영상은 정리됨).
  await expect(page.locator('video, audio')).toHaveCount(1)
  await page.getByRole('button', { name: '이전 파일' }).click()
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
  await waitReady(video)
  // 되돌아온 영상 — 기억한 3초에서 정지 상태.
  await expect.poll(async () => (await state(video)).time).toBeCloseTo(3, 0)
  expect((await state(video)).paused).toBe(true)
})

test('닫으면 미디어 요소가 정리되고 blob URL 이 해제된다', async ({ authenticatedPage: page }) => {
  // revokeObjectURL 호출을 기록한다.
  await page.addInitScript(() => {
    const w = window as unknown as { __revoked: string[] }
    w.__revoked = []
    const orig = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (u: string) => {
      w.__revoked.push(u)
      orig(u)
    }
  })
  await stubDriveFiles(page, [VID(80, 'clip-a.webm')], { spaceId: SPACE_ID })
  await openViewer(page, 'clip-a.webm')
  const video = page.getByTestId('media-video')
  await expect.poll(async () => (await state(video)).paused).toBe(false)
  const { src } = await state(video)
  expect(src).toMatch(/^blob:/)
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  await expect(page.locator('video, audio')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __revoked: string[] }).__revoked)).toContain(src)
})

test('받는 동안 % 진행률을 보이고 다 받으면 플레이어로 바뀐다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [VID(80, 'slow.webm', { delayMs: 1500 })], { spaceId: SPACE_ID })
  await openViewer(page, 'slow.webm')
  const bar = page.getByRole('progressbar', { name: 'slow.webm 받는 중' })
  await expect(bar).toBeVisible()
  await expect(bar).toHaveAttribute('aria-valuenow', '0')
  await expect(page.getByTestId('media-progress-label')).toHaveText('영상 받는 중… 0%')
  await expect(page.getByTestId('media-video')).toBeVisible()
  await expect(bar).toHaveCount(0)
})

test('재생할 수 없는 영상은 미지원 화면과 다운로드로 바뀐다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [BROKEN], { spaceId: SPACE_ID })
  await openViewer(page, 'broken.mov')
  const notice = page.getByTestId('preview-unsupported')
  await expect(notice).toContainText('이 형식은 미리 볼 수 없어요')
  await expect(notice.getByRole('button', { name: '다운로드' })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
})

test('오디오는 큰 아이콘·이름·기본 플레이어로 재생된다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [AUD(82, 'voice.mp3')], { spaceId: SPACE_ID })
  await openViewer(page, 'voice.mp3')
  const view = page.getByTestId('media-audio-view')
  await expect(view).toContainText('voice.mp3')
  const audio = page.getByTestId('media-audio')
  await expect(audio).toHaveAttribute('controls', '')
  await expect.poll(async () => (await state(audio)).paused).toBe(false)
  await expect(page.getByTestId('viewer-zoom-bar')).toHaveCount(0)
})

test('자동재생이 거부되면 가운데 재생 버튼으로 폴백한다', async ({ authenticatedPage: page }) => {
  // 플래그가 켜진 동안 play() 를 NotAllowedError 로 거부한다(iOS 비동기 play 거부 흉내).
  await page.addInitScript(() => {
    const w = window as unknown as { __blockPlay: boolean }
    w.__blockPlay = true
    const orig = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (w.__blockPlay) return Promise.reject(new DOMException('blocked', 'NotAllowedError'))
      return orig.call(this)
    }
  })
  await stubDriveFiles(page, [VID(80, 'clip-a.webm')], { spaceId: SPACE_ID })
  await openViewer(page, 'clip-a.webm')
  const play = page.getByTestId('media-play-fallback')
  await expect(play).toBeVisible()
  const video = page.getByTestId('media-video')
  expect((await state(video)).paused).toBe(true)
  // 사용자가 누르면(제스처) 재생 — 버튼은 사라진다.
  await page.evaluate(() => ((window as unknown as { __blockPlay: boolean }).__blockPlay = false))
  await play.click()
  await expect.poll(async () => (await state(video)).paused).toBe(false)
  await expect(play).toHaveCount(0)
})

test.describe('키보드(스펙 §5.3 #6·#7)', () => {
  test('←/→ 는 영상 포커스면 5초 탐색(한 번만), 그 밖이면 파일 넘김', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [VID(80, 'clip-a.webm'), VID(81, 'clip-b.webm')], { spaceId: SPACE_ID })
    await openViewer(page, 'clip-a.webm')
    const video = page.getByTestId('media-video')
    await waitReady(video)
    await pauseAt(video, 1)
    await video.focus()
    await page.keyboard.press('ArrowRight')
    // 네이티브 키 처리와 겹쳤다면 11초(끝)로 갔을 것 — 정확히 한 번 5초.
    await expect.poll(async () => (await state(video)).time).toBeCloseTo(6, 0)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await state(video)).time).toBeCloseTo(1, 0)
    await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
    // 포커스를 뷰어 본체로 — ←/→ 는 파일 넘김.
    await page.getByTestId('attachment-viewer').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')
  })

  test('Space 는 재생/정지 — 버튼에 포커스가 있으면 그 버튼을 누른다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [VID(80, 'clip-a.webm'), VID(81, 'clip-b.webm')], { spaceId: SPACE_ID })
    await openViewer(page, 'clip-a.webm')
    const video = page.getByTestId('media-video')
    await expect.poll(async () => (await state(video)).paused).toBe(false)
    await page.getByTestId('attachment-viewer').focus()
    await page.keyboard.press(' ')
    await expect.poll(async () => (await state(video)).paused).toBe(true)
    await page.keyboard.press(' ')
    await expect.poll(async () => (await state(video)).paused).toBe(false)
    // 다음 파일 버튼 위 Space = 버튼 활성화(넘김), 재생 전환이 아니다.
    await page.getByRole('button', { name: '다음 파일' }).focus()
    await page.keyboard.press(' ')
    await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')
  })

  test('전체화면 중 Esc 는 전체화면만 풀고 뷰어는 닫지 않는다 — 전체화면 중 ←/→ 는 탐색', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [VID(80, 'clip-a.webm'), VID(81, 'clip-b.webm')], { spaceId: SPACE_ID })
    await openViewer(page, 'clip-a.webm')
    const video = page.getByTestId('media-video')
    await waitReady(video)
    await pauseAt(video, 1)
    // 전체화면 흉내 — 헤드리스에선 사용자 제스처 없는 requestFullscreen 이 거부되므로 fullscreenElement·exitFullscreen 을 대신한다.
    // 실제 브라우저처럼 해제 때 fullscreenchange 를 쏜다(가드가 그 시각을 본다).
    await video.evaluate((v) => {
      let fs: Element | null = v
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fs })
      document.exitFullscreen = () => {
        fs = null
        document.dispatchEvent(new Event('fullscreenchange'))
        return Promise.resolve()
      }
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    // 포커스가 영상 밖(뷰어 본체)이어도 전체화면 중이면 탐색.
    await page.getByTestId('attachment-viewer').focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await state(video)).time).toBeCloseTo(6, 0)
    await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
    // 페이지 시계를 멈춘다 — 해제 직후 가드(500ms)를 벽시계 지연과 무관하게 보려고(performance.now 도 멈춘다).
    await pausePageClock(page)
    await page.keyboard.press('Escape')
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
    await expect(page.getByTestId('attachment-viewer')).toBeVisible()
    // 해제 직후(가드 시간 안) 한 번 더 온 Esc 도 닫지 않는다 — 브라우저가 해제에 쓴 Esc 가 늦게 오는 경우.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('attachment-viewer')).toBeVisible()
    // 가드 시간이 지난 Esc 는 평소처럼 닫는다.
    await page.clock.runFor(600)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  })
})
