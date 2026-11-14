# WP-1544 개인 작업 행의 버튼 중첩 없애기 — 구현 계획

이슈: WP-1544 (a11y, WCAG 4.1.2 / 2.5.8). 선행 같은 계열: WP-1435(링크 안 버튼 중첩).

## 목표

`apps/workplace-web/src/pages/projects/personal/PersonalChecklistRow.tsx` 의 행이 `div role="button" tabIndex=0 aria-pressed` 이고 그 안에 「완료 토글」 `<button>` 이 있어 버튼 안 버튼(중첩 인터랙티브)이다. 이를 없앤다.

## 설계 (내가 정한 것)

이슈 목록 데스크톱 행(`components/issue/IssueListTable.tsx` 의 `IssueTableRow` — 「행 전체 클릭은 마우스 편의, 키보드 접근점은 제목 링크」)과 같은 방식으로 맞춘다.

1. **행 바깥 div**: `role`·`tabIndex`·`aria-pressed`·`onKeyDown` 을 뗀다. `onClick={togglePanel}` 과 `cursor-pointer`·hover·선택 배경(`SELECTED_BG_CLASS`)·`data-testid`·`data-status`·`data-priority` 는 그대로 둔다(마우스·터치 편의 — 행 어디를 눌러도 열린다).
2. **제목을 버튼으로**: 지금의 제목 `span`(`data-testid="personal-task-title-<n>"`)을 `<button type="button">` 으로 바꾼다.
   - `aria-pressed={isOpen}`(행에 있던 「상세 열림」 눌림 상태를 옮긴다 — 같은 화면의 다른 토글과 같은 어휘), `data-testid="personal-task-open-<n>"`.
   - 접근 이름은 제목 글자만(짧은 이름). 말줄임(`truncate`)·최소 폭·완료 시 취소선 클래스는 그대로. `text-left`, 포커스 링(`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded`).
   - `onClick` 은 `e.stopPropagation()` 뒤 `togglePanel()` — 행 onClick 까지 버블해 두 번 토글되지 않게.
   - 제목 `span` 의 기존 `data-testid="personal-task-title-<n>"` 은 버튼 안쪽 span 으로 남겨 기존 테스트가 깨지지 않게 한다(또는 버튼에 그대로 두고 open testid 를 따로 — 구현자가 테스트 영향이 적은 쪽으로).
3. **완료 토글**: 형제 컨트롤 그대로(이제 중첩 아님). 히트 영역을 24×24 이상으로 — `inline-flex size-6 items-center justify-center rounded` (+ 포커스 링). 아이콘 크기는 그대로. 행 높이가 커지지 않게 필요하면 음수 여백(`-m-[3px]`)으로 상쇄 — 레이아웃 변화 최소.
4. 키보드: Tab 순서는 제목 버튼 → (완료 토글은 앞) — 실제 DOM 순서는 완료 토글 → 제목 버튼. Enter/Space 는 버튼 기본 동작.
5. 주석은 한국어로 무엇을·왜(WP-1544) 남긴다.

## 테스트

- vitest `src/pages/projects/personalProjectDetail.test.tsx`:
  - 행 `aria-pressed` 단언(현재 약 328행 「행 클릭 → 넓은 모달」)을 제목 버튼(`personal-task-open-1`)으로 옮긴다. 행 클릭으로 여는 흐름은 유지(마우스 편의 회귀).
  - **새 테스트**(WP-1544): 행 요소에 `role` 이 없고(버튼 아님), 행 안의 버튼 이름이 「완료 토글」과 제목(예: 「블로그 초안」) 둘이며 서로 중첩되지 않는다(어느 버튼도 다른 버튼을 자손으로 갖지 않음). 제목 버튼을 누르면 모달이 열리고 `?task=1`, `aria-pressed=true`; 완료 토글 클릭은 모달을 열지 않는다(기존 테스트가 있으면 재사용).
  - 키보드: 제목 버튼에 포커스 후 Enter 로 열리는지(user.keyboard) — vitest 로 충분.
- E2E `e2e/pages/projects/personal-project-detail.spec.ts` 약 200행의 행 `aria-pressed` 단언을 제목 버튼으로 옮긴다(동작은 그대로). 그 밖에 행 `role=button`·`aria-pressed`·행에 포커스 후 키 입력에 기대는 E2E·vitest 를 `grep` 으로 찾아 함께 고친다.
- 히트 영역 24×24 는 jsdom 이 못 잰다 — 클래스(`size-6`) 존재만 vitest 로 보지 말고, 라이브 검증에서 브라우저로 잰다(새 E2E 는 만들지 않는다).
- 돌릴 것(`apps/workplace-web`): `pnpm test`(또는 해당 파일 `npx vitest run src/pages/projects/personalProjectDetail.test.tsx src/components/ai/screen-context/aiScreenContext.test.tsx`), `pnpm test:e2e e2e/pages/projects/personal-project-detail.spec.ts e2e/pages/mobile/personal-project.spec.ts e2e/pages/mobile/back-personal-task.spec.ts`, `pnpm typecheck`, `pnpm lint`.

## Review Focus (완료 기준이 말하지 않은 입력·실패 경우)

- 행 클릭(제목 밖 빈 곳·레이블·마감)으로 여전히 열리고, 같은 행 재클릭으로 닫힌다(history push/close — WP-208). 제목 버튼 클릭이 버블로 두 번 토글되면 열렸다 바로 닫힌다 — stopPropagation 확인.
- 완료 토글 클릭이 행을 열지 않는다(기존 stopPropagation 유지). `disabled`(진행 중)일 때 클릭이 행으로 새어 패널이 열리지 않는가 — disabled 버튼 클릭은 이벤트가 부모로 가지 않을 수 있으나 브라우저마다 다르다. 기존 동작과 같으면 둔다.
- 모바일(tap) 경로 E2E(`e2e/pages/mobile/*`)가 행 testid 를 tap 한다 — 행 onClick 유지로 그대로 통과해야 한다.
- AI 화면 컨텍스트 테스트(`aiScreenContext.test.tsx` 390행)가 행을 클릭한다 — 그대로 통과.
- 레이아웃: 제목 버튼이 `button` 기본 스타일(가운데 정렬·글꼴)로 바뀌어 말줄임·왼쪽 정렬이 깨지지 않는가, 행 높이 변화 없는가 — 라이브 검증에서 스크린샷으로 비교.
- 매뉴얼: 화면 문구·절차 변화 없음(행을 눌러 여는 절차 그대로) — 매뉴얼 수정 불필요 판단을 PR 에 적는다.
