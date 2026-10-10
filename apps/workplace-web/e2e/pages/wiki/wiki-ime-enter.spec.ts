// 노트 본문 — macOS Chrome 에서 한글 마지막 글자 조합 중 Enter 를 쳐도 그 글자가 사라지지 않는다 (WP-333)
//
// Mac Chrome 은 "마지막 조합 글자 확정(DOM 변경) → compositionend → Enter keydown" 을 한 태스크 안에서 보내,
// ProseMirror 가 확정 글자를 문서에 반영하기 전에 줄 나누기가 돈다. 같은 순서를 만들어 수정(ImeCommitFlush) 뒤 동작을 지킨다.
// 한계: 실제 macOS 입력기의 글자 소실 자체는 합성 이벤트로 재현되지 않는다(이 경로에선 ProseMirror 가 늦은 변경을 맞춰 넣음) —
// 원인 메커니즘은 src/lib/imeCommitFlush.test.ts 가, 실제 소실 해소는 실기기 진단으로 확인했다.
import { expect, test } from '../../fixtures/auth.fixture'
import { commitImeThenEnterInSameTask } from '../../fixtures/ime'
import { mockWikiPageEditor } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 300

test('마지막 글자 조합 중 Enter — 글자는 남고 다음 줄로 넘어가 이어 쓸 수 있다', async ({ authenticatedPage: page }) => {
  await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: 'IME 페이지', body: '첫 줄', role: 'EDITOR' })
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const editor = page.locator('.ProseMirror').first()
  await expect(editor).toContainText('첫 줄')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' 가나')

  // "다" 를 조합하다(화면엔 "닥") Enter — 확정하며 "다" 로 다시 쓰는 변경이 문서에 반영되기 전에 Enter 가 온다
  await commitImeThenEnterInSameTask(editor, { composing: '닥', committed: '다' })
  await page.keyboard.insertText('다음')

  // 확정 글자 "다" 가 첫 줄에 남고, Enter 로 새 줄이 생겨 이어 쓴 글자는 둘째 줄에 들어간다
  await expect(editor.locator('p')).toHaveText(['첫 줄 가나다', '다음'])
})
