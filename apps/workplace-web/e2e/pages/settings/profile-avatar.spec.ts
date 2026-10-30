// 프로필 아바타 자르기(WP-1222) E2E — 실제 브라우저 입력만 남긴다(@input): 진짜 이미지 디코딩(naturalWidth) 뒤 포인터로 끌기와
// 휠 확대(passive:false 로 단 리스너)가 원본 픽셀 자른 영역(cropX·cropY·cropSize)으로 multipart 에 실린다.
// 파일 검사·슬라이더·화살표 키·되돌리기·갱신은 src/pages/settings/profileSettings.test.tsx, 기하는 src/lib/avatarCrop.test.ts 가 지킨다.
import type { Page } from '@playwright/test'

import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

/** 브라우저 캔버스로 width×height 단색 PNG 를 만든다 — 저장소에 바이너리 픽스처를 두지 않으려고. */
async function makePng(page: Page, width: number, height: number): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([w, h]) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')!
      g.fillStyle = 'rgb(240, 120, 40)'
      g.fillRect(0, 0, w, h)
      return c.toDataURL('image/png').split(',')[1]
    },
    [width, height] as const,
  )
  return Buffer.from(b64, 'base64')
}

/** multipart 본문의 글자 필드 값. */
function field(raw: string, name: string): number {
  const m = raw.match(new RegExp(`name="${name}"\\r\\n\\r\\n(\\d+)\\r\\n`))
  if (!m) throw new Error(`필드 ${name} 없음`)
  return Number(m[1])
}

test('끌어서 옮기고 휠로 확대한 만큼 원본 픽셀 자른 영역을 올린다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await mockApi(page, 'PUT', '/api/v1/users/me/avatar', { avatarUrl: '/api/v1/avatars/1/newhash' })
  const uploads = trackRequests(page, 'PUT', '/api/v1/users/me/avatar')
  await page.goto('/settings/profile')
  await expect(page.getByTestId('profile-avatar-section')).toBeVisible()

  // 400×200 — 원 지름 208px 에 짧은 변 200 이 맞아 배율 1.04, 처음 영역은 (100, 0) 에서 200.
  const png = await makePng(page, 400, 200)
  await page.getByLabel('아바타 이미지 파일').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png })
  const dialog = page.getByTestId('avatar-crop-dialog')
  await expect(dialog).toBeVisible()
  // 이미지를 읽어야 저장이 풀린다(진짜 디코딩).
  await expect(dialog.getByRole('button', { name: '저장' })).toBeEnabled()

  // 오른쪽으로 52px 끌기 → 이미지가 오른쪽으로 → 보는 곳은 왼쪽으로 52/1.04 = 50px → cropX 50.
  const frame = page.getByTestId('avatar-crop-frame')
  const box = (await frame.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 52, cy, { steps: 4 })
  await page.mouse.up()

  // 휠 위로 한 칸 → 약 1.22배 확대(원 가운데 기준). 페이지 대신 틀이 휠을 먹는다.
  await page.mouse.wheel(0, -100)
  await expect.poll(async () => Number(await page.getByRole('slider', { name: '확대' }).inputValue())).toBeGreaterThan(1.1)

  await dialog.getByRole('button', { name: '저장' }).click()
  await uploads.waitFor()
  const req = uploads.requests()[0]
  expect(req.headers()['content-type']).toMatch(/^multipart\/form-data; boundary=/)
  const raw = req.postDataBuffer()!.toString('latin1')
  expect(raw).toContain('name="file"; filename="me.png"')
  // 끌기 뒤 가운데(150, 100)를 지킨 채 1.22배 → 변 ≈ 208/(1.04×1.2214) ≈ 163, 위치 ≈ (68, 18). 휠 delta 반올림 오차를 1px 허용.
  const cropSize = field(raw, 'cropSize')
  expect(cropSize).toBeGreaterThanOrEqual(162)
  expect(cropSize).toBeLessThanOrEqual(164)
  expect(Math.abs(field(raw, 'cropX') - (150 - cropSize / 2))).toBeLessThanOrEqual(1.5)
  expect(Math.abs(field(raw, 'cropY') - (100 - cropSize / 2))).toBeLessThanOrEqual(1.5)
  await expect(dialog).toBeHidden()
  await expect(page.getByText('아바타를 바꿨습니다.')).toBeVisible()
})
