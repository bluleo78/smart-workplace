# 이슈 본문 편집칸 칸 안 이미지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이슈 본문 편집칸(Textarea)을 `RichInput` 본문 모드로 바꿔, 원문을 한 바이트도 바꾸지 않으면서 이 프로젝트 이슈 이미지를 칸 안에 보기 화면 크기로 그린다(WP-1656).

**Architecture:** `RichInput` 에 마운트 시점 고정 `bodyMode` 를 더해 편집칸만 그리고, 원문 ↔ 문서 변환은 지금 코멘트 경로(`bodyToDoc`/`serializeToBody`)를 쓴다. 붙여넣기·복사는 본문 모드 전용 순수 함수로 줄 단위를 지킨다. `InlineEditableBody` 는 버튼·초안·모바일 바를 그대로 맡고 편집칸만 바꾼다.

**Tech Stack:** React 19, TipTap 2.27.2(`@tiptap/pm` 의 ProseMirror), vitest(node·jsdom+MSW), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-issue-body-inline-images-design.md`

## Global Constraints

- 원문 보존: `serializeToBody(bodyToDoc(b, mentions, { images: true, imageProjectKey })) === b` — trim 없음, 바이트 단위.
- 칸 안 이미지는 `/api/v1/projects/{이 프로젝트 키}/issue-images/{id}` 만. 다른 프로젝트·외부 주소는 글자 그대로.
- 본문 모드 이미지 클래스는 보기 화면 `IssueBodyImage` 와 같다: `block h-auto max-h-[480px] max-w-full rounded-md border border-border`. 코멘트 입력창 `THUMB` 는 바꾸지 않는다.
- 본문 모드 키: Enter = 줄바꿈(전송 아님), Cmd/Ctrl+Enter = 저장, Esc = 취소(업로드 중엔 무시 — 지금과 같다).
- 코멘트·채팅 입력창(본문 모드가 아닌 `RichInput`)의 붙여넣기·복사·trim·Enter·이미지 크기 동작은 바꾸지 않는다.
- 저장 형식·API·MCP 는 바꾸지 않는다.
- 한국어 주석 필수(무엇을·왜). 새 의존성을 더하지 않는다(실행 취소는 `@tiptap/pm/history`).
- 셸 명령은 단순하게: 한 줄 함수 정의(`f(){ …; }`)·`${…:-{…}}` 중괄호 확장·`;`/`&&` 로 길게 이은 한 줄 금지 — 복잡하면 스크립트 파일로.
- 테스트 종류: 기본 vitest. E2E 는 `@input`·`@layout` 처럼 브라우저가 필요한 것만, 태그를 단다.
- `data-testid="issue-body-textarea"` 는 본문 편집칸(contenteditable)에 그대로 둔다.

## Review Focus

1. 끝 줄바꿈·연속 빈 줄·앞 공백·탭이 든 본문을 열고 저장 — PATCH 가 가지 않아야 한다(바깥 비교가 trim 하지 않는지).
2. 줄 중간에 커서를 두고 여러 줄을 붙여넣기 — 첫 줄은 커서 앞 글자에, 마지막 줄은 커서 뒤 글자에 이어져야 한다(열린 조각).
3. HTML 이 함께 온 클립보드(브라우저·노트에서 복사) — 서식으로 바뀌지 않고 일반 글자만.
4. 업로드 중 Esc·저장·모바일 바 — 모두 막혀 자리표시가 빈 이미지로 저장되지 않는다.
5. 초안 「불러오기」 뒤 편집칸이 초안 원문을 보여 주고, 그 뒤 고친 것이 draft 로 이어진다.

---

### Task 1: `RichInput` 본문 모드와 원문 보존 함수

**Files:**
- Modify: `apps/workplace-web/src/components/mentions/mentionSerialize.ts`(`bodyToDoc` 에 `imageProjectKey?: string` — 있으면 그 프로젝트 이미지만 노드)
- Create: `apps/workplace-web/src/components/mentions/bodyModeClipboard.ts`
- Create: `apps/workplace-web/src/components/mentions/RichBodyImageNodeView.tsx`
- Modify: `apps/workplace-web/src/components/mentions/richImageNode.ts`(`RichBodyImage` 내보내기 — 같은 노드 이름 `image`, 이 프로젝트 경로만 받는 acceptSrc 는 만드는 함수로: `createRichBodyImage(projectKey)`)
- Create: `apps/workplace-web/src/components/mentions/bodyHistory.ts`(`@tiptap/pm/history` 의 history 플러그인 + Mod-z / Mod-Shift-z / Mod-y)
- Modify: `apps/workplace-web/src/components/mentions/RichInput.tsx`
- Create: `apps/workplace-web/src/components/mentions/__fixtures__/issueBodySamples.ts`
- Test: `apps/workplace-web/src/components/mentions/bodyModeRoundtrip.test.ts`, `apps/workplace-web/src/components/mentions/bodyModeClipboard.test.ts`, `apps/workplace-web/src/components/mentions/RichInputBodyMode.test.tsx`

**Interfaces:**
- Produces:
  - `bodyToDoc(body, mentions, { images?: boolean; formatting?: boolean; imageProjectKey?: string })`
  - `bodyTextToSlice(text: string, schema: Schema, opts: { mentions: MentionUser[]; projectKey: string }): Slice` — `\r\n|\r|\n` 하나마다 문단, 열린 조각(openStart=1, openEnd=1).
  - `sliceToBodyText(slice: Slice): string` — 문단 사이 `\n` 하나, 멘션 `<@id>`, src 있는 이미지 `![alt](src)`, hardBreak `\n`(즉 `serializeToBody` 와 같은 규칙).
  - `RichInput` 새 props: `bodyMode?: { projectKey: string }`, `onBodyChange?: (body: string) => void`, `onUploadingChange?: (uploading: boolean) => void`, `ref?: Ref<RichInputHandle>`; `export interface RichInputHandle { insertImages: (files: File[]) => void }`. 본문 모드에서 `onSubmit(body)` 는 Cmd/Ctrl+Enter 로만, 다듬지 않은 원문으로 부른다.

- [ ] **Step 1: 표본 만들기** — `issueBodySamples.ts` 에 `export const ISSUE_BODY_SAMPLES: { key: string; body: string }[]`. genia-works MCP `get_issue_detail({ issueKey })` 로 WP-1024·WP-1146·WP-1461·WP-571·WP-594·WP-1340·WP-1342·WP-1081·WP-163·WP-361·WP-1656 의 `body` 를 그대로(바이트 그대로 — 템플릿 리터럴이면 `` ` ``·`${` 이스케이프, 아니면 JSON 문자열) 넣는다. MCP 를 쓸 수 없으면 그 사실을 보고하고 합성 사례만 둔다. 합성 사례(`SYNTHETIC_SAMPLES`)도 둔다: 끝 줄바꿈 하나·둘, 연속 빈 줄 3개, 앞 공백·탭, `<note>`·`<a@b.c>`, 표, ```` ``` ```` 코드 펜스 안 빈 줄, `- [ ]` 체크리스트, `1.`·`3.` 번호 목록, 이 프로젝트 이미지 줄·줄 중간 이미지, 다른 프로젝트 이미지, `<@12>` 멘션, `\r` 없는 빈 본문 `''`.
- [ ] **Step 2: 왕복 테스트 작성(실패 확인)** — `bodyModeRoundtrip.test.ts`: 모든 표본에 `expect(serializeToBody(bodyToDoc(b, [], { images: true, imageProjectKey: 'WP' }))).toBe(b)`; 다른 프로젝트 이미지(`/api/v1/projects/ZZ/issue-images/1`)는 결과 문서에 image 노드가 없음; 이 프로젝트 이미지는 image 노드가 있음; 「한 글자 고침」 — 문서의 마지막 텍스트 노드 끝에 `X` 를 더한 문서를 직렬화하면 원문에 그 한 글자만 더해진 것(해당 위치 기준 문자열 비교). `pnpm vitest run src/components/mentions/bodyModeRoundtrip.test.ts` → `imageProjectKey` 미구현으로 실패.
- [ ] **Step 3: `bodyToDoc` 의 `imageProjectKey`** 구현 → Step 2 통과.
- [ ] **Step 4: 붙여넣기·복사 함수 테스트 작성(실패 확인)** — `bodyModeClipboard.test.ts`(jsdom 불필요 — 에디터 스키마는 `getSchema([...RichInput 본문 모드 확장])` 로): `bodyTextToSlice('a\n\nb\r\nc', …)` 의 조각이 문단 4개(`a`,빈,`b`,`c`)·openStart 1·openEnd 1; 이미지 마크다운 줄은 image 노드; `sliceToBodyText` 가 그 조각을 `'a\n\nb\nc'` 로; 여러 줄 마크다운(표·코드 펜스·빈 줄) 원문이 `sliceToBodyText(bodyTextToSlice(t))` 로 그대로(`\r\n` 은 `\n`).
- [ ] **Step 5: `bodyModeClipboard.ts` 구현** → 통과.
- [ ] **Step 6: 본문 모드 컴포넌트 테스트 작성(실패 확인)** — `RichInputBodyMode.test.tsx`(`renderWithProviders`, `useApiBlobUrl` 는 `vi.mock` 으로 고정 blob url): ① 본문 모드에서 Enter keyDown 이 `onSubmit` 을 부르지 않는다 ② `Meta+Enter`·`Control+Enter` 가 다듬지 않은 원문(끝 줄바꿈 포함)으로 `onSubmit` ③ Esc → `onCancel` ④ 버튼 줄·전송 버튼이 없다 ⑤ 이 프로젝트 이미지 줄은 `data-testid="rich-image"` 안 `<img>` 가 `max-h-[480px]`·`max-w-full` 클래스이고 `h-14` 가 없다 ⑥ 다른 프로젝트 이미지 줄은 글자로 남는다 ⑦ 내용을 바꾸면(`editor.commands.setContent` — `src/test/kits/projects/issueDetailRef.ts` 의 `setRichText` 와 같은 방식) `onBodyChange` 가 다듬지 않은 원문으로 불린다 ⑧ `ref.current.insertImages([png])` 뒤 업로드가 끝나기 전 `onUploadingChange(true)`, 끝나면 `false` 와 원문에 `![이름](url)` ⑨ 본문 모드가 아닌 RichInput(코멘트)은 이미지가 `h-14` 썸네일이고 Enter 가 전송한다(회귀).
- [ ] **Step 7: 구현** — `RichBodyImageNodeView`(보기 크기 클래스, 자리표시·실패는 지금 상자 모양), `createRichBodyImage(projectKey)`, `bodyHistory`, `RichInput` 의 본문 모드(편집칸만 렌더, `handleKeyDown` 분기, `handlePaste` 에서 이미지 파일만이면 업로드·`text/plain` 이 있으면 `bodyTextToSlice` 로 `tr.replaceSelection(slice).scrollIntoView()`, `clipboardTextSerializer: sliceToBodyText`, `onUpdate` 에서 `onBodyChange(serializeToBody(json))`·`onUploadingChange(hasPendingImage)`, `useImperativeHandle` 로 `insertImages`). 모든 ref 패턴은 기존 RichInput 주석 관례를 따른다 → Step 2·4·6 통과.
- [ ] **Step 8: 검사** — `cd apps/workplace-web` 에서 `pnpm vitest run src/components/mentions` · `pnpm typecheck` · `pnpm lint` 통과.
- [ ] **Step 9: 커밋** — `feat(web): RichInput 에 원문을 그대로 지키는 본문 모드를 더한다 (WP-1656)`(본문에 Co-Authored-By 줄 — 저장소 커밋 규칙).

### Task 2: 이슈 본문 편집칸을 본문 모드로 바꾸고 기존 기능·테스트·매뉴얼을 맞춤

**Files:**
- Modify: `apps/workplace-web/src/components/issue/InlineEditableBody.tsx`
- Modify(테스트 조작을 contenteditable 로): `src/pages/projects/issueDetailEdit.test.tsx`, `issueBodyImages.test.tsx`, `issueConcurrentEdit.test.tsx`, `issueDetailLayout.test.tsx`, `personalProjectDetail.test.tsx`, `src/pages/mobile/mobileIssueDetail.test.tsx`, `e2e/pages/projects/issue-title-body-edit.spec.ts`, `issue-body-images.spec.ts`, `open-issue-permissions.spec.ts`
- Create: `apps/workplace-web/e2e/pages/projects/issue-body-rich-edit.spec.ts`
- Modify: `docs/manual/user/08-work.md`

**Interfaces:**
- Consumes: Task 1 의 `RichInput` 본문 모드 props·`RichInputHandle`.

- [ ] **Step 1: 페이지 테스트 먼저 바꾸기(실패 확인)** — 위 vitest 파일의 Textarea 조작(`user.type`·`clear`·`fireEvent.change`·`toHaveValue`)을 편집칸 기준으로: 값 쓰기는 `setRichText` 를 원문 줄 단위로 쓰는 도우미(새로 `setRichBody(el, text)` — `bodyToDoc` 로 만든 문서를 `setContent`), 값 읽기는 화면 글자 또는 PATCH payload. 새 판정 더하기: ① 끝 줄바꿈·빈 줄·꺾쇠·표가 든 본문을 열고 저장 → PATCH 없음 ② 한 줄 끝에 글자 하나 더해 저장 → PATCH body 가 원문 + 그 글자 ③ 이미지가 든 기존 본문을 열면 편집칸 안 `rich-image` `<img>` ④ 업로드 중(업로드 MSW 응답을 늦춤) 저장 버튼 비활성·Cmd+Enter 무시 ⑤ 초안 배너 「불러오기」 뒤 편집칸에 초안 원문, 저장하면 그 원문 ⑥ 5만 자 넘으면 안내·저장 막힘 ⑦ 모바일 하단 바 저장. `pnpm vitest run <파일들>` → Textarea 가 남아 실패.
- [ ] **Step 2: `InlineEditableBody` 구현** — Textarea·`useIssueImageUpload`·`useAutoGrowTextarea` 를 본문 모드 `RichInput` 으로(`key` 는 편집 진입·불러오기마다 바꿔 새 원문으로, `editorMaxHeightClass` 는 `min-h-[160px]` + 데스크톱 `max-h-[70vh]`, `inputTestId="issue-body-textarea"`, `ariaLabel` 「본문」(개인 작업은 editLabel 에 맞춰), `autoFocus`, `disabled` 면 편집 불가). 「이미지」 버튼은 `richRef.current?.insertImages`. 옛 자리표시 토큰(`hasPendingToken` — `useIssueImageUpload` 쪽 판정 함수를 직접 import 해 재사용)이 든 draft 의 저장 안내는 그대로. 다른 곳이 `useIssueImageUpload` 를 더 쓰지 않으면 지우지 말고 그대로 둔다(WP-1657 이 정리) → Step 1 통과.
- [ ] **Step 3: E2E 바꾸기·더하기** — 기존 spec 의 textarea `fill`/`toHaveValue` 를 편집칸(`click` 후 `keyboard.type`·`insertText`, 값은 PATCH 또는 화면 글자)으로. 새 `issue-body-rich-edit.spec.ts`: `@input` 실제 클립보드 붙여넣기(일반 글자만 / 일반+HTML — `page.evaluate` 로 `ClipboardEvent('paste', { clipboardData })` 를 편집칸에 dispatch) 뒤 저장한 PATCH body 의 붙여넣은 부분이 클립보드 글자와 같다; `@input` 여러 줄 선택 복사(`copy` 이벤트의 `clipboardData.getData('text/plain')`)가 원문 줄 간격과 같다; `@input` 한글 조합 Enter(기존 IME 테스트 방식 — `e2e` 에서 `ImeCommitFlush` 를 쓰는 spec 을 찾아 같은 방법)로 줄바꿈되고 마지막 글자가 남는다; `@input` 이미지 붙여넣기 → 자리표시 → 이미지(보기 크기); `@layout` 390px 에서 편집칸·넓은 이미지가 화면 폭 안. `pnpm test:e2e e2e/pages/projects/issue-body-rich-edit.spec.ts e2e/pages/projects/issue-title-body-edit.spec.ts e2e/pages/projects/issue-body-images.spec.ts e2e/pages/projects/open-issue-permissions.spec.ts` 통과.
- [ ] **Step 4: 긴 본문 측정** — E2E 안에서(또는 별도 측정 스크립트로) 줄 1,000개·약 4만 9천 자 합성 본문을 열고 끝에 20자를 타이핑하며 키마다 `keydown` → 다음 `requestAnimationFrame` 까지 시간을 재 중앙값·최댓값을 콘솔에 남긴다. 측정값을 보고서에 적는다(단언은 느슨하게 — 최댓값 < 200ms 정도. 기계 부하로 흔들리면 단언 없이 기록만).
- [ ] **Step 5: 매뉴얼** — `docs/manual/user/08-work.md` 「이슈를 열어 진행한다」 3번 앞뒤에 본문 편집 설명: 본문을 누르면 원문을 고친다, 붙여넣거나 끌어다 놓은 이미지(또는 **이미지** 단추)는 편집칸 안에 저장한 뒤와 같은 크기로 보인다, Ctrl+Enter(맥은 ⌘+Enter)로 저장·Esc 로 취소. `pnpm manual:check`·`pnpm manual:prose`(루트) 통과.
- [ ] **Step 6: 검사** — `cd apps/workplace-web` 에서 `pnpm test`(전체 vitest) · `pnpm typecheck` · `pnpm lint` 통과.
- [ ] **Step 7: 커밋** — `feat(web): 이슈 본문 편집칸에서 붙여넣은 이미지를 칸 안에 그림으로 보인다 (WP-1656)`.
