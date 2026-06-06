// 필수 필드 시각적 표시(붉은 별표 *) E2E — IssueCreateDialog · ExternalContactFormDialog.
// 폼을 열어 required FormField 가 실제로 '*' 마커를 렌더링하는지 검증한다.
import { expect, test } from '../fixtures/auth.fixture'
import { external, page as makePage } from '../factories/contacts.factory'
import { createProject } from '../factories/project.factory'
import { createIssueSearchResponse } from '../factories/issue.factory'
import { systemTypes } from '../factories/issueType.factory'

// ─────────────────────────────────────────────
// IssueCreateDialog — 제목 필드 필수 표시
// ─────────────────────────────────────────────
test(
  '이슈 생성 다이얼로그 — 제목 필드에 필수 표시(*) 렌더링',
  async ({ authenticatedPage: page }) => {
    // 프로젝트/이슈 목록/이슈유형 스텁
    await page.route('**/api/v1/projects/WP', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createProject({ key: 'WP', name: 'Workplace' })),
      }),
    )
    await page.route('**/api/v1/projects/WP/issues**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      }),
    )
    await page.route('**/api/v1/projects/WP/issue-types', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(systemTypes()),
      }),
    )

    await page.goto('/projects/WP')
    await page.getByRole('button', { name: '+ 새 태스크' }).click()

    // 다이얼로그가 열려야 한다
    const dialog = page.getByRole('dialog', { name: '새 태스크' })
    await expect(dialog).toBeVisible()

    // '제목' 레이블 옆에 붉은 별표(*)가 있는지 확인:
    // FormField 컴포넌트가 <span class="text-destructive"> 로 렌더링한다
    const titleLabel = dialog.locator('label[for="issue-title"]')
    await expect(titleLabel).toContainText('*')
    const asterisk = titleLabel.locator('span.text-destructive')
    await expect(asterisk).toBeVisible()
  },
)

// ─────────────────────────────────────────────
// ExternalContactFormDialog — 이름 필드 필수 표시
// ─────────────────────────────────────────────
test(
  '외부 연락처 다이얼로그 — 이름 필드에 필수 표시(*) 렌더링',
  async ({ authenticatedPage: page }) => {
    // 연락처 목록 스텁
    await page.route('**/api/v1/contacts**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makePage([external()])),
      }),
    )

    await page.goto('/contacts')
    // '새 외부 연락처' 버튼 클릭 (contacts 페이지 헤더)
    await page.getByRole('button', { name: '새 외부 연락처' }).click()

    const dialog = page.getByTestId('external-contact-dialog')
    await expect(dialog).toBeVisible()

    // '이름' 레이블 옆에 붉은 별표(*) 확인
    const nameLabel = dialog.locator('label[for="c-name"]')
    await expect(nameLabel).toContainText('*')
    const asterisk = nameLabel.locator('span.text-destructive')
    await expect(asterisk).toBeVisible()
  },
)
