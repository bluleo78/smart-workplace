# 데스크톱 이슈 초안 폐기 확인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 데스크톱 이슈 작성 창에서 입력한 내용을 닫기 전에 확인한다.

**Architecture:** `DesktopIssueCreateDialog` 에서 모바일과 같은 `f.hasContent` 판정을 사용해 닫기 요청을 한곳으로 모은다. 저장 성공은 초안 폐기 확인을 거치지 않고 기존 부모 콜백으로 닫으며, 확인 상태도 함께 초기화한다.

**Tech Stack:** React 19, TypeScript, Radix Dialog/AlertDialog, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-issue-create-discard-confirmation-design.md`

## Global Constraints

- 모바일 확인 문구와 단추 이름은 「작성 중인 내용을 버릴까요?」, 「계속 작성」, 「버리기」로 맞춘다.
- 제목·본문이 모두 비어 있거나 공백뿐이면 확인 없이 닫는다.
- 성공적으로 이슈를 만들면 확인 없이 닫는다.
- 화면 문구·주석은 한국어를 사용하고, 사용자 매뉴얼의 이슈 작성 절차를 갱신한다.

## Review Focus

- 제목과 본문이 모두 빈 문자열·공백일 때 Esc와 취소는 확인 없이 닫혀야 한다 — 폼 테스트에서 직접 닫힘을 확인한다.
- 제목만 있거나 본문만 있어도 초안으로 보아야 한다 — 폼 테스트에서 두 입력 위치를 각각 채워 확인을 확인한다.
- Esc, 바깥 클릭, 닫기(X), 취소가 모두 같은 확인창을 열어야 한다 — 브라우저 E2E에서 네 경로를 실제로 조작한다.
- 「계속 작성」 뒤에는 두 입력이 남고, 「버리기」 뒤 다시 열면 비어 있어야 한다 — 폼 테스트와 E2E에서 확인한다.
- 생성 성공은 확인창을 띄우지 않고 닫혀야 한다 — 기존 생성 성공 테스트의 콜백 단언과 제출 중 폐기 확인이 열린 경계 사례를 유지한다.

---

### Task 1: 데스크톱 이슈 초안 닫기 확인

**Files:**
- Modify: `apps/workplace-web/src/pages/projects/components/IssueCreateDialog.tsx`
- Modify: `apps/workplace-web/src/pages/projects/issueCreateValidation.test.tsx`
- Modify: `apps/workplace-web/e2e/pages/dialog-state-reset.spec.ts`
- Modify: `docs/manual/user/08-work.md`

**Interfaces:**
- Consumes: `useIssueCreateForm` 의 `f.hasContent`, 기존 부모 `onOpenChange` 콜백.
- Produces: 데스크톱 닫기 요청에서 재사용할 `requestClose()` 와 기존 모바일과 같은 폐기 `AlertDialog`.

- [x] **Step 1: 폼 테스트를 먼저 고친다**

  `issueCreateValidation.test.tsx` 에서 제목 입력 후 Esc, 본문만 입력 후 취소가 즉시 닫히지 않고 확인을 표시하는지 확인한다. 「계속 작성」은 제목과 본문을 보존하고 「버리기」 뒤 재개방하면 입력을 비운다. 빈 폼과 유효성 오류는 기존처럼 확인 없이 닫히고, 제출 성공도 확인 없이 닫히도록 검증한다.

- [x] **Step 2: 폼 테스트를 실행해 현재 동작의 실패를 확인한다**

  Run: `pnpm exec vitest run src/pages/projects/issueCreateValidation.test.tsx`

  Expected: 새 확인창을 찾지 못하는 기대된 실패.

- [x] **Step 3: 브라우저 E2E 회귀를 작성하고 현재 동작에서 실패하는지 본다**

  `dialog-state-reset.spec.ts` 에 `@input` 테스트를 추가한다. 제목·본문 입력 후 Esc, 바깥 클릭, 닫기(X), 취소 각각에서 같은 확인창이 열리고, 계속 작성 뒤 입력이 보존되며, 버리기 뒤 닫혀 재개방 시 비어 있는지 확인한다.

  Run: `pnpm test:e2e e2e/pages/dialog-state-reset.spec.ts`

  Expected: Esc에서 확인창이 없어 기대된 실패.

- [x] **Step 4: 데스크톱의 닫기 요청을 확인창으로 보낸다**

  `DesktopIssueCreateDialog` 에 로컬 확인 상태와 `requestClose()` 를 둔다. Radix가 요청한 닫기와 취소 단추는 `f.hasContent` 를 확인하고, 입력이 있으면 기존 모바일 문구의 AlertDialog를 연다. 저장 성공은 폐기 가드를 거치지 않으며, 창을 닫는 콜백에서 확인 상태도 초기화한다.

- [x] **Step 5: 테스트를 통과시키고 사용자 매뉴얼을 맞춘다**

  매뉴얼의 새 이슈 절차에 제목이나 본문을 작성한 뒤 닫을 때 폐기 여부를 확인한다는 문장을 추가한다.

  Run: `pnpm exec vitest run src/pages/projects/issueCreateValidation.test.tsx`

  Expected: PASS.

  Run: `pnpm test:e2e e2e/pages/dialog-state-reset.spec.ts`

  Expected: PASS.

- [x] **Step 6: 브랜치 전체를 리뷰하고 단순화한다**

  브랜치 전체를 검토한 뒤 의미를 바꾸지 않는 중복·복잡성이 있으면 정리한다. 정리한 경우 변경 관련 단위·E2E를 다시 실행한다.

- [x] **Step 7: 앱 범위 검증을 실행한다**

  Run: `pnpm test`

  Expected: web Vitest 전체 PASS.

  Run: `pnpm typecheck`

  Expected: TypeScript 검사 PASS.

  Run: `pnpm lint`

  Expected: ESLint PASS.

  Run: `pnpm manual:check` and `pnpm manual:prose`

  Expected: 사용자 매뉴얼 검사 PASS.

- [x] **Step 8: 실제 브라우저에서 완료 기준을 확인한다**

  격리 work-loop 스택에서 데스크톱 1280px 화면을 열어 Esc 이후 「계속 작성」과 「버리기」를 각각 확인한다. 작업 전·후 스크린샷을 `.work-loop/state/evidence/WP-1443/` 에 저장한다.

