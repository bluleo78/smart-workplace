// #520 메일→이슈 승격 E2E — route 모킹으로 전 파이프라인 검증.
// 배경: AI 초안(POST /issue-draft) → 모달 사전채움 → 담당 override → 승격(POST /issue).
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

test.describe('메일→이슈 승격', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // AI 활성화 계정 + 메일 목록/상세 기본 스텁.
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([summary({ id: 7, subject: '정산 자료 검토 요청' })]),
        }),
    )
    await mockApi(page, 'GET', '/api/v1/mail/messages/7', detail({ id: 7, subject: '정산 자료 검토 요청', bodyText: '본문' }))
    // AI 요약 스텁 — AI ON 계정이므로 메시지 열람 시 자동 조회됨.
    await mockApi(page, 'GET', '/api/v1/mail/messages/7/summary', { summary: '요약' })
    // #520 이슈 배지 기본 스텁 — 연결 이슈 없음(기본값). 배지 케이스 테스트에서 override.
    await mockApi(page, 'GET', '/api/v1/mail/messages/7/linked-issue', { issueKey: null })
  })

  test('버튼→모달 사전채움→담당 override→생성 payload 검증', async ({ authenticatedPage: page }) => {
    // 이슈 초안 API 스텁 (POST).
    await page.route(
      (u) => u.pathname === '/api/v1/mail/messages/7/issue-draft',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            title: '정산 자료 검토',
            body: '- 5월 자료 확인',
            priority: 'HIGH',
            suggestedProjectKey: 'FIN',
            candidateProjects: [
              { key: 'FIN', name: '재무' },
              { key: 'PERSONAL', name: '내 작업' },
            ],
          }),
        }),
    )
    // 프로젝트 멤버 스텁.
    await page.route(
      (u) => u.pathname === '/api/v1/projects/FIN/members',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { userId: 1, username: 'me', name: '나', kind: 'HUMAN', role: 'OWNER', createdAt: null },
            { userId: 9, username: 'ai', name: 'AI 비서', kind: 'AGENT', role: 'MEMBER', createdAt: null },
          ]),
        }),
    )
    // 승격 API 스텁 + payload 캡처.
    let promotePayload: unknown
    await page.route(
      (u) => u.pathname === '/api/v1/mail/messages/7/issue',
      async (route) => {
        promotePayload = route.request().postDataJSON()
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ issueKey: 'FIN-12' }),
        })
      },
    )

    // 받은편지함으로 이동 → 메일 행 클릭 → 상세 오픈.
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()

    // AI 버튼은 ai-accent 보조 컬러 사용(디자인시스템 §7.2 — 아이콘+색).
    await expect(page.getByTestId('mail-ai-issue')).toHaveClass(/text-ai-accent/)

    // "AI 이슈 생성" 버튼 클릭 → 모달 오픈.
    await page.getByTestId('mail-ai-issue').click()
    await expect(page.getByTestId('mail-to-issue-dialog')).toBeVisible()

    // AI 초안으로 사전채움된 제목 검증.
    await expect(page.getByTestId('issue-draft-title')).toHaveValue('정산 자료 검토')

    // 담당자를 AI 비서(userId 9)로 변경 — shadcn Select: Trigger 클릭 → option 클릭.
    await page.getByTestId('issue-draft-assignee').click()
    await page.getByRole('option', { name: 'AI 비서' }).click()

    // 생성 버튼 클릭 → 성공 토스트.
    await page.getByTestId('mail-to-issue-submit').click()
    await expect(page.getByText('이슈 FIN-12 를 만들었어요')).toBeVisible()

    // 승격 payload 검증 — assigneeIds 에 AI(9) 포함.
    expect(promotePayload).toMatchObject({
      projectKey: 'FIN',
      title: '정산 자료 검토',
      priority: 'HIGH',
      assigneeIds: [9],
    })
  })

  test('메일 배지: 연결된 이슈 키 표시', async ({ authenticatedPage: page }) => {
    // linked-issue 스텁 — issueKey 있는 경우.
    await page.route(
      (u) => u.pathname.startsWith('/api/v1/mail/messages/') && u.pathname.endsWith('/linked-issue'),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ issueKey: 'FIN-12' }),
        }),
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()

    // issueKey 있으면 배지가 나타나야 한다.
    await expect(page.getByTestId('mail-linked-issue')).toBeVisible()
    await expect(page.getByTestId('mail-linked-issue')).toHaveText(/FIN-12/)
  })

  test('메일 배지: 연결된 이슈 없으면 배지 미표시', async ({ authenticatedPage: page }) => {
    // linked-issue 스텁 — issueKey null(이슈 없음).
    await page.route(
      (u) => u.pathname.startsWith('/api/v1/mail/messages/') && u.pathname.endsWith('/linked-issue'),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ issueKey: null }),
        }),
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()

    // issueKey null → 배지 미표시.
    await expect(page.getByTestId('mail-linked-issue')).not.toBeVisible()
  })

  test('취소 버튼이 모달을 닫는다', async ({ authenticatedPage: page }) => {
    await page.route(
      (u) => u.pathname === '/api/v1/mail/messages/7/issue-draft',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            title: '초안 제목',
            body: '초안 본문',
            priority: 'MID',
            suggestedProjectKey: 'FIN',
            candidateProjects: [{ key: 'FIN', name: '재무' }],
          }),
        }),
    )
    await page.route(
      (u) => u.pathname === '/api/v1/projects/FIN/members',
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await page.getByTestId('mail-ai-issue').click()
    await expect(page.getByTestId('mail-to-issue-dialog')).toBeVisible()
    await page.getByRole('button', { name: '취소' }).click()
    await expect(page.getByTestId('mail-to-issue-dialog')).not.toBeVisible()
  })

  // #859 이미 전환한 메일 — 서버 409 메시지를 토스트로 보여주고, 연결 이슈 배지를 다시 불러와 기존 이슈를 드러낸다.
  test('이미 전환한 메일이면 409 안내 후 연결 이슈 배지를 갱신한다', async ({ authenticatedPage: page }) => {
    await page.route(
      (u) => u.pathname === '/api/v1/mail/messages/7/issue-draft',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            title: '정산 자료 검토',
            body: '본문',
            priority: 'MID',
            suggestedProjectKey: 'FIN',
            candidateProjects: [{ key: 'FIN', name: '재무' }],
          }),
        }),
    )
    await page.route(
      (u) => u.pathname === '/api/v1/projects/FIN/members',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    // 409 이후엔 서버가 기존 연결 이슈를 돌려준다(다른 탭·AI 가 먼저 만든 상황).
    let promoted = false
    await page.route(
      (u) => u.pathname === '/api/v1/mail/messages/7/linked-issue',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ issueKey: promoted ? 'FIN-3' : null }),
        }),
    )
    await page.route(
      (u) => u.pathname === '/api/v1/mail/messages/7/issue',
      (route) => {
        promoted = true
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ status: 409, message: '이미 이 메일로 만든 이슈가 있습니다: FIN-3' }),
        })
      },
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await expect(page.getByTestId('mail-linked-issue')).not.toBeVisible()
    await page.getByTestId('mail-ai-issue').click()
    await expect(page.getByTestId('issue-draft-title')).toHaveValue('정산 자료 검토')
    await page.getByTestId('mail-to-issue-submit').click()

    await expect(page.getByText('이미 이 메일로 만든 이슈가 있습니다: FIN-3')).toBeVisible()
    await expect(page.getByTestId('mail-linked-issue')).toHaveText(/FIN-3/)
  })
})
