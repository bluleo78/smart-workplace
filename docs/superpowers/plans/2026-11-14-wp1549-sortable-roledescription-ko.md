# WP-1549 드래그 정렬 항목의 영어 「sortable」 설명을 한국어로 — 구현 계획

이슈: WP-1549 (a11y, WCAG 3.1.2 / 4.1.2). 같은 계열: WP-1428·WP-721·WP-731(영어 기본 문구 → 한국어).

## 목표

dnd-kit `useSortable` 의 기본 `aria-roledescription="sortable"`(영어)가 남은 5곳을 한국어로 바꾸고, 새로 쓰는 곳에서 다시 빠지지 않게 한다.

대상(`apps/workplace-web/src/`):
- `components/wiki/WikiTreeRow.tsx`
- `components/home/dashboard/EditableWidgetCard.tsx`
- `components/home/dashboard/MobileEditableWidgetCard.tsx`
- `pages/projects/components/IssueCard.tsx`
- `pages/projects/components/status/StatusRow.tsx`

드라이브(`components/drive/DriveDnd.tsx` — `useDraggable`, 「드래그 가능한 항목」)와 이슈 목록 행(`IssueListRow.tsx` — `useDraggable`, 「드래그 가능한 이슈」)은 이미 한국어라 그대로 둔다(정렬이 아니라 끌어 옮기기라 문구가 다르다).

## 설계 (내가 정한 것)

1. **공용 훅** `src/lib/dnd/useSortableItem.ts`(새 폴더가 어색하면 `src/lib/useSortableItem.ts`):
   - `export const SORTABLE_ROLE_DESCRIPTION = '순서를 바꿀 수 있는 항목'`
   - `export function useSortableItem(args: UseSortableArguments)` — `useSortable({ ...args, attributes: { roleDescription: SORTABLE_ROLE_DESCRIPTION, ...args.attributes } })` 를 돌려준다(호출자가 roleDescription·role 을 따로 주면 그것이 이긴다).
   - 한국어 주석: 무엇을·왜(WP-1549, dnd-kit 기본값이 영어 「sortable」이고 DndContext accessibility 옵션에 roleDescription 이 없어 항목마다 줘야 한다).
2. 5곳의 `useSortable` 호출을 `useSortableItem` 으로 바꾼다. 다른 인자·동작은 그대로. `IssueCard.tsx` 는 다른 이슈(WP-1547, 보드 카드 role)가 동시에 고치는 파일이라 **import 와 호출 이름 두 줄만** 바꾼다(충돌 최소화).
3. **재발 방지**: `apps/workplace-web/eslint.config.js` 의 `no-restricted-imports` `paths` 에 `{ name: '@dnd-kit/sortable', importNames: ['useSortable'], message: '…useSortableItem 을 쓴다(WP-1549 — 스크린리더 설명 한국어)' }` 를 더한다. 공용 훅 파일만 override 로 허용한다(이 설정의 기존 override 방식 — 파일별 `no-restricted-imports` 끄기 블록이 있으면 같은 방식, 없으면 그 파일 한 곳에 eslint-disable-next-line + 사유 주석). 기존 `paths`/`patterns` 배열(약 124행)에 합쳐 넣는다 — 규칙 객체를 하나 더 만들면 앞 설정을 덮는다.

## 테스트

- 순수 테스트는 의미가 적다 — 화면 테스트로 실제 속성을 본다. 각 영역의 기존 vitest(페이지·화면 테스트)에 단언을 하나씩 더한다(새 파일은 만들지 않는다 — 고정 비용):
  - 상태 순서(`StatusManagement`/프로젝트 설정 화면 테스트): 「순서 바꾸기: …」 버튼의 `aria-roledescription` 이 「순서를 바꿀 수 있는 항목」.
  - 보드 카드(보드 화면 테스트), 노트 트리 행(위키 사이드바 테스트), 홈 위젯 편집 카드(대시보드 편집 테스트 — 데스크톱/모바일 중 기존 테스트가 있는 쪽) 같은 방식.
  - 해당 테스트 파일은 `grep -rln "aria-roledescription\|roledescription\|순서 바꾸기\|EditableWidgetCard\|WikiTreeRow\|board" src --include=*.test.tsx` 로 찾는다. 영역에 화면 테스트가 전혀 없으면 그 영역은 lint 규칙 + 공용 훅으로 갈음하고 보고에 적는다.
  - 새 단언마다 훅의 roleDescription 을 잠깐 지워 실패하는지 확인한 뒤 되돌린다.
- ESLint 규칙: `pnpm lint` 가 통과하고, 임시로 아무 파일에서 `useSortable` 을 import 하면 오류가 나는지 확인(되돌린다).
- 돌릴 것(`apps/workplace-web`): 바꾼·단언을 더한 테스트 파일 vitest, `pnpm typecheck`, `pnpm lint`. 보드·위키·홈·상태 설정 E2E 중 `sortable` 을 단언하는 것이 있으면(`grep -rn "sortable" e2e`) 함께 고치고 그 spec 만 돌린다.

## Review Focus

- `attributes` 병합 순서 — 호출자가 준 role 등(예: WikiTreeRow 가 role 을 따로 줄 수 있음)을 덮지 않는가.
- `useSortable` 반환값을 그대로 넘겨 기존 구조 분해(`attributes`, `setActivatorNodeRef` 등)가 그대로 동작하는가(타입 포함).
- 모바일 위젯 카드·보드 카드에서 roleDescription 이 실제로 DOM 요소(attributes 를 펼친 요소)에 붙는가 — 어떤 곳은 attributes 를 손잡이에만 펼친다.
- lint 규칙이 기존 `paths`/`patterns` 를 덮어쓰지 않는가(설정 배열 병합).
- 매뉴얼: 화면 글자 변화 없음(스크린리더 속성만) — 수정 불필요.
