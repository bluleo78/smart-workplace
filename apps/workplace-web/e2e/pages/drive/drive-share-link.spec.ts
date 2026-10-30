// 드라이브 공유 링크 E2E (백엔드 없이 page.route 모킹).
// 공개 받기 화면(/s/:token)이 인증·앱 셸 없이 라우트 → 정보 API → 파일 카드로 이어지는지(@wiring)만 남긴다.
// 공유 창(생성 payload·랜딩 URL·폐기·라벨·만료일/비밀번호 유효성·만료일 표시)과 받기 화면(비밀번호 인코딩 헤더·401/410 안내·홈 링크)은
// src/pages/drive/shareLink.test.tsx, 보관 공간 분기는 src/components/drive/ShareLinkModal.test.tsx 가 지킨다(WP-971, WP-984).
import { expect, test } from '../../fixtures/auth.fixture'

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
