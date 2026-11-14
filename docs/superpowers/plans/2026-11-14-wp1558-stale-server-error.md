# WP-1558 입력을 고쳐도 남는 옛 서버 오류 — 구현 계획

이슈: WP-1558. 대상: 설정 > 역할 「역할 추가」(`pages/admin/RoleListPage.tsx`), 설정 > 구성원 「구성원 추가」(`components/users/AddMemberDialog.tsx`), 버전 만들기(`pages/projects/versions/VersionFormDialog.tsx`) — QA 가 화면에서 재현. 같은 구조로 의심되는 `pages/projects/components/ComponentEditDialog.tsx`·`CustomFieldEditDialog.tsx`·`ProjectMetaEditDialog.tsx` 는 코드로 확인해 같은 구조면 함께 고친다. `IssueRelationTypeDialog.tsx` 는 이미 입력 시 정리되고(재현 안 됨), `TokenIssueFormDialog.tsx` 는 서버 거절 경로가 없어 해당 없음.

## 현상·원인

서버 오류 상태(`createError`·`serverError`·`error`)를 제출 처리 함수 안에서만 비운다. react-hook-form 의 `handleSubmit` 은 클라이언트 검증이 실패하면 제출 함수를 부르지 않아, 서버 오류 뒤 입력을 고쳐 클라이언트 검증 오류가 나면 옛 서버 오류(「이미 존재하는 역할 이름입니다: ADMIN」)가 지금 입력과 모순된 채 남는다. 직접 state 를 쓰는 폼(버전)도 이름 onChange 가 오류를 지우지 않는다.

## 설계 (내가 정한 것)

- **입력이 바뀌면 서버 오류를 지운다** — 서버 오류는 「그때 보낸 값」에 대한 답이라, 값이 바뀌면 더는 맞지 않는다. 이슈 수정 방향의 두 안 중 이것을 고른다(제출 시작 때만 지우면 고치는 동안 옛 문구가 계속 보인다). `IssueRelationTypeDialog` 와 같은 동작.
- react-hook-form 폼(역할·구성원 등): 공용 훅 `src/hooks/useClearOnFormChange.ts` — `useClearOnFormChange(form, clear)` 가 `form.watch` 구독(`const sub = form.watch(() => clear()); return () => sub.unsubscribe()`)으로 어떤 칸이든 사용자가 바꾸면 `clear()` 를 부른다. 주의: `form.reset()`(창 열 때)도 watch 콜백을 부르지만 그때도 오류를 지우는 것이 맞아 문제 없다. 제출 중 서버 오류를 넣은 직후 값이 바뀌지 않으면 지워지지 않는다.
  - 훅 위치·이름은 기존 `src/hooks` 관례에 맞춘다. 이미 비슷한 헬퍼가 있으면(`grep -rn "watch(" src/hooks src/lib`) 그것을 쓴다.
- state 폼(버전 등): 각 입력의 onChange 에서 서버 오류 setter 를 부른다 — 칸이 여럿이면 작은 래퍼(`const edit = (fn) => (v) => { setError(null); fn(v) }`)로 중복을 줄인다. 날짜 칸 등 모든 입력 칸.
- 의심 3개는 열어 보고 같은 구조(제출에서만 지움 + 입력 변경 시 남음)면 같은 방식으로 고치고, 아니면 손대지 않고 보고에 이유를 적는다.
- 보이는 문구·레이아웃은 그대로. 매뉴얼 수정 불필요.

## 테스트

- 화면 테스트 — 대상마다 기존 테스트 파일에 단언을 더한다(새 화면 테스트 파일은 그 컴포넌트에 테스트 파일이 전혀 없을 때만, `renderScreen` 으로):
  - 역할: MSW 로 생성 409(이미 존재…) → 오류 보임 → 이름을 51자로 바꾸고 생성 → 칸 오류만 보이고 서버 오류 문구는 없다. 그리고 이름을 고치기만 해도(제출 전) 서버 오류가 사라진다.
  - 구성원 추가: 같은 흐름(아이디 중복 → 아이디 바꾸고 이름 비워 추가 → 「이미 사용 중인 아이디입니다.」 없음).
  - 버전: 중복 이름 오류 → 이름 바꾸면 오류 사라짐.
  - 고친 의심 대상마다 최소 1건.
  - 테스트 파일은 `grep -rln "RoleListPage\|settings/roles\|AddMemberDialog\|VersionFormDialog\|versions" src --include=*.test.tsx` 로 찾는다.
  - 새 단언마다 고친 줄을 잠깐 되돌려 실패를 확인한다.
- 순수 테스트는 훅에 따로 두지 않는다(화면 테스트가 실제 동작을 본다).
- 돌릴 것(`apps/workplace-web`): 바꾼·더한 테스트 파일 vitest, `pnpm typecheck`, `pnpm lint`.

## Review Focus

- 서버 오류를 넣는 바로 그 제출 흐름에서 watch 가 다시 불려 방금 넣은 오류를 지우지 않는가(예: 제출 뒤 form 값 변경·reset 이 오류 setter 뒤에 오는 경로).
- 성공 뒤 `form.reset()` → 창 닫힘 흐름이 그대로인가.
- 구독 해제(언마운트·창 닫힘) — 누수 없음.
- 칸 단위 서버 오류(`form.setError`)를 쓰는 곳이 있으면 이 변경과 겹치지 않는가.
