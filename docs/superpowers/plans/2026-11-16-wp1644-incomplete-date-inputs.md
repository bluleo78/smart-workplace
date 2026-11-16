# WP-1644 — 날짜 칸을 덜 넣은 채 저장하면 날짜 없이 저장된다 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 덜 넣은 날짜(`<input type="date">` 의 `validity.badInput`)를 「비움」으로 여겨 날짜를 버리거나 지우던 화면에서, 저장하지 않고 칸 아래에 안내를 보인다.

**Architecture:** 공용 판정 `isIncompleteDateInput(el)` 과 문구 상수를 `src/lib/dateInput.ts` 에 두고, 실제로 데이터를 잘못 저장하는 세 화면(이슈 만들기·버전 만들기/고치기·마일스톤 마감일 즉시 고치기)에 WP-1625(ShareLinkModal)와 같은 모양으로 붙인다 — 제출(또는 blur 저장) 때 입력 요소를 직접 읽어 막고, 칸을 비우거나 고치면(keyUp·blur·change) 안내를 거둔다. ShareLinkModal 의 판정도 이 도우미로 바꾼다(문구는 만료일 전용 그대로).

**Tech Stack:** React 19 + TS, react-hook-form(이슈 만들기), 제어 상태(버전), vitest + RTL.

**Spec:** 이슈 WP-1644 본문 + 아래 「조사 결과·범위」.

## 조사 결과·범위(내가 정함 — 무인 세션)

12곳을 읽어 보니 실제로 잘못 저장하는 곳은 셋이다. 나머지는 이미 막히거나(단추 비활성·zod 필수) 네이티브 칸이 아니다.

| 화면 | 지금 | 이번에 |
|---|---|---|
| `pages/projects/components/IssueCreateDialog.tsx` 시작일·마감일(`issue-start`·`issue-due`, `noValidate` 폼) | 덜 넣으면 **날짜 없이 이슈 생성** | 고침 |
| `pages/projects/versions/VersionFormDialog.tsx` 시작일·출시일 | 만들기: 날짜 버림 / 고치기: `versionPatch` 가 `clear*` 를 보내 **저장된 날짜를 지움** | 고침 |
| `pages/projects/timeline/MilestoneEditPopover.tsx` 마감일(blur 즉시 저장) | 「마감일은 비울 수 없습니다」 토스트 후 **치던 값을 지움**(저장 값은 그대로) | 고침 — 지우지 않고 칸 아래 안내 |
| EventDialog·EventRangeInputs, CycleFormDialog, MilestoneFormDialog, VersionReleaseDialog, PeriodRangeForm, AuditLogListPage | 저장 막힘(zod 필수·단추 비활성) 또는 필터 없음으로 처리 — 잘못 저장하지 않음, 안내 문구만 부정확 | 이번 범위 밖(남은 위험으로 보고) |
| FieldDateInput·DatePickerPopover | 네이티브 date 칸이 아님(달력 팝오버) | 해당 없음 |

- 문구: `날짜를 끝까지 입력하거나 칸을 비워 주세요.`(공용). 마감일 즉시 고치기는 비울 수 없는 칸이라 `날짜를 끝까지 입력해 주세요.`(같은 파일에 둔다).
- 포커스는 옮기지 않는다(WP-1625 와 같게). 새 E2E 는 두지 않는다 — 덜 넣은 날짜의 브라우저 동작은 `e2e/pages/drive/drive-share-link.spec.ts` 의 `@input` 테스트가 이미 실제 Chromium 으로 지킨다. 화면별 판정은 vitest(입력 요소 `validity` 를 `badInput: true` 로 덮음)로 본다.

## Global Constraints

- 한국어 주석(무엇을·왜). 디자인 시스템 시맨틱 토큰만 — 기존 오류 요소(`text-destructive`, `role="alert"`, `FormField` 의 `error`)를 재사용.
- vitest: 판정·문구·요청 없음. 새 단언은 로직을 일부러 깨 실패하는지 확인(RED 근거를 보고에).
- 화면 문구가 바뀌면 해당 매뉴얼 장이 그 칸을 설명할 때만 한 문장 — `pnpm manual:check`·`pnpm manual:prose` 통과.
- 셸 명령은 단순하게: 한 줄 셸 함수 정의, `${…:-{…}}` 중괄호 확장, `;`·`&&` 로 길게 이은 한 줄을 쓰지 않는다.

## Review Focus

1. 빈 칸에서 일부만 친 경우(값 `''`, change 없음) — 제출 때 입력 요소를 읽으므로 막혀야 한다(각 화면 테스트: `validity` 만 덮고 change 없이 제출).
2. 버전 고치기에서 저장된 날짜를 덜 지운 경우 — `clearStartDate`/`clearReleaseDate` 를 보내면 안 된다(PATCH 미호출).
3. 칸을 완전히 비운 경우(badInput 아님) — 지금처럼 날짜 없이 저장/지움(기존 동작 유지).
4. 「생성 후 실행」(`create-and-run`) 단추도 같은 검사를 지난다(이슈 만들기).
5. 마일스톤 마감일: 덜 넣고 blur → 토스트·값 되돌리기·PATCH 없이 칸 아래 안내, 끝까지 넣으면 저장.

---

### Task 1: 공용 판정 + 이슈 만들기 + ShareLinkModal 판정 교체

**Files:**
- Create: `apps/workplace-web/src/lib/dateInput.ts`, `apps/workplace-web/src/lib/dateInput.test.ts`
- Modify: `apps/workplace-web/src/pages/projects/components/IssueCreateDialog.tsx`(그리고 폼 로직이 있으면 `useIssueCreateForm`)
- Modify: `apps/workplace-web/src/components/drive/ShareLinkModal.tsx`(`expiresInputRef.current?.validity.badInput` → `isIncompleteDateInput(expiresInputRef.current)`, 동작 그대로)
- Test: `apps/workplace-web/src/pages/projects/issueCreateDialogDates.test.tsx`(있는 파일에 describe 추가)

**Interfaces:**
- Produces: `export function isIncompleteDateInput(el: HTMLInputElement | null | undefined): boolean`(el 이 없으면 false, `el.validity.badInput` 그대로) · `export const INCOMPLETE_DATE_MESSAGE = '날짜를 끝까지 입력하거나 칸을 비워 주세요.'`

- [ ] **Step 1: 실패하는 테스트** — `dateInput.test.ts`(null·badInput true/false). 이슈 만들기 describe 「덜 넣은 날짜 (WP-1644)」: 시작일 덜 넣음 → `#issue-start-error` 문구·생성 요청 없음 / 마감일 덜 넣음 → `#issue-due-error` / 「생성 후 실행」도 막힘 / 덜 넣은 칸을 비우고(keyUp, change 없음) 다시 제출하면 날짜 없이 생성 / 완전히 비우면 날짜 없이 생성(기존).
- [ ] **Step 2: 실패 확인** — `cd apps/workplace-web && npx vitest run src/lib/dateInput.test.ts src/pages/projects/issueCreateDialogDates.test.tsx`.
- [ ] **Step 3: 구현** — 두 날짜 칸의 요소를 잡고(react-hook-form `register` 의 ref 와 함께 쓰는 방법은 구현자 판단), 제출 처리 맨 앞에서 덜 넣은 칸마다 `setError(<필드>, { type: 'incomplete', message: INCOMPLETE_DATE_MESSAGE })` 후 중단. keyUp·blur 에서 그 칸이 더는 덜 넣음이 아니고 오류 type 이 `incomplete` 면 `clearErrors`. 기존 zod 오류(시작일 > 마감일 등)는 건드리지 않는다.
- [ ] **Step 4: 통과 + 일부러 깨기 확인** — Step 2 명령, 그리고 `npx vitest run src/components/drive/ShareLinkModal.test.tsx`(교체 회귀).

### Task 2: 버전 만들기·고치기

**Files:**
- Modify: `apps/workplace-web/src/pages/projects/versions/VersionFormDialog.tsx`
- Test: `apps/workplace-web/src/pages/projects/versions/versionManage.test.tsx`(또는 화면 판정이 가벼운 새 `*.test.tsx` — `renderScreen` 우선, apps/workplace-web/CLAUDE.md 「단위·페이지 테스트」)

**Interfaces:**
- Consumes: Task 1 의 `isIncompleteDateInput`, `INCOMPLETE_DATE_MESSAGE`.

- [ ] **Step 1: 실패하는 테스트** — 만들기: 출시일 덜 넣음 → 칸 아래 안내(`FormField` 의 `error` → `#<htmlFor>-error`)·POST 없음. 고치기: 저장된 시작일을 덜 지움 → 안내·PATCH 없음(`clearStartDate` 안 보냄). 칸을 완전히 비우면 지금처럼 `clear*` PATCH. 비우고(keyUp) 다시 제출하면 통과.
- [ ] **Step 2: 실패 확인**.
- [ ] **Step 3: 구현** — 두 칸에 ref, 제출 맨 앞 검사, 칸별 오류 상태, keyUp·blur·change 에서 거둠. 기존 `version-date-error`(범위 오류)는 그대로.
- [ ] **Step 4: 통과 + 일부러 깨기 확인**.

### Task 3: 마일스톤 마감일 즉시 고치기

**Files:**
- Modify: `apps/workplace-web/src/pages/projects/timeline/MilestoneEditPopover.tsx`
- Test: `apps/workplace-web/src/pages/projects/timelineMilestones.test.tsx` 또는 `timeline/timelineMilestoneManage.test.tsx`(가까운 쪽)

**Interfaces:**
- Consumes: Task 1 의 `isIncompleteDateInput`.

- [ ] **Step 1: 실패하는 테스트** — 덜 넣고 blur → 토스트 「마감일은 비울 수 없습니다」 없음·입력 값 되돌리지 않음·PATCH 없음·칸 아래 `날짜를 끝까지 입력해 주세요.`(`role="alert"`, `aria-invalid`, `aria-describedby`). 완전히 비우고 blur → 지금처럼 토스트·되돌리기. 끝까지 넣고 blur → 저장, 안내 사라짐.
- [ ] **Step 2: 실패 확인**.
- [ ] **Step 3: 구현** — blur 처리 맨 앞에서 덜 넣음이면 안내만 세우고 끝. change/keyUp 에서 덜 넣음이 풀리면 거둠.
- [ ] **Step 4: 통과 + 일부러 깨기 확인**, 그리고 `cd apps/workplace-web && pnpm typecheck`, `pnpm lint`, 저장소 루트 `pnpm manual:check`, `pnpm manual:prose` 를 각각 따로 실행.
