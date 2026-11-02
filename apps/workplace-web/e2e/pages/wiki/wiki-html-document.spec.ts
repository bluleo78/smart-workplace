// 노트 「HTML 문서」 페이지(WP-1307) — 라우트 → 페이지 조회(kind HTML) → 격리 iframe 이 실제 브라우저에서 이어지는지(@wiring).
// 보기/소스 권한·저장 payload·409·내려받기 형식·버전 미리보기는 src/components/wiki/html-document/WikiHtmlDocumentView.test.tsx 가 지킨다.
import { wikiHtmlPageDetail, wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

test('HTML 문서 주소를 열면 원본이 스크립트까지 격리 iframe 에서 돌고, sandbox 에 allow-same-origin 이 없다', { tag: ['@wiring', '@smoke'] }, async ({
  authenticatedPage: page,
}) => {
  const detail = wikiHtmlPageDetail({
    id: 9,
    html: '<!doctype html><html><body><h1 id="t">매출 차트</h1><script>document.getElementById("t").textContent = "스크립트 실행됨"</script></body></html>',
  })
  await page.route('**/api/v1/wiki/spaces', (r) => r.fulfill(json([wikiSpace({ id: 1, name: '팀 노트', role: 'OWNER' })])))
  await page.route('**/api/v1/wiki/spaces/1/pages', (r) => r.fulfill(json([wikiPageSummary({ id: 9, title: detail.title, kind: 'HTML' })])))
  await page.route('**/api/v1/wiki/pages/9?*', (r) => r.fulfill(json(detail)))

  await page.goto('/wiki/spaces/1/pages/9')
  const frame = page.getByTestId('wiki-html-frame')
  await expect(frame).toBeVisible()
  // 스크립트가 돈 결과가 iframe 안에 보인다.
  await expect(frame.contentFrame().locator('#t')).toHaveText('스크립트 실행됨')
  await expect(frame).toHaveAttribute('sandbox', /(^|\s)allow-scripts(\s|$)/)
  await expect(frame).not.toHaveAttribute('sandbox', /allow-same-origin/)
  // 트리 행에 HTML 표시가 붙는다.
  await expect(page.getByTestId('wiki-tree-html-badge-9')).toHaveText(/HTML/)
})
