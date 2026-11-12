// 통합 첨부 뷰어 영상·오디오(WP-281) — 데스크톱(chromium). 드라이브 묶음에서 실제 webm·mp3 를 열어 브라우저 기본 플레이어로 재생한다.
// 실제 미디어 디코드·재생·서명 재생 주소 Range(206) 받기(@platform, WP-1532), 영상 키보드 처리(@input), 플레이어 크기(@layout) — 모두 브라우저가 있어야 판정된다(WP-984).
// 픽스처: e2e/fixtures/sample-10s.webm(VP8+Opus 160×120 10초)·sample-10s.mp3(10초). 재생 불가 = 쓰레기 바이트 .mov
// (실제 HEVC 는 macOS Chromium 이 하드웨어 디코더로 틀 수 있어 "재생 불가" 를 결정적으로 만들지 못한다).

import type { Locator, Page } from '@playwright/test'

import { audioFile, type DriveStubFile, isPlaybackPath, stubDriveFiles, videoFile } from '../../fixtures/drive-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { SAMPLE_WEBM } from '../../fixtures/samples'
import { pausePageClock } from '../../fixtures/touch'

const SPACE_ID = 1

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

test('직접 연 영상은 자동재생되고 확대 툴바가 없다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [videoFile(80, 'clip-a.webm'), videoFile(81, 'clip-b.webm')], { spaceId: SPACE_ID })
  await openViewer(page, 'clip-a.webm')
  const video = page.getByTestId('media-video')
  await expect(video).toHaveAttribute('playsinline', '')
  await expect.poll(async () => (await state(video)).paused).toBe(false)
  await expect.poll(async () => (await state(video)).time).toBeGreaterThan(0)
  // 영상·오디오는 확대 대상이 아니다(스펙 §4.1).
  await expect(page.getByTestId('viewer-zoom-bar')).toHaveCount(0)
})

test('넘기면 일시정지(위치 기억) — 넘겨 온 영상·되돌아온 영상은 자동재생하지 않는다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [videoFile(80, 'clip-a.webm'), videoFile(81, 'clip-b.webm')], { spaceId: SPACE_ID })
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

test('큰 영상은 다 받기를 기다리지 않고 서명 재생 주소로 Range(206) 재생하고, 탐색해도 이어 재생된다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  // WP-1532 — 600MB 로 보이는 영상(실제 본문은 10초 webm 78KB). 10MB 확인·받는 중 % 없이 곧바로 재생 주소를 <video src> 에 넣는다.
  // 목 서버는 범위 응답을 16KB 씩·요청마다 250ms 늦게 보내 영상을 여러 번에 나눠 받게 한다 — 다 받기 전에 재생이 시작되는지 본다.
  const total = SAMPLE_WEBM.length
  await stubDriveFiles(
    page,
    [videoFile(80, 'big.webm', { sizeBytes: 600 * 1024 * 1024, rangeChunkBytes: 16 * 1024, delayMs: 250 })],
    { spaceId: SPACE_ID },
  )
  const ranges: (string | undefined)[] = []
  const served: [number, number][] = []
  const statuses: number[] = []
  const contentCalls: string[] = []
  const issued: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (isPlaybackPath(u.pathname, 80)) ranges.push(r.headers()['range'])
    if (u.pathname === '/api/v1/drive/files/80/content') contentCalls.push(r.url())
    if (u.pathname === '/api/v1/drive/files/80/playback-url') issued.push(r.method())
  })
  page.on('response', (r) => {
    if (!isPlaybackPath(new URL(r.url()).pathname, 80)) return
    statuses.push(r.status())
    const m = /bytes (\d+)-(\d+)\//.exec(r.headers()['content-range'] ?? '')
    if (m) served.push([Number(m[1]), Number(m[2])])
  })
  const coveredBytes = () => {
    const hit = new Set<number>()
    for (const [a, b] of served) for (let i = a; i <= b; i++) hit.add(i)
    return hit.size
  }
  await openViewer(page, 'big.webm')
  const video = page.getByTestId('media-video')
  await expect.poll(async () => (await state(video)).time).toBeGreaterThan(0)
  // 재생이 시작된 순간 아직 파일 전체를 받지 않았다(통째로 받는 blob 경로라면 불가능).
  expect(coveredBytes()).toBeLessThan(total)
  expect(isPlaybackPath(new URL((await state(video)).src).pathname, 80)).toBe(true)
  await expect(page.getByTestId('preview-size-confirm')).toHaveCount(0)
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  // 브라우저가 범위 요청으로 받고 서버(목)가 206 으로 응답했다 — iOS Safari 는 영상에 206 을 요구한다.
  expect(ranges.every((r) => r?.startsWith('bytes='))).toBe(true)
  expect(statuses.length).toBeGreaterThan(1)
  expect(statuses.every((st) => st === 206)).toBe(true)
  // 탐색 — 뒤쪽(8초)으로 옮기면 그 구간을 범위 요청으로 받아 그 위치부터 이어 재생된다(같은 주소, 재발급 없음).
  await pauseAt(video, 8)
  await video.evaluate((m: HTMLMediaElement) => m.play())
  await expect.poll(async () => (await state(video)).time).toBeGreaterThan(8)
  expect(served.some(([a]) => a > total / 2)).toBe(true)
  // 원본 blob 은 받지 않고, 발급(=열람 감사)은 한 번만.
  expect(contentCalls).toHaveLength(0)
  expect(issued).toEqual(['POST'])
})

test('닫으면 미디어 요소가 정리되고 재생 주소 요청을 놓는다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [videoFile(80, 'clip-a.webm')], { spaceId: SPACE_ID })
  await openViewer(page, 'clip-a.webm')
  const video = page.getByTestId('media-video')
  await expect.poll(async () => (await state(video)).paused).toBe(false)
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  await expect(page.locator('video, audio')).toHaveCount(0)
})

test('재생 주소 발급이 거절되면(권한·휴지통) 오류 화면과 다시 시도·다운로드', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [videoFile(80, 'gone.webm', { playbackStatus: 404 })], { spaceId: SPACE_ID })
  await openViewer(page, 'gone.webm')
  const err = page.getByTestId('preview-error')
  await expect(err).toContainText('미리보기를 불러오지 못했습니다.')
  await expect(err.getByRole('button', { name: '다시 시도' })).toBeVisible()
  await expect(err.getByRole('button', { name: '다운로드' })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
})

test('재생할 수 없는 영상은 미지원 화면과 다운로드로 바뀐다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [BROKEN], { spaceId: SPACE_ID })
  const issued: string[] = []
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === `/api/v1/drive/files/${BROKEN.id}/playback-url`) issued.push(r.method())
  })
  await openViewer(page, 'broken.mov')
  const notice = page.getByTestId('preview-unsupported')
  await expect(notice).toContainText('이 형식은 미리 볼 수 없어요')
  // WP-1532: 첫 오류에 주소를 한 번 다시 받아(만료·새 버전 대비) 시도하고, 그래도 안 되면 미지원 — 되풀이하지 않는다.
  expect(issued).toEqual(['POST', 'POST'])
  await expect(notice.getByRole('button', { name: '다운로드' })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
  // 안내는 본문 가운데(미디어 본문은 flex — m-auto 없으면 왼쪽 위에 붙는다).
  const n = (await notice.boundingBox())!
  const b = (await page.getByTestId('preview-body').boundingBox())!
  expect(Math.abs(n.x + n.width / 2 - (b.x + b.width / 2))).toBeLessThan(4)
  expect(n.y).toBeGreaterThan(b.y + 40)
})

test('오디오는 큰 아이콘·이름·기본 플레이어로 재생된다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [audioFile(82, 'voice.mp3')], { spaceId: SPACE_ID })
  await openViewer(page, 'voice.mp3')
  const view = page.getByTestId('media-audio-view')
  await expect(view).toContainText('voice.mp3')
  const audio = page.getByTestId('media-audio')
  await expect(audio).toHaveAttribute('controls', '')
  await expect(audio).toHaveAttribute('aria-label', 'voice.mp3')
  await expect.poll(async () => (await state(audio)).paused).toBe(false)
  await expect(page.getByTestId('viewer-zoom-bar')).toHaveCount(0)
})

test('자동재생이 거부되면 가운데 재생 버튼으로 폴백한다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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
  await stubDriveFiles(page, [videoFile(80, 'clip-a.webm')], { spaceId: SPACE_ID })
  await openViewer(page, 'clip-a.webm')
  const play = page.getByTestId('media-play-fallback')
  await expect(play).toBeVisible()
  const video = page.getByTestId('media-video')
  expect((await state(video)).paused).toBe(true)
  await expect(play).toHaveAccessibleName('clip-a.webm 재생')
  await expect(page.getByTestId('media-blocked-live')).toHaveText('자동 재생이 막혀 있어요 — 재생을 눌러 주세요')
  // 사용자가 누르면(제스처) 재생 — 버튼은 사라진다.
  await page.evaluate(() => ((window as unknown as { __blockPlay: boolean }).__blockPlay = false))
  await play.click()
  await expect.poll(async () => (await state(video)).paused).toBe(false)
  await expect(play).toHaveCount(0)
})

test('오디오 자동재생이 거부되면 버튼을 겹쳐 더하지 않고 짧은 안내만 보인다(기본 플레이어 재생 버튼이 있으므로)', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'))
  })
  await stubDriveFiles(page, [audioFile(82, 'voice.mp3')], { spaceId: SPACE_ID })
  await openViewer(page, 'voice.mp3')
  const hint = page.getByTestId('media-blocked-hint')
  await expect(hint).toHaveText('자동 재생이 막혀 있어요 — 재생을 눌러 주세요')
  await expect(hint).toHaveAttribute('aria-live', 'polite')
  await expect(page.getByTestId('media-play-fallback')).toHaveCount(0)
  // 안내는 플레이어 아래 — 이름·플레이어를 가리지 않는다.
  const h = (await hint.boundingBox())!
  const a = (await page.getByTestId('media-audio').boundingBox())!
  expect(h.y).toBeGreaterThanOrEqual(a.y + a.height)
})

test('영상 요소는 맞춤 상자와 같은 크기(변형 없음) — 기본 컨트롤이 영상 폭 전체에 걸친다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [videoFile(80, 'clip-a.webm')], { spaceId: SPACE_ID })
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
})

test.describe('키보드(스펙 §5.3 #6·#7)', { tag: '@input' }, () => {
  test('←/→ 는 영상 포커스면 5초 탐색(한 번만), 그 밖이면 파일 넘김', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [videoFile(80, 'clip-a.webm'), videoFile(81, 'clip-b.webm')], { spaceId: SPACE_ID })
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
    await stubDriveFiles(page, [videoFile(80, 'clip-a.webm'), videoFile(81, 'clip-b.webm')], { spaceId: SPACE_ID })
    await openViewer(page, 'clip-a.webm')
    const video = page.getByTestId('media-video')
    await expect.poll(async () => (await state(video)).paused).toBe(false)
    await page.getByTestId('attachment-viewer').focus()
    await page.keyboard.press(' ')
    await expect.poll(async () => (await state(video)).paused).toBe(true)
    await page.keyboard.press(' ')
    await expect.poll(async () => (await state(video)).paused).toBe(false)
    // 영상 자체에 포커스(클릭으로 들어간 흔한 경로) — 네이티브 Space 처리와 겹치면 두 번 뒤집혀 그대로 재생 중일 것.
    await video.focus()
    await page.keyboard.press(' ')
    await expect.poll(async () => (await state(video)).paused).toBe(true)
    // 다음 파일 버튼 위 Space = 버튼 활성화(넘김), 재생 전환이 아니다.
    await page.getByRole('button', { name: '다음 파일' }).focus()
    await page.keyboard.press(' ')
    await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')
  })

  test('전체화면 중 Esc 는 전체화면만 풀고 뷰어는 닫지 않는다 — 전체화면 중 ←/→ 는 탐색', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [videoFile(80, 'clip-a.webm'), videoFile(81, 'clip-b.webm')], { spaceId: SPACE_ID })
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

  test('네이티브 버튼으로 전체화면을 풀었으면 바로 누른 Esc 는 뷰어를 닫는다(가드는 Esc 해제에만)', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [videoFile(80, 'clip-a.webm')], { spaceId: SPACE_ID })
    await openViewer(page, 'clip-a.webm')
    const video = page.getByTestId('media-video')
    await waitReady(video)
    await pausePageClock(page)
    // 전체화면 진입 → (Esc 없이) 해제 — 컨트롤의 전체화면 해제 버튼 흉내.
    await video.evaluate((v) => {
      let fs: Element | null = v
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fs })
      document.dispatchEvent(new Event('fullscreenchange'))
      fs = null
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    await page.getByTestId('attachment-viewer').focus()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  })

  test('재생할 수 없는 영상에서는 Space 를 가로채지 않는다(미디어로 다루지 않음)', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [BROKEN], { spaceId: SPACE_ID })
    await openViewer(page, 'broken.mov')
    await expect(page.getByTestId('preview-unsupported')).toBeVisible()
    await page.getByTestId('attachment-viewer').focus()
    const prevented = await page.evaluate(
      () =>
        new Promise<boolean>((res) => {
          window.addEventListener('keydown', (e) => res(e.defaultPrevented), { once: true })
          document.querySelector<HTMLElement>('[data-testid="attachment-viewer"]')!.dispatchEvent(
            new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
          )
        }),
    )
    expect(prevented).toBe(false)
  })
})
