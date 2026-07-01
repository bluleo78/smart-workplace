import { expect, test } from '../fixtures/auth.fixture'

// 프로필 개인 비서 섹션 E2E — 미설정 상태에서 토큰을 등록하면 "설정됨" 으로 전환된다.
// 백엔드 없이 GET 상태/PUT 토큰을 page.route 로 모킹. PUT 후 GET 응답을 configured=true 로 바꿔
// 캐시 무효화 → 재조회 → UI 반영을 검증한다.
// 에러 케이스: PUT/DELETE API 실패 시 오류 토스트가 표시되어야 한다 (#192).

test.describe('프로필 개인 비서', () => {
  test('미설정 → 토큰 등록 → 설정됨', async ({ authenticatedPage: page }) => {
    let configured = false

    // GET /users/me/assistant — configured 플래그에 따라 미설정/설정됨 응답.
    await page.route('**/api/v1/users/me/assistant', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            configured
              ? {
                  configured: true,
                  tokenLabel: null,
                  tokenLastUsedAt: null,
                  model: 'claude-sonnet-4-6',
                  thinkingDepth: 'NORMAL',
                }
              : {
                  configured: false,
                  tokenLabel: null,
                  tokenLastUsedAt: null,
                  model: null,
                  thinkingDepth: null,
                },
          ),
        })
      }
      return route.fallback()
    })

    // PUT /users/me/assistant/token — 등록 성공 시 이후 GET 이 설정됨을 반환하도록 플래그 전환.
    await page.route('**/api/v1/users/me/assistant/token', async (route) => {
      configured = true
      return route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/settings/assistant')

    // 미설정: 토큰 입력 → 등록.
    await page.getByTestId('assistant-token-input').fill('x'.repeat(40))
    await page.getByRole('button', { name: '토큰 등록' }).click()

    // 설정됨 표시가 노출되어야 한다.
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
  })

  test('비서 설정 페이지 제목', async ({ authenticatedPage: page }) => {
    // GET /users/me/assistant — 미설정 상태 모킹(컴포넌트 크래시 방지)
    await page.route('**/api/v1/users/me/assistant', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: false,
          tokenLabel: null,
          tokenLastUsedAt: null,
          model: null,
          thinkingDepth: null,
        }),
      }),
    )
    await page.goto('/settings/assistant')
    await expect(page.getByRole('heading', { name: '비서 설정' })).toBeVisible()
  })

  // #261 — 모델/생각의 깊이 선택기가 shadcn Select 로 렌더링되어야 한다 (native <select> 금지).
  test('모델·생각의 깊이 선택기가 shadcn Select로 렌더링된다', async ({
    authenticatedPage: page,
  }) => {
    await page.route('**/api/v1/users/me/assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            configured: true,
            tokenLabel: null,
            tokenLastUsedAt: null,
            model: 'claude-sonnet-4-6',
            thinkingDepth: 'NORMAL',
          }),
        })
      }
      return route.fallback()
    })

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()

    // native <select> 요소가 없어야 한다 — shadcn SelectTrigger(role="combobox")로 대체됨.
    await expect(page.locator('select')).toHaveCount(0)

    // shadcn SelectTrigger(role="combobox")가 모델, 생각의 깊이 각각 보여야 한다.
    await expect(page.getByRole('combobox', { name: '모델' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '생각의 깊이' })).toBeVisible()
  })

  // #262 — 모델 선택기에 내부 ID 대신 사용자 친화적 레이블이 표시되어야 한다.
  test('모델 선택기에 사용자 친화적 레이블 표시', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/users/me/assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            configured: true,
            tokenLabel: null,
            tokenLastUsedAt: null,
            model: 'claude-sonnet-5',
            thinkingDepth: 'NORMAL',
          }),
        })
      }
      return route.fallback()
    })

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()

    // 트리거(현재 선택값)에 사용자 친화적 레이블이 표시되어야 한다.
    await expect(page.getByRole('combobox', { name: '모델' })).toContainText('Claude Sonnet 5')

    // 드롭다운을 열어 목록에 내부 ID가 없고 레이블이 있는지 확인한다.
    await page.getByRole('combobox', { name: '모델' }).click()
    await expect(page.getByRole('option', { name: 'Claude Sonnet 5' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Claude Opus 4.8' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Claude Haiku 4.5' })).toBeVisible()
    // 내부 ID 형식('claude-sonnet-5')은 옵션 레이블로 노출되면 안 된다.
    await expect(page.getByRole('option', { name: 'claude-sonnet-5' })).not.toBeVisible()
    await expect(page.getByRole('option', { name: 'claude-opus-4-8' })).not.toBeVisible()
  })

  // #192 — 토큰 등록 API 실패 시 오류 토스트가 표시되어야 한다.
  test('토큰 등록 API 실패 시 오류 토스트 표시', async ({ authenticatedPage: page }) => {
    // GET — 미설정 상태 유지
    await page.route('**/api/v1/users/me/assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            configured: false,
            tokenLabel: null,
            tokenLastUsedAt: null,
            model: null,
            thinkingDepth: null,
          }),
        })
      }
      return route.fallback()
    })
    // PUT /token — 500 에러 반환
    await page.route('**/api/v1/users/me/assistant/token', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: '서버 오류가 발생했습니다.' }),
      }),
    )

    await page.goto('/settings/assistant')
    await page.getByTestId('assistant-token-input').fill('x'.repeat(40))
    await page.getByRole('button', { name: '토큰 등록' }).click()

    // 오류 토스트가 표시되어야 한다.
    await expect(page.getByText('서버 오류가 발생했습니다.')).toBeVisible()
    // 성공 토스트는 표시되면 안 된다.
    await expect(page.getByText('개인 비서 토큰을 저장했습니다.')).not.toBeVisible()
  })

  // #192 — 해제 API 실패 시 오류 토스트가 표시되어야 한다.
  test('개인 비서 해제 API 실패 시 오류 토스트 표시', async ({ authenticatedPage: page }) => {
    // GET — 설정됨 상태 모킹
    await page.route('**/api/v1/users/me/assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            configured: true,
            tokenLabel: null,
            tokenLastUsedAt: null,
            model: 'claude-sonnet-4-6',
            thinkingDepth: 'NORMAL',
          }),
        })
      }
      return route.fallback()
    })
    // DELETE — 403 에러 반환
    await page.route('**/api/v1/users/me/assistant', (route) => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ message: '권한이 없습니다.' }),
        })
      }
      return route.fallback()
    })

    await page.goto('/settings/assistant')
    // 설정됨 상태 확인 후 해제 클릭
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    await page.getByRole('button', { name: '해제' }).click()

    // 오류 토스트가 표시되어야 한다.
    await expect(page.getByText('권한이 없습니다.')).toBeVisible()
    // 성공 토스트는 표시되면 안 된다.
    await expect(page.getByText('개인 비서를 해제했습니다.')).not.toBeVisible()
  })

  // #198 — 모델 변경 PUT /settings 실패 시 오류 토스트가 표시되어야 한다(silent failure 방지).
  test('모델 변경 API 실패 시 오류 토스트 표시', async ({ authenticatedPage: page }) => {
    // GET — 설정됨 상태(모델/깊이 드롭다운 노출).
    await page.route('**/api/v1/users/me/assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            configured: true,
            tokenLabel: null,
            tokenLastUsedAt: null,
            model: 'claude-sonnet-4-6',
            thinkingDepth: 'NORMAL',
          }),
        })
      }
      return route.fallback()
    })
    // PUT /settings — 500 에러 반환.
    await page.route('**/api/v1/users/me/assistant/settings', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: '서버 오류가 발생했습니다.' }),
      }),
    )

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    // 모델 드롭다운 변경 → onValueChange 가 PUT /settings 호출(500).
    // shadcn Select: trigger(aria-label "모델") 클릭 → option 클릭
    await page.getByRole('combobox', { name: '모델' }).click()
    await page.getByRole('option', { name: 'Claude Opus 4.8' }).click()

    // 오류 토스트가 표시되어야 한다.
    await expect(page.getByText('서버 오류가 발생했습니다.')).toBeVisible()
    // 성공 토스트는 표시되면 안 된다.
    await expect(page.getByText('비서 설정을 변경했습니다.')).not.toBeVisible()
  })

  // 모델로 Claude Haiku 4.5 를 선택하면 내부 ID('claude-haiku-4-5')가 PUT payload 로 전송된다.
  test('Haiku 4.5 선택 시 올바른 모델 ID 가 PUT 으로 전송된다', async ({
    authenticatedPage: page,
  }) => {
    await page.route('**/api/v1/users/me/assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            configured: true,
            tokenLabel: null,
            tokenLastUsedAt: null,
            model: 'claude-sonnet-4-6',
            thinkingDepth: 'NORMAL',
          }),
        })
      }
      return route.fallback()
    })
    // PUT /settings — payload 캡처 후 성공 응답.
    let putBody: { model?: string } | null = null
    await page.route('**/api/v1/users/me/assistant/settings', (route) => {
      putBody = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    await page.getByRole('combobox', { name: '모델' }).click()
    await page.getByRole('option', { name: 'Claude Haiku 4.5' }).click()

    // 성공 토스트 + 전송된 모델 ID 검증(레이블 아닌 내부 ID).
    await expect(page.getByText('비서 설정을 변경했습니다.')).toBeVisible()
    expect(putBody).toEqual({ model: 'claude-haiku-4-5' })
  })

  // 개인 비서 이름 변경 — 명시적 저장 후 PUT /name payload 검증 + 성공 토스트.
  test('개인 비서 이름 변경 → PUT /name payload + 성공 토스트', async ({
    authenticatedPage: page,
  }) => {
    await page.route('**/api/v1/users/me/assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            configured: true,
            tokenLabel: null,
            tokenLastUsedAt: null,
            model: 'claude-sonnet-4-6',
            thinkingDepth: 'NORMAL',
            name: '개인 비서',
          }),
        })
      }
      return route.fallback()
    })
    // PUT /name — payload 캡처 후 성공 응답.
    let putBody: { name?: string } | null = null
    await page.route('**/api/v1/users/me/assistant/name', (route) => {
      putBody = route.request().postDataJSON()
      return route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()

    // 기본 이름이 프리필되어 있어야 한다.
    await expect(page.getByTestId('assistant-name-input')).toHaveValue('개인 비서')
    await page.getByTestId('assistant-name-input').fill('나만의 비서')
    await page.getByTestId('assistant-name-save').click()

    await expect(page.getByText('개인 비서 이름을 변경했습니다.')).toBeVisible()
    expect(putBody).toEqual({ name: '나만의 비서' })
  })

  // #264 — tokenLabel 이 null 일 때 '(라벨 없음)' 개발자 용어가 노출되면 안 된다.
  test('tokenLabel null 시 라벨 없음 문구가 표시되지 않는다', async ({
    authenticatedPage: page,
  }) => {
    await page.route('**/api/v1/users/me/assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            configured: true,
            tokenLabel: null,
            tokenLastUsedAt: null,
            model: 'claude-sonnet-4-6',
            thinkingDepth: 'NORMAL',
          }),
        })
      }
      return route.fallback()
    })

    await page.goto('/settings/assistant')
    const configured = page.getByTestId('assistant-configured')
    await expect(configured).toBeVisible()

    // '(라벨 없음)' 개발자 용어가 표시되면 안 된다.
    await expect(configured).not.toContainText('라벨 없음')
    // tokenLabel 이 없어도 '설정됨' 문구는 그대로 표시되어야 한다.
    await expect(configured).toContainText('설정됨')
  })

  // #264 — tokenLabel 이 있으면 ' · <label>' 형태로 표시되어야 한다.
  test('tokenLabel 있을 때 라벨이 포함된 문구가 표시된다', async ({
    authenticatedPage: page,
  }) => {
    await page.route('**/api/v1/users/me/assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            configured: true,
            tokenLabel: '내 토큰',
            tokenLastUsedAt: null,
            model: 'claude-sonnet-4-6',
            thinkingDepth: 'NORMAL',
          }),
        })
      }
      return route.fallback()
    })

    await page.goto('/settings/assistant')
    const configured = page.getByTestId('assistant-configured')
    await expect(configured).toBeVisible()

    // tokenLabel 이 있으면 '설정됨 · <label>' 형태로 노출.
    await expect(configured).toContainText('설정됨 · 내 토큰')
  })

  // #198 — 생각의 깊이 변경 성공(204) 시 성공 토스트가 표시되어야 한다(피드백 일관성).
  test('생각의 깊이 변경 성공 시 성공 토스트 표시', async ({ authenticatedPage: page }) => {
    // GET — 설정됨 상태.
    await page.route('**/api/v1/users/me/assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            configured: true,
            tokenLabel: null,
            tokenLastUsedAt: null,
            model: 'claude-sonnet-4-6',
            thinkingDepth: 'NORMAL',
          }),
        })
      }
      return route.fallback()
    })
    // PUT /settings — 204 성공. payload 검증.
    let putBody: unknown = null
    await page.route('**/api/v1/users/me/assistant/settings', (route) => {
      putBody = route.request().postDataJSON()
      return route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    // 생각의 깊이 변경 → onValueChange 가 PUT /settings 호출(204).
    // shadcn Select: trigger(aria-label "생각의 깊이") 클릭 → option 클릭
    await page.getByRole('combobox', { name: '생각의 깊이' }).click()
    await page.getByRole('option', { name: '깊게' }).click()

    // 성공 토스트가 표시되어야 한다.
    await expect(page.getByText('비서 설정을 변경했습니다.')).toBeVisible()
    // 보낸 payload 가 선택값과 일치해야 한다.
    expect(putBody).toEqual({ thinkingDepth: 'DEEP' })
  })
})
