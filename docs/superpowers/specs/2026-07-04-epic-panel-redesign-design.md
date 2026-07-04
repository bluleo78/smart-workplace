# 에픽 패널 재설계 — 탭 바 토글 통합 + 패널 UI 개선

- 날짜: 2026-07-04
- 상태: 승인됨 — 목업(A안+에픽 미할당) 사용자 확정, 최종 결과물 일괄 검토 방식으로 진행
- 이슈: [#629](https://github.com/bluleo78/smart-workplace/issues/629)
- 범위: `apps/workplace-web` 프론트엔드 전용 (백엔드·마이그레이션 변경 없음)

## 1. 배경 / 문제

- 에픽 패널의 표시 진입점이 불명확하다. 접힌 상태에서는 좌측 가장자리에 작은 `»` 화살표 버튼만 남아 발견성이 나쁘고, EPIC 이슈가 없는 프로젝트에서는 패널이 아예 렌더되지 않아 기능 존재를 알 수 없다.
- 패널 박스가 콘텐츠 높이만큼만 그려져 오른쪽 경계선(border-r)이 목록 중간에서 끊긴다 — "만들다 만" 인상.
- 에픽 아이템의 시각 완성도가 낮다(점·제목·1px 진행바·카운트가 최소 스타일로 나열).
- 뷰 탭 바(`ViewChipBar`) 오른쪽이 전부 빈 공간이라 활용도가 낮다.
- "어떤 에픽에도 속하지 않은 이슈"만 모아 보는 방법이 없다.

## 2. 확정된 요구사항 (브레인스토밍 결정)

| 결정 항목 | 확정안 |
|---|---|
| 탭 바 우측 활용 | 「에픽」 패널 토글 버튼 배치 |
| 기존 접기 UX | 패널 내부 접기(«)/펼치기(») 버튼·세로 바 **완전 제거** — 진입점은 탭 바 토글 하나 |
| 에픽 없는 프로젝트 | 토글 **항상 노출**, 열면 빈 상태 안내 |
| 기본 상태 | **항상 닫힘**(모든 프로젝트), 사용자 토글은 프로젝트별로 기억 |
| 패널 아이템 디자인 | **A안**: 색점 + 제목 + `n/n` 카운트 한 행 정렬, 아래 얇은 진행바 |
| 추가 필터 항목 | 「전체 이슈」 아래 **「에픽 미할당」** 고정 항목 |
| 프로젝트 설정 버튼 | 현행 유지(PageHeader에 이미 존재) — 이동/추가 없음 |

## 3. UI 설계

### 3.1 뷰 탭 바 — 「에픽」 토글

- `ViewChipBar` 오른쪽 끝(`ml-auto`)에 토글 버튼 추가.
- 형태: 아이콘(`PanelLeft`, 텍스트 동반 장식이므로 `aria-hidden`) + 텍스트 「에픽」. shadcn `Toggle` 프리미티브는 이 저장소에 없음 — 앱 전역 관례(aria-pressed 토글 ~13개)대로 **`Button variant="outline" size="sm"` + `aria-pressed`**, 켜짐 시 `bg-accent`. hover 는 `transition-colors`.
- 항상 노출(EPIC 유형/이슈 존재 여부와 무관). 리스트·보드 뷰 공통.
- `data-testid="epic-panel-toggle"`.

### 3.2 에픽 패널 (승인된 A안 목업 기준)

레이아웃 — 패널은 **콘텐츠 영역 전체 높이**를 채운다(`self-stretch` + flex column, 경계선이 끊기지 않음). 폭 `w-56` 유지.

위에서 아래로:

1. **헤더**: 좌측 「에픽」 레이블(`text-xs font-medium text-muted-foreground`), 우측 에픽 개수(`text-xs text-muted-foreground`). 접기 버튼 없음.
2. **「전체 이슈」** 고정 항목 — 클릭 시 `parentNumber=null` + 미할당 유형 필터 해제. 활성 시 `bg-accent font-medium`.
3. **「에픽 미할당」** 고정 항목 — 클릭 시 에픽에 속하지 않은 이슈만 필터(4.3). 활성 판정·토글 동작은 4.3 참조.
4. **구분선** (`border-t`).
5. **에픽 목록** — 항목당:
   - 1행: 색점(`h-2 w-2 rounded-full`, `avatarColorClass(ep.number)` 의 `bg-*` 토큰만 추출해 사용 — 반환값이 `"bg-x-500 text-white"` 복합 문자열이므로 `.split(' ')[0]` 필요, §1-7 categorical 팔레트 재사용) · 제목(`truncate`, flex:1) · `n/n` 카운트(`text-xs text-muted-foreground`)
   - 2행: 얇은 진행바 — 신규 div 조립 대신 기존 `FreshnessBar` 패턴(`h-1 rounded-full bg-muted overflow-hidden` 트랙 + 색 채움)을 재사용/일반화. 채움 색은 색점과 동일. `role="progressbar"` + `aria-valuenow`(색상 단독 의존 금지, a11y §B). 좌측을 색점 폭만큼 들여쓰기.
   - 선택 시 `bg-accent font-medium`, hover `hover:bg-muted/50`(목록 행 hover 표준 — 선택색 `accent` 와 계열 분리). `transition-colors`.
   - 목록이 길면 패널 내부 스크롤(`overflow-y-auto`), 헤더/고정 항목/푸터는 고정.
6. **spacer** (`flex-1`).
7. **푸터**: `border-t` 위 구분 후 「＋ 에픽 만들기」 버튼(ghost, `text-muted-foreground`) — `IssueCreateDialog`를 **EPIC 유형 프리셋**으로 오픈(다이얼로그에 `initialTypeId`(옵션) prop 추가). 이슈 생성 권한(`canCreateIssue`)이 없으면 숨김.

빈 상태(에픽 0개): `06-feedback-states.md` §B 일반 빈 상태 규범(아이콘+제목+설명+액션) 적용 — 아이콘(`h-10 w-10 text-muted-foreground`, 예: `Layers`) + 제목("아직 에픽이 없습니다", `text-sm font-medium`) + 설명 1줄(`text-xs text-muted-foreground`), 중앙 정렬. 액션(다음 행동)은 푸터 「＋ 에픽 만들기」가 담당(권한 없으면 푸터 자체가 숨겨지므로 설명 문구는 액션 비의존적으로 작성).

공통 규칙:

- 색상은 전부 시맨틱 토큰만 사용. 색점·진행바의 categorical 색은 테마/다크에 반응하지 않는 고정 팔레트(§1-7)임을 전제.
- 패널의 모든 클릭 항목(고정 항목·에픽 행·토글·＋버튼)은 실제 `<button>`(또는 Radix)으로 구현 — shadcn 기본 `focus-visible` 링과 키보드 조작 확보(a11y §C·§J).
- 패널 경계·구분은 shadow 가 아닌 `border` 로만 표현(다크 모드에서 shadow 무효, `11-dark-mode.md` §E-2). 선택 항목 `bg-accent` 의 다크 모드 대비는 시각 검증에서 육안 확인.
- 애니메이션: hover 는 `transition-colors`(150ms), 펄스류(`animate-pulse`)에는 `motion-reduce:animate-none` 병기.

상세 규칙은 `docs/design-system/` 준수.

### 3.3 제거되는 것

- 접힌 상태의 `»` 버튼(현 `epic-panel-collapse-toggle`)과 패널 헤더의 `«` 버튼.
- `epicSidePanel.collapsed` 글로벌 localStorage 키(마이그레이션 없이 폐기 — 잔존 값은 무시됨).
- EPIC 유형 부재 시 `return null` 게이팅(패널 열림 상태면 항상 렌더).

## 4. 구현 구조

### 4.1 상태 끌어올리기

`ViewChipBar`(토글 버튼)와 `EpicSidePanel`이 형제이므로 열림 상태를 `ProjectDetailPage`로 끌어올린다.

- 신규 훅 `useEpicPanelOpen(projectKey)` — `useState` + localStorage 키 **`epicSidePanel.open.<projectKey>`** 읽기/쓰기. 기본값 `false`(닫힘).
- `ProjectDetailPage`에서 호출해 `ViewChipBar`에 `epicPanelOpen`/`onToggleEpicPanel` props 전달, `EpicSidePanel`은 `epicPanelOpen`일 때만 마운트.
- URL 파라미터 방식은 채택하지 않음(URL 오염 + 「전체」 칩 활성 판정 `isAllActive` 로직과 충돌).

### 4.2 EpicSidePanel 리팩터

- `collapsed` 상태·토글·조건 분기 제거, 3.2 레이아웃으로 재구성.
- 데이터 로딩(`useIssueTypes` → EPIC 유형 → `useIssueSearch` limit 100)과 `selectEpic`/`invalidateBodyIssueSearch` 로직은 유지.
- EPIC 유형 자체가 없는 프로젝트: 빈 상태와 동일 처리하되 「＋ 에픽 만들기」는 숨김(EPIC 유형이 없으면 생성 불가).

### 4.3 「에픽 미할당」 필터 — 백엔드 변경 없음

배경: 백엔드 검색은 `topLevel=true → parent_issue_id IS NULL`(기본 목록), `parent=N → 해당 에픽 자식`. "부모 없음" 전용 파라미터는 없다.

- **정의**: 에픽 미할당 = 기본 목록(topLevel) 중 유형이 EPIC이 아닌 이슈.
- **구현**: 클릭 시 `typeIds = (프로젝트 전체 유형 − EPIC)`, `parentNumber = null` 로 URL 갱신. 기존 `filtersToParams` 직렬화 그대로 사용 — 신규 파라미터·백엔드 변경 없음.
- **활성 판정**: `parentNumber == null` 이고 `typeIds` 집합이 정확히 (전체 유형 − EPIC) 집합과 일치할 때. (사용자가 FacetFilter로 동일 집합을 직접 만들면 이 항목이 활성으로 보이는 것은 허용 — 의미상 동일 필터.)
- **토글 해제**: 활성 상태에서 재클릭하면 `typeIds = []` 로 복원(「전체 이슈」와 동일 상태).
- **개수 배지**: 검색 API가 total 을 제공하지 않아 **1차 범위에서 제외**. 후속으로 백엔드 count 지원 시 추가. (승인 목업의 `7` 배지는 이 제약으로 미구현 — 최종 결과물 검토 시 사용자에게 명시적으로 보고)
- 저장 뷰와의 상호작용: 미할당 필터가 걸린 URL 을 「뷰 저장」하면 유형 필터로 저장·복원됨(추가 작업 불필요).

### 4.4 영향 파일

- `pages/projects/ProjectDetailPage.tsx` — 훅 호출, props 배선, 조건 마운트
- `pages/projects/components/ViewChipBar.tsx` — 우측 토글 버튼
- `pages/projects/components/EpicSidePanel.tsx` — 패널 재구성
- `pages/projects/components/IssueCreateDialog.tsx` — `initialTypeId` 옵션 prop
- 신규 `hooks/useEpicPanelOpen.ts`

## 5. 오류/엣지 처리

- 에픽 검색 로딩 중: 목록 자리에 `Skeleton` 컴포넌트 기반 스켈레톤 행 2~3개(색점 자리 `h-2 w-2 rounded-full` + 제목 자리 `h-4 w-full`, `motion-reduce:animate-none` 병기). 실패 시 기존 오류 처리 관례(토스트) 유지, 패널은 빈 상태 표시.
- `childCount == 0` 인 에픽: 진행바 0%, 카운트 `0/0`.
- localStorage 접근 불가 환경: 기본값(닫힘)으로 동작(try/catch).

## 6. 검증 게이트 (필수)

1. **Playwright E2E** (`e2e/pages/`, API 모킹):
   - 토글 클릭 → 패널 열림/닫힘, `aria-pressed` 반영
   - 새로고침 후 상태 유지 + **프로젝트별 독립**(A 프로젝트 열림, B 프로젝트 닫힘)
   - 에픽 0개 프로젝트: 빈 상태 문구 + 「＋ 에픽 만들기」 노출
   - 「에픽 미할당」 클릭 → 검색 요청 query param(`type=<EPIC 제외 유형들>`) 검증, 재클릭 → 해제
   - 「＋ 에픽 만들기」 → 다이얼로그 EPIC 유형 프리셋 검증
   - 기존 에픽 선택/해제·진행률 표시 회귀
   - 기존 spec 의 `epic-panel-collapse-toggle` 참조 정리
2. **디자인 리뷰 (사용자 강조 — 생략 불가)**:
   - `web-design-guidelines` 스킬로 UI 코드 리뷰(a11y 포함)
   - `docs/design-system/` 준수 확인(시맨틱 토큰만, 임의 색 금지)
3. **브라우저 시각 검증 (생략 불가)**: 구현 후 실제 브라우저에서 라이트/다크 모드, 패널 전체 높이, 에픽 다수(스크롤)·0개(빈 상태) 케이스 스크린샷 확인. typecheck+E2E 통과만으로 완료 처리하지 않는다.

## 7. 범위 외

- 프로젝트 설정 버튼 이동(기존 PageHeader 유지)
- 백엔드/마이그레이션 변경, 미할당 개수 배지(후속)
- 보드 뷰 에픽 스윔레인, 에픽 패널 내 드래그 정렬 등 확장
