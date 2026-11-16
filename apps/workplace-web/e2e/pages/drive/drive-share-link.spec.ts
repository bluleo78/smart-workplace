// 드라이브 공유 링크 E2E (백엔드 없이 page.route 모킹).
// 공개 받기 화면(/s/:token)이 인증·앱 셸 없이 라우트 → 정보 API → 파일 카드로 이어지는지(@wiring)만 남긴다.
// 공유 창(생성 payload·랜딩 URL·폐기·라벨·만료일/비밀번호 유효성·만료일 표시)과 받기 화면(비밀번호 인코딩 헤더·401/410 안내·홈 링크)은
// src/pages/drive/shareLink.test.tsx, 보관 공간 분기는 src/components/drive/ShareLinkModal.test.tsx 가 지킨다(WP-971, WP-984).
import { createFile, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

// ShareLinkPage (/s/:token) 는 AppLayout·인증 없이 렌더되어야 한다 — 인증 fixture 를 쓰지 않고 기본 page 를 직접 사용.
test('공개 공유 링크 랜딩 — 인증 없이 share-download-btn 표시', { tag: '@wiring' }, async ({ page }) => {
  // 화면은 먼저 링크 정보를 묻는다(WP-1227) — 비밀번호 없는 링크면 바로 파일 카드.
  await page.route('**/api/v1/public/drive/share/sl_abc', (route) =>
    route.fulfill({
      json: { passwordRequired: false, loginRequired: false, name: 'report.txt', mimeType: 'text/plain', sizeBytes: 2048, sharedBy: null, loginAvailable: true, driveOpen: null },
    }),
  )
  // /s/sl_abc 진입 시 /login 리디렉트 없이 랜딩 페이지가 렌더돼야 한다.
  await page.goto('/s/sl_abc')
  await expect(page.getByTestId('share-file-name')).toHaveText('report.txt')

  // 다운로드 버튼 표시 확인 (인증 없이 접근 가능)
  await expect(page.getByTestId('share-download-btn')).toBeVisible()
  await expect(page.getByTestId('share-download-btn')).toHaveText('다운로드')

  // /login 으로 리디렉트되지 않아야 한다
  expect(page.url()).not.toContain('/login')
})

// WP-1528 — 390 폭에서 배지가 많은 링크(외부 + 만료일 + 비밀번호 + 만든 사람)가 칸 최소 폭을 키워 창이 가로로 넘치고
// 폐기 단추가 화면 밖으로 밀리던 결함. 넘침·화면 안 위치는 jsdom 이 잴 수 없는 기하라 E2E(@layout)로 본다.
test('모바일 390px — 배지 많은 공유 링크도 창이 넘치지 않고 폐기 단추가 보이는 영역 안에 있다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const file = createFile({ id: 70, name: 'report.pdf', mimeType: 'application/pdf' })
  const links = [
    { id: 5, audience: 'EXTERNAL', hasPassword: true, expiresAt: '2027-12-31T14:59:59Z', revoked: false, active: true, createdAt: '2026-11-12T00:00:00Z', createdBy: 1, token: 'sl_abcdefghijklmnopqrstuvwxyz0123456789', createdByName: '양동희' },
    { id: 6, audience: 'INTERNAL', hasPassword: false, expiresAt: null, revoked: false, active: true, createdAt: '2026-11-12T00:00:00Z', createdBy: 1, token: 'sl_short', createdByName: '양동희' },
    { id: 7, audience: 'EXTERNAL', hasPassword: true, expiresAt: '2026-01-01T00:00:00Z', revoked: true, active: false, createdAt: '2026-11-12T00:00:00Z', createdBy: 1, token: null, createdByName: '아주아주긴이름을가진작성자' },
  ]
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [personalSpace()] }) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/drive/spaces/1/items', (r) => r.fulfill({ json: { folders: [], files: [file] } }))
  await page.route((u) => u.pathname === '/api/v1/drive/files/70/share-links', (r) => r.fulfill({ json: links }))

  await page.goto('/drive/spaces/1')
  await page.getByTestId('drive-row-more-file-70').click()
  await page.getByTestId('mobile-action-share').click()
  const modal = page.getByTestId('share-link-modal')
  await expect(modal.getByTestId('share-link-item')).toHaveCount(2)

  // 창이 가로로 넘치지 않는다.
  const sizes = await modal.evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth }))
  expect(sizes.sw).toBeLessThanOrEqual(sizes.cw)
  // 모든 폐기 단추가 창 안(보이는 영역)에 있다.
  const box = (await modal.boundingBox())!
  const revokes = modal.getByTestId('share-link-revoke-btn')
  await expect(revokes).toHaveCount(2)
  for (let i = 0; i < 2; i++) {
    const b = (await revokes.nth(i).boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(box.x)
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width)
    expect(b.x + b.width).toBeLessThanOrEqual(390)
  }
  // 지난 링크 칸도 넘치지 않는다.
  await modal.getByTestId('share-link-past-toggle').click()
  const past = modal.getByTestId('share-link-past-item')
  await expect(past).toHaveCount(1)
  const pb = (await past.boundingBox())!
  expect(pb.x + pb.width).toBeLessThanOrEqual(box.x + box.width)
})

// WP-1625 — 만료일을 덜 넣고(월만 치고 일·연은 비움) 「링크 생성」을 누르면 만료 없는 링크가 만들어지던 결함.
// 실제 <input type="date"> 는 덜 넣은 날짜를 값 '' 로 올리면서 validity.badInput 을 켜고, 빈 칸에서 일부만 치면 change 도 오지 않는다.
// jsdom 은 이 동작을 재현하지 못해(vitest 는 validity 를 덮어 흉내만 낸다) 키보드 입력이 필요한 @input 으로 실제 Chromium 에서 본다.
test('만료일을 덜 넣고 링크 생성을 누르면 안내를 보이고 링크 생성 요청을 보내지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  // 공유 창은 위 @layout 테스트와 같이 행 ⋮ 의 작업 시트(모바일 폭)로 연다 — 창 안 동작은 폭과 무관하다.
  await page.setViewportSize({ width: 390, height: 844 })
  const file = createFile({ id: 71, name: 'draft.pdf', mimeType: 'application/pdf' })
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [personalSpace()] }) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/drive/spaces/1/items', (r) => r.fulfill({ json: { folders: [], files: [file] } }))
  // 살아 있는 링크가 없으면 생성 폼이 바로 보인다. 생성 POST 는 모킹하지 않고 tracker 로 나갔는지만 센다.
  await page.route((u) => u.pathname === '/api/v1/drive/files/71/share-links', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback())
  const creates = trackRequests(page, 'POST', '/api/v1/drive/files/71/share-links')

  await page.goto('/drive/spaces/1')
  await page.getByTestId('drive-row-more-file-71').click()
  await page.getByTestId('mobile-action-share').click()
  const modal = page.getByTestId('share-link-modal')
  await expect(modal.getByTestId('share-link-form')).toBeVisible()

  // 날짜 칸의 첫 조각(월)에 두 자리만 친다 — 나머지(일·연)는 비워 둬 칸이 덜 채워진 채 남는다.
  const expires = modal.getByLabel('만료일 (선택)')
  await expires.focus()
  await page.keyboard.type('12')
  await expect.poll(() => expires.evaluate((el: HTMLInputElement) => el.validity.badInput)).toBe(true)
  await expect(expires).toHaveValue('')

  await modal.getByTestId('share-link-create-btn').click()
  await expect(modal.getByTestId('share-expires-error')).toHaveText('만료일을 끝까지 입력하거나 칸을 비워 주세요.')
  await expect(expires).toHaveAttribute('aria-invalid', 'true')
  expect(creates.count()).toBe(0)
})
