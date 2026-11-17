# 이슈 생성 창 본문 칸 안 이미지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이슈 생성 다이얼로그(데스크톱)·모바일 생성 시트의 본문 칸을 WP-1656 의 본문 모드 `RichInput` 으로 바꿔, 붙여넣은 이미지를 칸 안에서 그림으로 본다.

**Architecture:** 폼 훅 `useIssueCreateForm` 이 Textarea 이미지 업로드 훅(`useIssueImageUpload`) 대신 본문 모드 `RichInput` 에 넘길 묶음(`bodyEditor`)과 `uploading` 상태를 낸다. 두 화면은 그 묶음으로 `RichInput` 을 그린다. 모바일용으로 `RichInput` 본문 모드에 테두리 없는 모양(`frame: 'bare'`)을 더한다.

**Tech Stack:** React 19 + TS, TipTap(ProseMirror), react-hook-form + zod, vitest(jsdom, msw), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-issue-create-body-inline-images-design.md`

## Global Constraints

- 작업 폴더: `apps/workplace-web`(워크트리 `/work/agents/developer7@iacloud.kr/repos/WP/.claude/worktrees/WP-1657`). 셸 명령은 단순하게 — 한 줄 셸 함수 정의, `${…:-{…}}`, `;`/`&&` 로 길게 이은 한 줄 금지(복잡하면 스크립트 파일). bare `git stash` 금지.
- 포트 6060/6070/6080/6090/6095/6173/6174/5434 를 쓰는 프로세스를 띄우거나 끄지 않는다. `pnpm dev`·`db:*` 금지.
- 한국어 주석(무엇을·왜) 필수 — 바꾼 컴포넌트·훅·함수·주요 분기.
- 보내는 본문은 다듬지 않은 원문(trim 없음). 이미지 줄은 `![이름](/api/v1/projects/{키}/issue-images/{id})`.
- 업로드 중 생성 막기 토스트 문구: `이미지 업로드가 끝난 뒤 등록해 주세요`(지금 문구 그대로).
- 모바일 본문 안내 문구 `설명 (선택)`, 접근성 이름 `설명`, testid `issue-create-body`, 오류 id `issue-create-body-error`. 데스크톱 접근성 이름 `본문`, testid `issue-body`, 오류 id `issue-body-error`, 최대 높이 `max-h-[40vh]`.
- 코멘트·채팅 입력창과 본문 편집(`InlineEditableBody`) 동작은 바꾸지 않는다. `IssueDraftFields`·API·MCP 는 범위 밖.
- 커밋 메시지는 `docs/COMMIT_CONVENTION.md`(한국어, `feat(web): … (WP-1657)`), 끝 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `--no-verify` 금지.

## Review Focus

1. 이미지 업로드만 하는 중(제목·본문 글자 없음)에 닫기 → 버림 확인이 떠야 한다(그냥 닫히면 업로드가 버려짐). — Task 2 테스트.
2. 만들고 나서 다시 열면 본문 칸이 비어 있어야 한다(앞 편집기 내용·업로드 상태가 남지 않음). — Task 2 테스트.
3. 멘션 팝업이 열린 채 Esc → 팝업만 닫히고 창은 그대로. — Task 2 테스트(데스크톱), Task 3 테스트(모바일).
4. 본문 5만 자 초과 → 오류 문구가 보이고 편집칸 `aria-invalid="true"`, POST 없음; 줄이면 오류가 걷힌다. — Task 2·3 기존 테스트 고침.
5. 접수 전용(OPEN 프로젝트 비구성원)·AI 제안 받기도 편집칸 본문을 쓴다. — Task 2 기존 테스트 고침 + AI 제안 테스트.

---

### Task 1: `RichInput` 본문 모드 테두리 없는 모양

**Files:**
- Modify: `src/components/mentions/RichInput.tsx`(`bodyMode` prop 타입·편집칸 class, ~121·~458행)
- Test: `src/components/mentions/RichInputBodyMode.test.tsx`

**Interfaces:**
- Produces: `bodyMode?: { projectKey: string; frame?: 'boxed' | 'bare' }` — 생략·`'boxed'` 는 지금과 같음.

- [ ] **Step 1: 실패하는 테스트** — `RichInputBodyMode.test.tsx` 의 기존 렌더 도우미로:
  - `it('frame bare 면 테두리·안쪽 여백·최소 160px 없이 3줄 높이(min-h-[4.5rem])·text-base')` — 편집칸 class 에 `min-h-[4.5rem]`·`text-base` 가 있고 `border`·`min-h-40`·`px-3` 이 없다.
  - `it('frame 을 주지 않으면 지금 모양(min-h-40·border)')` — class 에 `min-h-40`·`border-input`.
- [ ] **Step 2:** `pnpm vitest run src/components/mentions/RichInputBodyMode.test.tsx` → 새 테스트 FAIL.
- [ ] **Step 3: 구현** — `bare` 일 때 class: `chat-rich-input min-h-[4.5rem] {editorMaxHeightClass} overflow-auto bg-transparent text-base leading-6 focus-visible:outline-none`(테두리·rounded·px/py·ring 없음). 나머지 본문 모드 동작은 그대로.
- [ ] **Step 4:** 같은 명령 → PASS. `pnpm typecheck` 통과.
- [ ] **Step 5: 커밋** — `feat(web): 본문 모드 편집칸에 테두리 없는 모양을 더한다 (WP-1657)`.

### Task 2: 폼 훅 + 데스크톱 생성 다이얼로그 + 모바일 시트 본문 교체

훅을 바꾸면 두 화면이 함께 바뀌어야 컴파일되므로 한 과제로 둔다.

**Files:**
- Modify: `src/pages/projects/hooks/useIssueCreateForm.ts`
- Modify: `src/pages/projects/components/IssueCreateDialog.tsx`
- Modify: `src/pages/projects/components/mobile/MobileIssueCreateSheet.tsx`
- Create: `src/lib/richBodyTarget.ts`(+ `src/lib/richBodyTarget.test.ts`)
- Delete: `src/hooks/useIssueImageUpload.ts`(다른 사용처가 없음을 grep 으로 확인 뒤). `src/lib/imageUpload.ts` 머리 주석의 `useIssueImageUpload` 언급을 「이슈 본문 편집칸(RichInput 본문 모드)」으로 고친다. `lib/markdownImageInsert.ts` 는 `InlineEditableBody` 가 쓰므로 남긴다.
- Test: `src/pages/projects/issueCreateBody.test.tsx`(새 화면 테스트), 고침: `src/pages/projects/openIssuePermissions.test.tsx:101`, `src/pages/projects/issueTypes.test.tsx:110-113`, `src/pages/mobile/issueCreate.test.tsx:62-69`

**Interfaces:**
- Consumes: Task 1 `bodyMode.frame`. 기존 `RichInput` props(`ref: Ref<RichInputHandle>`, `bodyMode`, `imageUpload`, `members`, `initialBody`, `ariaLabel`, `placeholder`, `inputTestId`, `submitTestId`, `editorAria`, `editorMaxHeightClass`, `onBodyChange`, `onUploadingChange`, `onSubmit`, `onCancel`, `focusRequest`, `onFocusRequestDone`), `RichInputHandle.insertImages(files)`, `uploadIssueImage(projectKey, file)`(`@/api/issueImages`), `useProjectMembers(projectKey)`. 쓰는 법은 `src/components/issue/InlineEditableBody.tsx` 의 `<RichInput>` 를 본다.
- Produces:
  - `useIssueCreateForm` 반환에서 `images`·`bodyRef`·`bodyField` 를 빼고 `bodyEditor: { ref: RefObject<RichInputHandle | null>; bodyMode: { projectKey: string }; imageUpload: (file: File) => Promise<{ url: string; name: string }>; members: MentionCandidate[]; onBodyChange: (body: string) => void; onUploadingChange: (uploading: boolean) => void }` 과 `uploading: boolean` 을 더한다. `bodyMode`·`imageUpload`·두 콜백은 메모해 렌더마다 같은 참조.
  - `isRichBodyTarget(target: EventTarget | null): boolean`(`src/lib/richBodyTarget.ts`) — 대상이 ProseMirror 편집칸(`.ProseMirror`) 안이면 true.

- [ ] **Step 1: 실패하는 테스트** — `issueCreateBody.test.tsx`(데스크톱: `openIssuePermissions.test.tsx`·`issueTypes.test.tsx` 의 데스크톱 렌더 방식, 모바일: `issueCreate.test.tsx` 의 `renderMobileRoute`·`mockViewport`; 업로드는 `InlineEditableBody.test.tsx` 처럼 `@/api/issueImages` 를 `upload.next` 로 끊고, 편집기는 `editorOf(el)`(`el.editor`)로 꺼낸다). POST 본문은 msw 핸들러로 모은다.
  - 데스크톱 `it('제목과 여러 줄 본문(앞뒤 공백·빈 줄 포함)을 그대로 보낸다')` — 편집기 내용을 `'  첫 줄\n\n둘째 줄  '` 원문이 되게 넣고(`bodyTextToSlice` 붙여넣기 또는 `fireEvent.paste` + `text/plain`) 생성 → `posts[0].body === '  첫 줄\n\n둘째 줄  '`.
  - 데스크톱 `it('「이미지」 버튼으로 넣은 이미지가 끝나면 본문에 ![이름](url) 로 간다')` — `upload.next` 가 `{ url: '/api/v1/projects/WP/issue-images/7', name: 'a.png' }` 를 주게 하고 버튼 파일 입력에 `a.png` → 편집칸 안 `img` 보임 → 생성 → `posts[0].body` 에 `![a.png](/api/v1/projects/WP/issue-images/7)` 포함.
  - 데스크톱 `it('업로드 중에는 생성 버튼이 잠기고, 폼 제출(Enter)도 토스트로 막는다')` — 끝나지 않는 업로드 → 「생성」 disabled, 제목 칸 Enter 제출 → `이미지 업로드가 끝난 뒤 등록해 주세요`, POST 0건.
  - 데스크톱 `it('글자 없이 이미지 업로드 중에 취소하면 버림 확인이 뜬다')` — `issue-create-discard-dialog` 보임.
  - 데스크톱 `it('Cmd+Enter 는 폼 제출')` — 제목 입력 뒤 편집칸에서 `{ key: 'Enter', metaKey: true }` → POST 1건.
  - 데스크톱 `it('편집칸 Esc — 멘션 팝업이 열려 있으면 팝업만 닫고 창은 그대로, 다음 Esc 는 닫기 요청')` — 구성원 목록이 있는 상태로 `@` 입력해 팝업 → Esc → 다이얼로그 그대로·팝업 사라짐 → 본문이 있으므로 다음 Esc 에 버림 확인.
  - 데스크톱 `it('만들고 다시 열면 본문 칸이 비어 있다')` — 생성 성공 뒤 다시 열기 → 편집기 `textContent === ''`.
  - 데스크톱 `it('AI 제안 받기는 편집칸 본문을 보낸다')` — 본문 입력 뒤 「AI 제안」 → 분류 요청 body 의 `body` 가 그 원문.
  - 모바일 `it('제목 Enter 는 본문 편집칸으로 포커스를 옮긴다')` — `issue-create-title` 에 Enter → `document.activeElement` 가 `issue-create-body` 편집칸(또는 그 안).
  - 모바일 `it('편집칸 Esc — 멘션 팝업만 닫고, 팝업이 없으면 내용이 있을 때 버림 확인')`.
  - 모바일 `it('본문에 넣은 이미지가 끝나면 POST 본문에 ![이름](url)')` — 붙여넣기(`clipboardData.files`) 경로.
  - `richBodyTarget.test.ts`: `.ProseMirror` 안의 `p` → true, 일반 `input` → false, `null` → false.
- [ ] **Step 2:** `pnpm vitest run src/pages/projects/issueCreateBody.test.tsx src/lib/richBodyTarget.test.ts` → FAIL.
- [ ] **Step 3: 훅 구현** — `useIssueCreateForm.ts`:
  - `useIssueImageUpload`·`bodyRef`·`bodyField` 제거. `register('body')` 는 ref 없이 한 번 불러 검사 대상으로 남긴다.
  - `onBodyChange(v)` → `setValue('body', v, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })`(제출 뒤 줄이면 5만 자 오류가 걷히게).
  - `uploading` state, `onUploadingChange` 로 갱신, 열 때(`open` effect)마다 `false`.
  - `hasContent = hasIssueDraftContent(titleValue, bodyValue) || uploading`. `isSubmitting = uploading || submitting`.
  - `submit` 의 `images.pendingBlock` 자리를 `if (uploading) { toast.error('이미지 업로드가 끝난 뒤 등록해 주세요'); return; }` 로. `uploading` 은 ref 로도 들고 있어 같은 틱 제출에도 최신 값을 읽게 한다.
- [ ] **Step 4: 데스크톱 구현** — `IssueCreateDialog.tsx`:
  - 라벨은 `<span id="issue-body-label" className="text-sm font-medium">본문</span>`, 옆 `IssueBodyImageButton onFiles={(files) => f.bodyEditor.ref.current?.insertImages(files)}`.
  - `<RichInput ref bodyMode imageUpload members initialBody="" ariaLabel="본문" placeholder="" inputTestId="issue-body" submitTestId="issue-body-submit" editorAria={{ invalid: !!errors.body, describedBy: errors.body ? 'issue-body-error' : undefined }} editorMaxHeightClass="max-h-[40vh]" onBodyChange onUploadingChange onSubmit={() => formRef.current?.requestSubmit()} onCancel={requestClose} />` — `formRef` 는 `<form>` 에 단다.
  - `DialogContent onEscapeKeyDown={(e) => { if (isRichBodyTarget(e.target)) e.preventDefault(); }}` — 편집칸 안 Esc 는 `RichInput` 이 처리(팝업 먼저, 아니면 `onCancel`).
  - `Textarea` import 가 더 쓰이지 않으면 지운다.
- [ ] **Step 5: 모바일 구현** — `MobileIssueCreateSheet.tsx`:
  - 본문 `textarea`·`useAutoGrowTextarea(bodyRef…)` 제거. 같은 자리에 `<RichInput … bodyMode={{ ...f.bodyEditor.bodyMode, frame: 'bare' }} …>` — 단 `bodyMode` 객체는 메모해 넘긴다(마운트 시점 고정이지만 렌더마다 새 객체 금지). `ariaLabel="설명"`, `placeholder="설명 (선택)"`, `inputTestId="issue-create-body"`, `submitTestId="issue-create-body-submit"`, `editorMaxHeightClass=""`, `editorAria` 의 describedBy `issue-create-body-error`, `onSubmit={() => formRef.current?.requestSubmit()}`, `onCancel={requestClose}`.
  - 제목 Enter: `titleEnter.handleEnter(e, () => setBodyFocus((n) => n + 1))`, `focusRequest={bodyFocus}`, `onFocusRequestDone` 는 `useCallback(() => setBodyFocus(0), [])`.
  - `onEscapeKeyDown={(e) => { e.preventDefault(); if (!isRichBodyTarget(e.target)) requestClose(); }}`.
- [ ] **Step 6: 기존 테스트 고침** — `document.getElementById('issue-body')` / `getByTestId('issue-create-body')` 에 `fireEvent.change` 하던 곳을 편집기에 원문을 넣는 방식으로(`editorOf(...).commands.insertContentAt(1, '가'.repeat(50001))` 등). 오류 id·`aria-invalid` 단언은 편집칸에 그대로.
- [ ] **Step 7:** `pnpm vitest run src/pages/projects src/pages/mobile/issueCreate.test.tsx src/lib/richBodyTarget.test.ts src/components/mentions src/components/issue` → PASS. `pnpm typecheck`·`pnpm lint` 통과. `grep -rn "useIssueImageUpload" src e2e` → 결과 없음(주석 포함).
- [ ] **Step 8: 커밋** — `feat(web): 이슈 생성 창 본문 칸을 본문 모드 편집칸으로 바꿔 이미지를 칸 안에서 본다 (WP-1657)`.

### Task 3: E2E 고침·추가와 매뉴얼

**Files:**
- Modify: `e2e/pages/projects/issue-body-images.spec.ts`(생성 다이얼로그 테스트, ~120-150행 — `#issue-body` textarea 값 단언)
- Modify: `e2e/pages/mobile/issue-create.spec.ts`(66-107행 — 설명 자라기 @layout·제목 Enter @input)
- Modify: `docs/manual/user/08-work.md`(이슈 만들기 절)

**Interfaces:**
- Consumes: Task 2 의 testid(`issue-body`, `issue-create-body`)와 동작.

- [ ] **Step 1: E2E 고침** — `issue-body-images.spec.ts` 의 생성 다이얼로그 테스트를 편집칸 기준으로: 이미지 붙여넣기(`pasteImage(page, '[data-testid="issue-body"]')`) → 칸 안에 업로드 자리표시가 보였다가 `img` 로 바뀜 → 생성 → 가로챈 POST 본문에 `![bug.png](` + 업로드 응답 url + `)` 포함. 업로드 중 「생성」 disabled 단언 유지. 태그는 지금 것을 따른다(`@input`).
- [ ] **Step 2: E2E 고침** — `mobile/issue-create.spec.ts`: 「설명은 내용에 따라 자라고 최소 3줄」 @layout 은 편집칸에 Enter 로 여러 줄을 쳐서 높이가 늘고, 빈 칸 높이 ≥ 72px. 제목 Enter → `issue-create-body` `toBeFocused()`(편집칸 contenteditable).
- [ ] **Step 3: E2E 추가** — `mobile/issue-create.spec.ts` 에 `test('390px 에서 본문에 넓은 이미지를 붙여도 시트가 가로로 넘치지 않는다', { tag: '@layout' })` — 붙여넣은 이미지가 보인 뒤 `document.documentElement.scrollWidth <= 390`, 이미지 `boundingBox().width <= 390 - 32`. 데스크톱 `issue-body-images.spec.ts` 에 `test('여러 줄 글자 붙여넣기는 빈 줄까지 그대로 보낸다', { tag: '@input' })` — `text/plain` `'a\n\nb'` 붙여넣기 → POST 본문 `'a\n\nb'`.
- [ ] **Step 4:** 바꾼 spec 만 실행 — `.work-loop/project.md` 의 E2E 실행 방법(격리 스택 `LIVE_STACK_NAME=work-loop`, 포트 규칙)대로 `pnpm exec playwright test e2e/pages/projects/issue-body-images.spec.ts e2e/pages/mobile/issue-create.spec.ts` → PASS.
- [ ] **Step 5: 매뉴얼** — `manual-authoring` 스킬 규칙으로 `docs/manual/user/08-work.md` 의 이슈 만들기 설명에 「본문에 붙여넣은 이미지는 칸 안에 그림으로 보이고, 올리는 중에는 만들기가 잠깁니다」 취지 한 줄(편집 절의 같은 설명과 같은 말투). 저장소 루트에서 `pnpm manual:prose` 통과.
- [ ] **Step 6: 커밋** — `test(web): 이슈 생성 창 본문 칸 안 이미지 E2E 와 매뉴얼을 맞춘다 (WP-1657)`.
