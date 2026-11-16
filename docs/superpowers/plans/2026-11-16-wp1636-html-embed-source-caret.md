# WP-1636 — 노트 HTML 블록 소스 편집 E2E 간헐 실패 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `wiki-html-embed.spec.ts` 의 소스 편집 테스트가 부하 속에서도 캐럿을 소스 끝에 확실히 두고 Enter·입력을 하게 한다.

**Architecture:** 실패 원인 — 테스트가 `code.click()` 뒤 `End` 로 캐럿을 옮기는데, ProseMirror 는 키로 바뀐 DOM 선택을 비동기 `selectionchange` 로만 읽는다. keydown 의 `forceFlush` 는 이미 잡힌 flush 가 있을 때만 돌아, 부하로 `selectionchange` 가 늦으면 Enter 가 옛 상태 선택(누른 자리 — 첫 글자 뒤)에서 처리된다(기대 `<p id="v">one</p>\n<p id="w">two</p>`, 받은 값 `<\n<p id="w">two</p>p id="v">one</p>`). 같은 문제를 노트 문단에서는 `e2e/fixtures/collab.ts` 의 `placeCaret`(상태 선택에 바로 박음)으로 이미 풀었다. 그 도우미를 Locator 기준으로 일반화해 `caretAtEndOf(locator)` 를 내보내고, 소스 칸의 `click()+End` 두 곳을 이 도우미로 바꾼다.

**Tech Stack:** Playwright E2E, Tiptap/ProseMirror(`.ProseMirror` 의 `editor` 인스턴스).

**Spec:** 이슈 WP-1636 본문(설계는 이 계획 「설계(승인됨)」 절 — 작은 변경이라 따로 문서를 두지 않는다).

## 설계(승인됨 — 무인 세션이라 스스로 승인)

> **최종(브랜치 리뷰 뒤 바꿈)**: `/code-review` 가 「소스 편집」 단추(`toggleSource`, WikiHtmlEmbedView.tsx)가 이미 캐럿을 소스 끝에 두고 포커스를 준다고 짚었다. 그래서 `caretAtEndOf` 도우미와 `collab.ts` 일반화는 되돌리고, 소스 칸 두 곳의 누름·End 를 **아예 지워** 단추가 둔 캐럿으로 바로 입력한다 — 실제 키 입력을 남기면서 제품 계약(토글 = 끝 캐럿)까지 시험한다. 아래 A~C 는 처음 검토한 기록이다.

- **접근 A(채택)**: 상태 선택에 바로 둔다 — `placeCaret` 의 글자 노드 찾기·`view.focus()`·`setTextSelection(posAtDOM)` 을 Locator 를 받는 함수로 빼고, 문단용 `caretAtEnd`·`caretBeforeChar` 는 그 함수를 쓴다. 저장소에 이미 있는 방식(WP-55·WP-250)과 같고, 한 번의 evaluate 안이라 원격 갱신이 끼지 못한다.
- 접근 B(버림): End 뒤 상태 선택이 끝으로 올 때까지 `expect.poll` — 그 사이 뷰 갱신(awareness)이 옛 선택을 DOM 에 다시 쓰면 End 가 사라져 poll 이 시간 초과로 실패한다(`placeCaret` 주석의 기전).
- 접근 C(버림): 제품에서 keydown 때 DOM 선택을 강제로 읽기 — 사람 입력 속도에서는 나지 않는 문제라 제품 코드를 바꿀 까닭이 없고 ProseMirror 동작을 덮어 위험하다.
- 범위: `wiki-html-embed.spec.ts` 의 ProseMirror 소스 칸 두 곳(143·299 줄)만. iframe 안 「글자 고치기」의 End(542·548·584 줄)는 ProseMirror 가 아니라 해당하지 않는다. 다른 spec 의 End 는 보고된 실패가 없어 건드리지 않는다(남은 위험으로 적는다).

## Global Constraints

- 한국어 주석(무엇을·왜). 고정 대기(`waitForTimeout`) 금지.
- 테스트의 판정 태그(`@input`)와 검증 의도(소스 안 Enter 는 코드 줄바꿈, 줄 번호 1·2, 미리보기 다시 그림)는 그대로 둔다 — Enter·insertText 는 실제 키 입력으로 남긴다.
- 셸 명령은 단순하게: 한 줄 셸 함수 정의, `${…:-{…}}` 중괄호 확장, `;`·`&&` 로 길게 이은 한 줄을 쓰지 않는다. 복잡하면 스크립트 파일에 적어 실행한다.
- 커밋은 하지 않는다(본 세션이 합친다).

## Review Focus

1. 소스 칸 글자가 색 구분 장식(`wiki-html-tok--*` span) 안에 쪼개져 있어도 마지막 글자 노드 끝 = 소스 끝이어야 한다 — 143·299 테스트의 기대 문자열이 이를 지킨다.
2. 소스 칸 안에 빈 글자 노드(ProseMirror 가 끼우는 hack 노드 등)가 끝에 있어도 건너뛴다 — 기존 `placeCaret` 의 `length === 0` 건너뛰기를 그대로 쓴다.
3. 문단용 `caretAtEnd`·`caretBeforeChar` 를 쓰는 기존 spec(wiki-box·wiki-paste-shape·wiki-collab-features 등)의 동작이 바뀌지 않아야 한다 — 그 spec 들을 다시 돌린다.
4. 대상 요소가 에디터 밖이면 지금처럼 「에디터 안에 없다」 오류로 바로 실패해야 한다(조용히 넘어가지 않게).

---

### Task 1: `caretAtEndOf` 도우미와 소스 칸 두 곳 교체

**Files:**
- Modify: `apps/workplace-web/e2e/fixtures/collab.ts:300-370`(`placeCaret`·`caretAtEnd`·`caretBeforeChar`)
- Modify: `apps/workplace-web/e2e/pages/wiki/wiki-html-embed.spec.ts:141-144`, `:297-300`, import 줄

**Interfaces:**
- Produces: `export function caretAtEndOf(target: Locator): Promise<void>` — `collab.ts` 에서. target 안 마지막(빈 것 제외) 글자 노드 끝에 상태 선택을 두고 에디터에 포커스.
- 내부: `placeCaret(page, paragraph, at)` 는 `placeCaretIn(locator, at)`(이름 자유, 내보내지 않음)로 위임 — 문단 Locator 는 지금과 같이 `.ProseMirror p` + `hasText` + `.first()`.

- [ ] **Step 1: 고치기 전 간헐 실패 재현 시도** — `apps/workplace-web` 에서 `pnpm test:e2e e2e/pages/wiki/wiki-html-embed.spec.ts -g "소스 편집에서 코드를 고치면" --repeat-each=30 --workers=8 --retries=0`. 실패가 나면 받은 값을 기록한다. 안 나도 진행한다(부하 의존 — 결과를 보고에 적는다).
- [ ] **Step 2: `collab.ts` 일반화** — 위 Interfaces 대로. `placeCaret` 의 JSDoc(왜 상태에 바로 박는가)은 일반화한 함수로 옮기고, `caretAtEndOf` 에는 「키(End·누름)로 옮긴 DOM 선택은 selectionchange 로 늦게 읽혀 부하에서 Enter·입력이 옛 자리에 들어간다(WP-1636)」 한 줄 주석.
- [ ] **Step 3: spec 교체** — 143 줄 부근 `await sourceBox.locator('code').click()` + `End` → `await caretAtEndOf(sourceBox)`; 299 줄 부근 `await code.click()` + `End` → `await caretAtEndOf(block.getByTestId('wiki-html-embed-source'))`. 각 자리에 왜 누름·End 를 쓰지 않는지 짧은 주석(`caretAtEndOf` 참고). import 에 `caretAtEndOf` 추가.
- [ ] **Step 4: 대상 spec 반복 실행** — Step 1 명령을 그대로(두 테스트 다 포함되게 `-g "소스"` 로 넓혀도 됨). Expected: 실패 0.
- [ ] **Step 5: 문단 도우미 회귀** — `pnpm test:e2e e2e/pages/wiki/wiki-html-embed.spec.ts e2e/pages/wiki/wiki-box.spec.ts e2e/pages/wiki/wiki-paste-shape.spec.ts e2e/pages/wiki/wiki-collab-features.spec.ts`. Expected: 모두 통과.
- [ ] **Step 6: 정적 검사** — `apps/workplace-web` 에서 `npx tsc -p tsconfig.e2e.json --noEmit`, `pnpm lint`. Expected: 오류 0.
