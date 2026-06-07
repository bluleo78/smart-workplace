import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'

test('입력이 비어 있으면 보내기 버튼이 비활성(disabled)이어야 한다', async ({ authenticatedPage: page }) => {
  // 보내기 버튼의 disabled 속성이 입력 상태와 동기화되는지 검증 (이슈 #144 회귀 방지)
  await page.goto('/')
  await page.getByTestId('chat-launcher').click()
  const sendBtn = page.getByRole('button', { name: '보내기' })

  // 1) 입력 비어 있음 → 버튼 비활성
  await expect(sendBtn).toBeDisabled()

  // 2) 텍스트 입력 후 → 버튼 활성
  await page.getByTestId('chat-input').fill('안녕')
  await expect(sendBtn).toBeEnabled()

  // 3) 입력 지우면 → 다시 비활성
  await page.getByTestId('chat-input').fill('')
  await expect(sendBtn).toBeDisabled()
})

test('이슈 페이지에서도 챗 런처가 상주한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  // 챗 런처는 AppLayout(전역 셸)에 있다. 이슈 페이지가 정상 렌더돼야(에러 바운더리 미발동)
  // 런처도 함께 상주함을 확인할 수 있으므로 프로젝트 목록을 빈 페이지로 모킹한다.
  await mockApi(page, 'GET', '/api/v1/projects', {
    content: [],
    page: 0,
    size: 20,
    totalElements: 0,
    totalPages: 0,
  })
  await page.goto('/projects')
  // 평소엔 칩(런처)만 보이고, 클릭하면 입력 패널이 펼쳐진다.
  await expect(page.getByTestId('chat-launcher')).toBeVisible()
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
})

test('비-홈(이슈) 페이지에서 챗 제출 시 홈으로 이동해 캔버스를 구성한다', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  // 이슈 페이지 렌더용 프로젝트 목록 + compose 응답 모킹.
  // 세션/me/* 는 auth fixture 의 빈 스텁을 사용(홈 기본 구성은 빈 위젯이라도 home-widget 으로 렌더됨).
  await mockApi(page, 'GET', '/api/v1/projects', {
    content: [],
    page: 0,
    size: 20,
    totalElements: 0,
    totalPages: 0,
  })
  const composeCapture = await mockApi(
    page,
    'POST',
    '/api/v1/home/compose',
    {
      sessionId: 's-nonhome',
      message: '내 HIGH 이슈를 정리했어요',
      widgets: [{ type: 'issue_list', params: { assignee: 'me', priority: ['HIGH'] }, layout: { page: 'current' } }],
    },
    { capture: true },
  )

  // 1) 이슈 페이지에서 시작(홈이 아님)
  await page.goto('/projects')
  await expect(page.getByTestId('issue-sidebar')).toBeVisible()

  // 2) 전역 챗 런처를 열고 질의 제출
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-input').fill('내 HIGH 이슈')
  await page.getByRole('button', { name: '보내기' }).click()

  // 3) 홈("/")으로 라우팅된다 — "챗 → compose → 캔버스" 주 경로 보존
  await expect(page).toHaveURL(/\/$/)

  // 4) compose 요청 페이로드 검증(새 세션이므로 sessionId null, 입력 query 그대로)
  const req = await composeCapture.waitForRequest()
  expect(req.payload).toMatchObject({ sessionId: null, query: '내 HIGH 이슈' })

  // 5) 캔버스가 compose 결과로 구성된다(현재 페이지 위젯 1개로 replace-all)
  await expect(page.getByTestId('home-widget')).toHaveCount(1)
  // 6) 전역 챗 패널은 라우팅 후에도 유지되며 사용자 질의 + 어시스턴트 응답을 보여준다
  await expect(page.getByTestId('chat-panel')).toContainText('내 HIGH 이슈')
  await expect(page.getByTestId('chat-panel')).toContainText('내 HIGH 이슈를 정리했어요')
})
