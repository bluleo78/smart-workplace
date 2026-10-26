// 컨텐츠 헤더(PageHeader) 표준 — 넓은 화면에서 헤더 제목·액션이 좌우 끝에 붙는지(@layout)만 브라우저에서 본다.
// 프로젝트 목록·이슈 상세의 헤더 구성(h-14·h1 제목·액션, 이슈 상세는 브레드크럼만)은
// 화면 컴포넌트 테스트 src/components/layout/pageHeader.test.tsx 가 지킨다(WP-966).
import { createProject } from '../factories/project.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test.describe('PageHeader — 전체폭 본문 페이지 정렬 (#880)', { tag: '@layout' }, () => {
  // 넓은 화면에서 contained(container mx-auto) 헤더는 제목·액션이 가운데로 몰려 전체폭 본문과 어긋난다.
  // 전체폭 본문 페이지는 헤더도 전체폭이어야 한다 — 제목은 좌측 끝, 액션은 우측 끝에 붙는지 검증.
  // container 최대폭(1536px)보다 넓어야 어긋남이 드러난다.
  test.use({ viewport: { width: 2000, height: 900 } })

  for (const path of ['/projects/WP', '/projects/WP/timeline?period=all']) {
    test(`${path} 헤더 제목·액션이 헤더 좌우 끝에 붙는다`, async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/projects/WP', createProject())
      await page.goto(path)

      const header = page.getByTestId('page-header')
      const heading = header.getByRole('heading', { level: 1 })
      await expect(heading).toBeVisible()
      const [h, title, lastAction] = (await Promise.all([
        header.boundingBox(),
        heading.boundingBox(),
        header.getByRole('button').last().boundingBox(),
      ])).map((b) => b!)
      // px-4(16px) + 아이콘/여유 — container 축이면 수백 px 벌어진다.
      expect(title.x - h.x).toBeLessThan(80)
      expect(h.x + h.width - (lastAction.x + lastAction.width)).toBeLessThan(40)
    })
  }
})
