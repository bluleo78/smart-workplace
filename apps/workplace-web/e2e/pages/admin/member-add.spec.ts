// 구성원 추가 — 관리자가 다이얼로그로 새 계정을 만든다(입력→payload→성공 UI).
import { createPageResponse, mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

test('관리자가 구성원을 추가한다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))

  // POST 캡처 — payload 검증 + 201 응답.
  let captured: any = null
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      captured = route.request().postDataJSON()
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          userId: 99,
          username: 'jane',
          name: '김제인',
          email: 'jane@acme.com',
          role: 'USER',
          status: 'ACTIVE',
        }),
      })
    },
  )

  await page.goto('/settings/users')
  await page.getByRole('button', { name: '구성원 추가' }).click()

  await page.getByTestId('add-member-username').fill('jane')
  await page.getByTestId('add-member-email').fill('jane@acme.com')
  await page.getByTestId('add-member-name').fill('김제인')
  await page.getByTestId('add-member-password').fill('Password123')
  await page.getByTestId('add-member-submit').click()

  // 입력→payload: 분리된 username/email + role 이 그대로 전송돼야 한다.
  await expect.poll(() => captured).toMatchObject({
    username: 'jane',
    email: 'jane@acme.com',
    name: '김제인',
    role: 'USER',
  })
  // 성공 UI: 다이얼로그가 닫힌다.
  await expect(page.getByTestId('add-member-submit')).toHaveCount(0)
})

test('이메일 없이도 구성원을 추가한다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))
  let captured: any = null
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      captured = route.request().postDataJSON()
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ userId: 1, username: 'noemail', name: '이름만', email: null, role: 'USER', status: 'ACTIVE' }),
      })
    },
  )

  await page.goto('/settings/users')
  await page.getByRole('button', { name: '구성원 추가' }).click()
  await page.getByTestId('add-member-username').fill('noemail')
  await page.getByTestId('add-member-name').fill('이름만')
  await page.getByTestId('add-member-password').fill('Password123')
  await page.getByTestId('add-member-submit').click()

  // 이메일 빈값은 payload 에서 생략(undefined)된다 — 컴포넌트가 email:undefined 로 보낸다.
  await expect.poll(() => captured?.username).toBe('noemail')
  expect(captured.email).toBeUndefined()
})

test('취소 후 재오픈 시 이전 입력값이 남지 않는다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))

  await page.goto('/settings/users')
  await page.getByRole('button', { name: '구성원 추가' }).click()
  await page.getByTestId('add-member-username').fill('leftover')
  await page.getByTestId('add-member-email').fill('leftover@acme.com')
  await page.getByTestId('add-member-name').fill('잔여값')
  await page.getByTestId('add-member-password').fill('Password123')
  await page.getByTestId('add-member-role-admin').check()
  await page.getByRole('button', { name: '취소' }).click()

  await page.getByRole('button', { name: '구성원 추가' }).click()

  await expect(page.getByTestId('add-member-username')).toHaveValue('')
  await expect(page.getByTestId('add-member-email')).toHaveValue('')
  await expect(page.getByTestId('add-member-name')).toHaveValue('')
  await expect(page.getByTestId('add-member-password')).toHaveValue('')
  await expect(page.getByTestId('add-member-role-user')).toBeChecked()
})

test('계속 추가 체크 시 성공해도 다이얼로그가 열려있고 폼이 비워진다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))
  let postCount = 0
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      postCount += 1
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          userId: postCount,
          username: `user${postCount}`,
          name: `사용자${postCount}`,
          email: null,
          role: 'USER',
          status: 'ACTIVE',
        }),
      })
    },
  )

  await page.goto('/settings/users')
  await page.getByRole('button', { name: '구성원 추가' }).click()
  await page.getByTestId('add-member-keep-open').click()

  await page.getByTestId('add-member-username').fill('user1')
  await page.getByTestId('add-member-name').fill('사용자1')
  await page.getByTestId('add-member-password').fill('Password123')
  await page.getByTestId('add-member-submit').click()

  // 다이얼로그가 닫히지 않고, 다음 등록을 위해 폼은 비워진다.
  // (과거 flake #593: '계속 추가' 체크박스가 <form> 안에 있어 onSuccess 의 reset() → Radix
  //  Checkbox 가 form reset 에 반응해 스스로 onCheckedChange(false) → 첫 저장 후 체크가 풀려
  //  2번째 저장 시 다이얼로그가 닫히던 것. 체크박스를 form 밖으로 분리해 근본 해결.
  //  당시엔 타임아웃 상향으로 오진했으나 실제로는 '요소 소멸(닫힘)'이라 타임아웃과 무관했다.)
  await expect.poll(() => postCount).toBe(1)
  await expect(page.getByTestId('add-member-submit')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('add-member-username')).toHaveValue('', { timeout: 15000 })
  await expect(page.getByTestId('add-member-name')).toHaveValue('', { timeout: 15000 })
  await expect(page.getByTestId('add-member-password')).toHaveValue('', { timeout: 15000 })

  // 체크 상태를 유지한 채로 두 번째 구성원도 같은 다이얼로그에서 추가할 수 있다.
  await page.getByTestId('add-member-username').fill('user2')
  await page.getByTestId('add-member-name').fill('사용자2')
  await page.getByTestId('add-member-password').fill('Password123')
  await page.getByTestId('add-member-submit').click()
  await expect.poll(() => postCount).toBe(2)
  await expect(page.getByTestId('add-member-submit')).toBeVisible({ timeout: 15000 })
})

// #583 — 추가 버튼을 동일 이벤트 루프 틱 내 연속 클릭해도 요청이 1번만 나가야 한다
// (createMember.isPending 리렌더 반영 전 두 번째 클릭이 통과하는 race condition 재현).
test('구성원 추가 — 버튼을 동기적으로 연속 클릭해도 요청이 1번만 나간다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))

  let postCount = 0
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      postCount += 1
      // race condition 재현을 위한 지연 — 실제 네트워크 latency 환경을 모사.
      await new Promise((resolve) => setTimeout(resolve, 200))
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          userId: 1,
          username: 'dupe',
          name: '중복테스트',
          email: null,
          role: 'USER',
          status: 'ACTIVE',
        }),
      })
    },
  )

  await page.goto('/settings/users')
  await page.getByRole('button', { name: '구성원 추가' }).click()

  await page.getByTestId('add-member-username').fill('dupe')
  await page.getByTestId('add-member-name').fill('중복테스트')
  await page.getByTestId('add-member-password').fill('Password123')

  // 같은 이벤트 루프 틱 내에 두 번 dispatch — React state(isPending) 리렌더 전에
  // disabled 속성이 반영되기 전 상태를 재현(실제 버그의 근본 원인 조건).
  const submitButton = page.getByTestId('add-member-submit')
  await submitButton.evaluate((el: HTMLButtonElement) => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

  // 처리 완료(다이얼로그 닫힘) 대기 후 POST 는 정확히 1번만 발생해야 한다.
  await expect(page.getByTestId('add-member-submit')).toHaveCount(0)
  expect(postCount).toBe(1)
})

// #580 — 아이디에 공백만 입력하면 클라이언트 zod 검증(trim)이 서버 전송 전에 막아야 한다.
test('아이디에 공백만 입력하면 클라이언트 검증에서 막힌다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))

  let posted = false
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      posted = true
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
    },
  )

  await page.goto('/settings/users')
  await page.getByRole('button', { name: '구성원 추가' }).click()

  await page.getByTestId('add-member-username').fill('  ')
  await page.getByTestId('add-member-name').fill('테스트')
  await page.getByTestId('add-member-password').fill('Password123')
  await page.getByTestId('add-member-submit').click()

  // 클라이언트 zod 검증(trim)이 막아 API 호출 자체가 발생하지 않아야 한다.
  await expect(page.getByText('아이디를 입력하세요')).toBeVisible()
  expect(posted).toBe(false)
})

// #580 — 서버가 필드별 오류(errors 맵)를 내려주면 최상위 message("Validation failed" 등
// 하드코딩된 영문)가 아니라 필드별 로컬라이즈 메시지를 우선 표시해야 한다.
test('서버 검증 오류는 errors 필드 맵의 메시지를 우선 표시한다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))

  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Validation failed',
          errors: { username: '아이디는 공백일 수 없습니다.' },
        }),
      })
    },
  )

  await page.goto('/settings/users')
  await page.getByRole('button', { name: '구성원 추가' }).click()

  // 클라이언트 zod 검증을 우회해 서버 응답 처리 경로만 검증 — trim으로 통과하는
  // 유효 문자열이지만 서버가 여전히 400을 내려주는 케이스를 흉내낸다.
  await page.getByTestId('add-member-username').fill('validlookingbutrejected')
  await page.getByTestId('add-member-name').fill('테스트')
  await page.getByTestId('add-member-password').fill('Password123')
  await page.getByTestId('add-member-submit').click()

  await expect(page.getByTestId('add-member-error')).toHaveText('아이디는 공백일 수 없습니다.')
  await expect(page.getByTestId('add-member-error')).not.toHaveText('Validation failed')
})
