# WP-1625 — 공유 링크 만료일을 덜 넣고 「링크 생성」하면 만료 없는 링크가 만들어진다 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 만료일 칸이 덜 채워진 채(`validity.badInput`) 「링크 생성」을 누르면 링크를 만들지 않고 칸 아래에 안내를 보인다.

**Architecture:** `<input type="date">` 는 덜 넣은 날짜를 `''` 로 올리고, 빈 칸에서 일부만 치면 값이 계속 `''` 라 `onChange` 도 오지 않는다. 그래서 상태(`expiresAt`)만으로는 「비움」과 「덜 넣음」을 가를 수 없다. `onCreate()` 가 만료일 입력 요소의 `validity.badInput` 을 직접 읽어(ref) 덜 넣었으면 기존 만료일 오류 자리(`share-expires-error`, WP-901)에 안내를 세우고 요청을 보내지 않는다.

**Tech Stack:** React 19 + TS, shadcn `Input`(ref 를 props 로 넘긴다), vitest + RTL(`ShareLinkModal.test.tsx`).

**Spec:** 이슈 WP-1625 본문(「기대」 절).

## 설계(승인됨 — 무인 세션이라 스스로 승인)

- **A(채택)** — `onCreate` 에서 ref 로 `validity.badInput` 을 읽는다. 빈 칸 → 일부 입력(이벤트 없음)·채운 칸 → 일부 지움(값 `''`) 두 경우를 모두 잡는다. 폴더 공유의 미리 채운 기본 만료를 고치다 덜 지운 경우도 같다.
- B(버림) — `onChange` 에서 `e.target.validity.badInput` 을 상태로 기록: 빈 칸에서 일부만 치면 `input` 이벤트가 오지 않아(값이 `''` 그대로) 이슈 재현 경로를 놓친다.
- C(버림) — 날짜 선택기를 직접 만든 것으로 바꾸기: 범위가 크고 이슈가 요구하지 않는다.
- 문구: `만료일을 끝까지 입력하거나 칸을 비워 주세요.`(이슈 「기대」의 문구, 기존 문구들처럼 마침표). 범위 밖·지난 날짜 검사보다 먼저 본다(덜 넣었으면 값이 `''` 라 그 검사들은 어차피 건너뛴다).
- 포커스는 옮기지 않는다 — 같은 창의 다른 오류(비밀번호·지난 만료일)와 같게 칸 아래 안내 + `aria-invalid`·`aria-describedby` 만.
- 칸을 고치면(`onChange`) 지금처럼 오류를 지운다. 덜 넣은 칸에서 값이 바뀌지 않으면 오류가 남는데, 다시 누를 때 다시 검사하므로 문제없다.
- 매뉴얼 `docs/manual/user/09-drive.md` 공유 링크 절(109줄 부근)에 한 문장: 만료일을 끝까지 넣지 않으면 링크를 만들지 않고 안내가 보인다.

## Global Constraints

- 한국어 주석(무엇을·왜). 디자인 시스템 시맨틱 토큰만(새 색 없음 — 기존 `text-destructive` 안내 재사용).
- 테스트는 vitest(`ShareLinkModal.test.tsx`) — 판정 로직·문구·요청 없음은 jsdom 으로 본다. jsdom 은 덜 넣은 날짜를 칠 수 없으니 입력 요소의 `validity` 를 `Object.defineProperty` 로 `badInput: true` 인 값으로 덮는다. 실제 Chromium 동작은 라이브 검증(브라우저)에서 본다.
- 새 단언은 로직을 일부러 깨 실패하는지 확인한다(RED 근거를 보고에 남긴다).
- `pnpm manual:check`·`pnpm manual:prose` 통과.
- 셸 명령은 단순하게: 한 줄 셸 함수 정의, `${…:-{…}}` 중괄호 확장, `;`·`&&` 로 길게 이은 한 줄을 쓰지 않는다.

## Review Focus

1. 빈 칸에서 일부만 친 경우(값 `''`, `onChange` 없음) — ref 로 읽으므로 잡혀야 한다(테스트: `validity` 만 덮고 change 이벤트 없이 생성 클릭).
2. 미리 채운 만료일(폴더·외부 링크 기본 30일)을 고치다 덜 지운 경우(값 `''` + badInput) — 링크를 만들지 않아야 한다(테스트: 기본값이 있는 대상에서 change `''` + badInput).
3. 칸을 완전히 비운 경우(값 `''`, badInput 아님) — 지금처럼 만료 없이 만든다(테스트: 기존 동작 유지 확인).
4. 비밀번호 오류와 함께 — 두 안내가 함께 서고 요청은 없다(기존 「모든 칸을 함께 검사」 규칙).
5. 비밀번호 칸 Enter(WP-1624)로 생성할 때도 같은 검사 — `onCreate` 하나를 쓰므로 함께 막힌다(테스트: 비밀번호 칸 Enter + badInput).

---

### Task 1: 덜 넣은 만료일 막기

**Files:**
- Modify: `apps/workplace-web/src/components/drive/ShareLinkModal.tsx`(`onCreate` 194~222줄, 만료일 `Input` 411~424줄)
- Modify: `apps/workplace-web/src/components/drive/ShareLinkModal.test.tsx`
- Modify: `docs/manual/user/09-drive.md`(공유 링크 절 한 문장)

**Interfaces:**
- Produces: 문구 상수 `SHARE_EXPIRES_INCOMPLETE_MESSAGE = '만료일을 끝까지 입력하거나 칸을 비워 주세요.'`(ShareLinkModal.tsx 안, 내보내지 않아도 됨 — 테스트는 문구로 찾는다).

- [ ] **Step 1: 실패하는 테스트** — `ShareLinkModal.test.tsx` 에 describe 「덜 넣은 만료일 (WP-1625)」: Review Focus 1·2·3·5 를 각각 한 테스트로. 덮는 도우미 예: `markIncomplete(input)` = `Object.defineProperty(input, 'validity', { configurable: true, value: { ...input.validity, badInput: true, valid: false } })`. 단언: `share-expires-error` 가 위 문구, 만료일 칸 `aria-invalid="true"`, `api.createShareLink` 미호출. 3번은 `createShareLink` 가 `expiresAt: undefined` 로 불림.
- [ ] **Step 2: 실패 확인** — `cd apps/workplace-web && npx vitest run src/components/drive/ShareLinkModal.test.tsx`. Expected: 새 테스트(1·2·5) FAIL, 3 PASS.
- [ ] **Step 3: 구현** — 만료일 `Input` 에 `ref={expiresInputRef}`, `onCreate` 의 만료일 검사 맨 앞에 `expiresInputRef.current?.validity.badInput` 이면 위 문구로 `nextExpiresAtError` 를 세운다(그 밖 분기는 그대로). 왜 ref 로 읽는지 한국어 주석(값이 `''` 로 올라와 상태로 가를 수 없음, WP-1625).
- [ ] **Step 4: 통과 확인** — Step 2 명령. Expected: 전부 PASS. 그다음 Step 3 의 검사 줄을 잠시 지워 새 테스트가 실패하는지 확인하고 되돌린다.
- [ ] **Step 5: 매뉴얼·정적 검사** — `09-drive.md` 한 문장. `pnpm manual:check`, `pnpm manual:prose`(저장소 루트), `cd apps/workplace-web && pnpm typecheck && pnpm lint` 는 각각 따로 실행. Expected: 오류 0.
