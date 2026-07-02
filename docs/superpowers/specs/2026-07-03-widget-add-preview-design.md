# 위젯 추가 모달 — 라이브 프리뷰 설계

- 작성일: 2026-07-03
- 관련 이슈: 미등록(브레인스토밍 단계, 플랜 작성 후 GitHub Projects #4 등록 예정)
- 상태: 설계 완료, 사용자 승인 대기

## 배경

`apps/workplace-web/src/components/home/widgets/AddWidgetModal.tsx`는 현재 좌측 카테고리 +
우측 카드 그리드로 구성되며, 카드는 아이콘 · 제목 · "카테고리 · 크기" 서브텍스트만 보여준다.
어떤 위젯인지 모르는 상태로 클릭하면 즉시 대시보드에 추가되기 때문에, 사용자가 위젯의 실제
모습을 미리 확인할 방법이 없다.

타 서비스(macOS/iOS 위젯 갤러리, Grafana 시각화 피커) 리서치 결과, 위젯을 자체 제작·검증하는
서비스는 공통적으로 **좌측 목록 + 우측 라이브(또는 근사 라이브) 프리뷰** 패턴을 쓰고, 설정은
추가 후에 처리한다. Slack/Trello/Google Add-ons류의 정적 스크린샷 + OAuth 동의 게이트는
검증되지 않은 다수의 서드파티 확장을 다루기 위한 오버헤드이며, 9개 위젯을 전부 자체 제작한
현재 상황에는 해당하지 않는다.

## 범위

**포함**
- `AddWidgetModal`을 3단 레이아웃(카테고리 / 카드 목록 / 프리뷰 패널)으로 재구성
- 카드 클릭 = 선택(하이라이트)으로 동작 변경, 프리뷰 패널 하단 "+ 위젯 추가" 버튼으로 실제 추가
- 시스템 위젯 8종(`registry.ts`) + 카탈로그 위젯 9종(`catalogRegistry.ts`), 총 17개 컴포넌트에
  대한 고정 목데이터 프리뷰
- 각 위젯 컴포넌트가 `previewData` prop 주입 시 실제 API 호출 없이 즉시 렌더하도록 하는 공통 패턴
- 좁은 화면에서 프리뷰 패널을 카드 목록 아래로 스택하는 최소 반응형 대응

**제외 (후속 과제)**
- 위젯별 사용자 정의 프리뷰 데이터(현재 로그인 사용자의 실제 최근 데이터를 미리보기에 반영) —
  고정 샘플로 충분하다는 사용자 결정
- 카드 그리드 자체의 재검색/필터(검색창) 추가 — 카테고리 사이드바로 충분한 현재 규모(17개) 유지
- 위젯별 사이즈 변형(macOS S/M/L처럼 같은 위젯의 여러 크기 미리보기) — 이 앱의 위젯은
  카탈로그가 정의한 고정 크기(`1×1`/`1×2`) 하나뿐이라 해당 없음

## 아키텍처

### 레이아웃 (`AddWidgetModal.tsx`)

`DialogContent` 폭을 `max-w-5xl` → `max-w-6xl`로 확장하고, 기존 `flex gap-4` 2단 구조에
프리뷰 패널을 추가해 3단으로 만든다.

- **카테고리** (기존 유지, `w-32`)
- **카드 목록** (기존 그리드 대신 고정폭 `w-56` 단일 열 목록으로 변경, `max-h-[70vh] overflow-y-auto`
  유지). 각 카드는 클릭 시 추가 대신 `selectedType` state를 갱신하고 `aria-pressed`/테두리 강조로
  선택 상태 표시.
- **프리뷰 패널** (`flex-1`): 선택된 위젯의 제목 + 카탈로그 설명(신규 `description` 필드, 아래
  "카탈로그 메타데이터 확장" 참고) + 실제 컴포넌트를 목데이터로 렌더 + 하단 "+ 위젯 추가" 버튼.
- 모달을 열거나 카테고리를 전환하면 해당 목록의 첫 카드가 자동 선택된다(빈 프리뷰 상태 없음).
  목록이 비어 있으면(카테고리에 위젯 없음) 프리뷰 패널도 안내 문구만 표시.
- 카드 클릭 시 즉시 추가 + 닫힘이었던 기존 동작(`handleAdd`)은 "+ 위젯 추가" 버튼 클릭으로
  이동한다. 버튼 클릭 시에만 `onAdd(type)` 호출 + `onOpenChange(false)`.
- 반응형: `lg` 미만에서는 프리뷰 패널을 카드 목록 아래로 세로 스택(`flex-col lg:flex-row`).
  상호작용 모델(선택 → 프리뷰 → 추가)은 화면 크기와 무관하게 동일하다.

### 카탈로그 메타데이터 확장 (`catalogRegistry.ts`)

`CatalogWidget`에 `description: string` 필드를 추가(1줄, 용도 설명). 시스템 위젯
(`DashboardWidget`)에도 동일하게 `description` 필드를 추가해 프리뷰 패널 상단에 노출한다.
기존 필드(`type`/`title`/`icon`/`category`/`size`/`defaultParams`/`fields`)는 변경 없음.

### 목데이터 주입 패턴

각 위젯 컴포넌트(카탈로그 9종 + 시스템 8종, 총 17개)에 선택적 `previewData` prop을 추가한다.

```ts
// 예시: CalendarWidget
export default function CalendarWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: CalendarEvent[]
}) {
  const { from, to } = resolveRange(params)
  const { data, isLoading, isError, refetch } = useCalendarEvents(from, to, {
    enabled: !previewData,
  })
  const items = previewData ?? data ?? []
  const loading = !previewData && isLoading
  const errored = !previewData && isError
  // 이하 렌더 로직은 기존과 동일 (loading/errored/items 사용)
}
```

- `previewData`가 주어지면 내부 데이터 훅은 `enabled: false`로 비활성화되어 API 호출이
  발생하지 않는다. React Hook 규칙상 훅 호출 자체는 유지하고 `enabled` 옵션만으로 끈다
  (조건부 훅 호출 금지 원칙 준수).
- `useCalendarEvents` 등 기존 커스텀 쿼리 훅 중 `enabled` 옵션을 지원하지 않는 것은 이번 작업
  범위에서 옵션 파라미터를 추가한다(각 훅은 이미 TanStack Query `useQuery`를 감싸고 있어 옵션
  전달 통로만 추가하면 됨).
- 로딩 스켈레톤/에러 상태는 `previewData` 존재 시 항상 스킵 — 프리뷰는 항상 "데이터 있음"
  상태로만 보여준다.

### 프리뷰 픽스처 (`widgetPreviewFixtures.ts`, 신규)

17개 위젯 각각의 목데이터를 한 파일에 모아 정의한다. 각 위젯이 실제로 소비하는 응답 타입
(`src/types/*`)을 그대로 사용해 타입 안전성을 보장하고, 내용은 실제스러운 한글 샘플 2~4건
(위 목업의 "로그인 세션 만료 버그 수정" 같은 예시)으로 구성한다.

```ts
export const widgetPreviewFixtures: Record<string, unknown> = {
  issue_list: [...],
  mail_list: [...],
  calendar: [...],
  // ... 총 17개
}
```

`AddWidgetModal`의 프리뷰 패널은 `widgetPreviewFixtures[selectedType]`을 `previewData`로,
카탈로그 위젯은 `defaultParams`를(시스템 위젯은 기본 `count`) `params`/`count`로 그대로 넘겨
실제 대시보드에 추가됐을 때와 동일한 조건으로 렌더한다.

### 컴포넌트 매핑

프리뷰 패널은 선택된 `type`에 따라 `getChatWidget(type)`(카탈로그, `chatWidgetRegistry.ts`)
또는 `getDashboardWidget(type)?.Component`(시스템, `registry.ts`)로 컴포넌트를 조회해 렌더한다
— 신규 레지스트리를 만들지 않고 기존 두 레지스트리를 그대로 재사용.

## 테스트

`e2e/pages/home.spec.ts`(위젯 추가 모달 관련 기존 스펙)에 추가:
- 카드 클릭 시 즉시 추가되지 않고 선택 상태(하이라이트)만 바뀌는지, API 호출이 발생하지
  않는지(네트워크 모킹 미충족으로 검증) 확인
- 선택한 위젯의 프리뷰 패널에 해당 위젯 컴포넌트 + 목데이터가 렌더되는지(위젯별 대표 텍스트
  단언)
- "+ 위젯 추가" 버튼 클릭 시 실제 추가 API 호출(payload에 올바른 `type`) + 모달 닫힘 + 대시보드
  반영 확인
- 카테고리 전환 시 목록 첫 카드가 자동 선택되고 프리뷰가 그에 맞춰 갱신되는지
- 좁은 뷰포트에서 프리뷰 패널이 카드 목록 아래로 스택되는지(레이아웃 클래스 확인 수준)
