# 03. Spacing & Layout

Smart Workplace 디자인 시스템의 간격(spacing)과 레이아웃(layout) 규칙을 정의한다.

> 관련 문서: [01-design-tokens.md](01-design-tokens.md) · [02-typography.md](02-typography.md)

---

## Spacing System

### Base Unit

**4px** — Tailwind v4 기본 spacing 단위인 `--spacing: 0.25rem`을 그대로 따른다. 모든 간격 값은 이 단위의 배수여야 한다. (이 4px 그리드 원칙은 보편 규칙으로, 워크플레이스 전 모듈에 적용된다.)

### 승인된 Spacing Scale

| Token | Tailwind class | px | 사용 맥락 |
|-------|----------------|----|-----------|
| space-0.5 | `gap-0.5` / `py-0.5` | 2px | 인박스 배지, 칩 내부 미세 간격 |
| space-1 | `gap-1` / `p-1` | 4px | 아이콘 inner padding, 활성 인디케이터 |
| space-1.5 | `gap-1.5` / `py-1.5` | 6px | 아이콘-텍스트 타이트 간격, 말풍선 세로 padding |
| space-2 | `gap-2` / `p-2` | 8px | **사이드바/레일 nav 간격(`space-y-1`은 4px이나 padding은 8px)**, 채팅 입력바 padding, 인박스 행 |
| space-3 | `gap-3` / `p-3` | 12px | nav 항목 가로 padding(`px-3`), 사이드바 본문 padding(`p-3`), 채팅 도크 본문 |
| space-4 | `gap-4` / `p-4` | 16px | **표준 컴포넌트 padding**, 폼 필드 간격, compact 페이지 padding |
| space-6 | `gap-6` / `p-6` | 24px | **표준 페이지 콘텐츠 padding**, Card body padding(shadcn 기본), 섹션 간격 |
| space-8 | `gap-8` / `p-8` | 32px | 넓은 페이지 padding, 섹션 separator |

> **주의**: `space-5`(20px)는 프로젝트에서 사용하지 않는다. 새로 도입하지 말 것.

### 컴포넌트별 Spacing 기준

코드 실측 기준값이다.

| 컴포넌트 | 적용 규칙 |
|----------|-----------|
| 페이지 콘텐츠 영역 | `p-6` (표준 22곳), 일부 `p-4`/`p-8` |
| Card (CardContent / Header / Footer) | `p-6` (shadcn 기본) |
| Card — compact 변형 | `p-4` |
| 앱 레일(AppRail) — 컨테이너 | `p-2`, nav 항목 간 `space-y-1` |
| 앱 레일 — nav 링크 (데스크톱) | `px-2 py-2.5`, 아이콘 중앙 정렬 |
| 앱 레일 — nav 링크 (모바일 드로어) | `px-3 py-2`, 아이콘+라벨 `gap-3` |
| 모듈 2차 사이드바 — 본문 | `p-3`, nav 항목 간 `space-y-1` |
| 모듈 2차 사이드바 — nav 항목 | `px-3 py-2`, 아이콘+라벨 `gap-2` |
| 사이드바/레일 헤더(앱 타이틀) | `h-14` (56px), `px-4` / 레일은 `px-3` |
| 채팅 도크 헤더 | `h-12` (48px), `px-3` |
| 채팅 도크 본문 | `p-3`, 말풍선 간 `space-y-2` |
| 채팅 입력바 | `p-2`, 입력-버튼 간 `gap-2` |
| Form — 필드 간 | `space-y-4` |
| Form — label + input 간 | `space-y-2` |
| Page section 간 | `space-y-6` |

---

## Layout Skeleton

### AppLayout 구조

`apps/workplace-web/src/components/layout/AppLayout.tsx` 기준 전체 셸. **상단 GNB(글로벌 헤더 바)가 없다.** 좌측 아이콘 앱 레일 → 모듈 2차 사이드바 → 콘텐츠의 3-zone 가로 배치이며, AI 챗 도크는 별도 오버레이로 뷰포트 전체에 떠 있다.

> Fire-hub 와의 차이: fire-hub 는 `sticky top-0` 상단 헤더 + 단일 접이식 사이드바 + 우측 인라인 AI Panel(`w-80 border-l`, side/float/full 모드) 구조였다. 워크플레이스는 **상단 헤더 없음**, 좌측 **고정 아이콘 레일(56px, 확장 모드 없음)** + **모듈별 2차 사이드바(224px)** 2단 구조, AI 는 우측 패널이 아니라 **상단 중앙 칩 런처 + body portal 풀스크린 모달 도크**다.

```
┌──────┬──────────────┬─────────────────────────────────────┐
│ APP  │ MODULE       │  MAIN CONTENT                       │
│ RAIL │ SIDEBAR      │  flex-1 min-w-0 overflow-y-auto     │
│ 56px │ w-56 (224px) │  pt-12 lg:pt-0                      │
│      │              │                                     │
│ 앱   │ 앱 타이틀     │  (각 페이지가 자체 헤더 + p-6 본문   │
│ 마크 │ h-14 border-b │   을 렌더 — 전역 상단 GNB 없음)     │
│ h-14 │              │                                     │
│      │ GroupLabel   │                                     │
│ 모듈 │ + nav        │                                     │
│ 아이 │ (space-y-1)  │                                     │
│ 콘   │              │                                     │
│ ···  │              │                                     │
│      │              │                                     │
│ 인박 │              │                                     │
│ 스🔔 │              │                                     │
│ 유저 │              │                                     │
│ 아바 │              │                                     │
└──────┴──────────────┴─────────────────────────────────────┘
   │
   └─ 데스크톱(lg): static 56px 아이콘 레일 (라벨은 Tooltip)
      모바일(<lg): fixed w-60(240px) z-50 오버레이 드로어 + bg-black/50 스크림(z-40)

  ┌── AI 챗 도크 (별도 레이어, body portal) ────────────────┐
  │  런처 칩: fixed top-2 z-[70], 중앙(콘텐츠 기준 보정       │
  │           lg:left-[calc(50%+28px)])                     │
  │  활성 시: fixed inset-0 z-[60] 스크림 + 중앙 모달 카드    │
  │           (max-w-[52rem], 풀-밴드 높이)                  │
  └─────────────────────────────────────────────────────────┘
```

**Zone 1 — App Rail (`AppRail.tsx`)**
- 데스크톱(lg): `static w-[56px]`, 아이콘만 + 라벨 Tooltip. **확장 모드 없음**(Slack 워크스페이스 레일 / macOS 독 모델).
- 모바일(<lg): `fixed inset-y-0 left-0 z-50 w-60`(240px) 드로어, `translate-x` 토글, 뒤에 `fixed inset-0 z-40 bg-black/50` 스크림. 좌상단 햄버거 `fixed left-3 top-3 z-30`.
- 배경: `bg-sidebar`, `border-r`.
- 구조: 앱 마크 헤더(`h-14 border-b`) → 모듈 런처 nav(`flex-1 p-2 space-y-1`) → 하단(`border-t p-2`)에 인박스(`InboxPanel`) + 유저 메뉴(`AppRailUserMenu`).
- 모듈: 홈 · 작업 관리 · 대화 · 메일 · 연락처 · 드라이브 · 설정 (+ 예정: Wiki).

**Zone 2 — Module Secondary Sidebar (`<Module>ModuleLayout` + `<Module>Sidebar`)**
- 사이드바를 갖는 모듈(작업 관리·대화·메일·연락처·드라이브·설정)은 동일 패턴: `*ModuleLayout` 이 `flex h-full min-h-0 flex-1` 안에 사이드바 + `min-w-0 flex-1 overflow-y-auto` 콘텐츠를 둔다.
- **홈(`/`)은 예외** — 2차 사이드바 없이 AI 캔버스만 콘텐츠 전체에 렌더한다(`HomeModuleLayout` 없음). 챗 도크가 홈의 주 진입점이다.
- 사이드바: `w-56`(224px) `shrink-0`, `border-r`, `bg-sidebar/40`.
- 상단 앱 타이틀 헤더: `sidebarTitleClass` = `h-14 border-b px-4` + 앱 타이틀 텍스트(레일 마크 헤더와 높이 정렬).
- 본문: `flex-1 overflow-y-auto p-3`, nav `space-y-1`, 항목 `px-3 py-2 gap-2`.
- 그룹 라벨: `text-xs font-semibold uppercase tracking-wider text-muted-foreground` (또는 `GroupLabel`: `px-3 pt-3 pb-1`).
- 예: 설정(개인 설정 / 워크스페이스 관리 2그룹, 어드민 게이팅), 메일(계정 목록), 이슈/대화/연락처/드라이브 각각의 사이드바.

**Zone 3 — Main Content (`<main>` in AppLayout)**
- `relative flex min-w-0 flex-1 flex-col overflow-hidden pt-12 lg:pt-0`.
- `pt-12`는 모바일 햄버거(`top-3`) 공간 확보용 — 데스크톱(lg)에서는 0.
- 페이지가 자체 헤더 + 본문을 렌더한다(전역 상단 GNB 없음). 표준 본문 padding `p-6`, 섹션 간격 `space-y-6`.

**AI 챗 도크 (`GlobalChatDock` → `FloatingChat`)** — 우측 패널 아님, 전역 오버레이.
- 런처 칩: `createPortal`로 body 에. `fixed top-2 z-[70]`, 가로 중앙(`left-1/2 -translate-x-1/2`), 데스크톱은 레일 56px 절반만큼 보정해 콘텐츠 중앙(`lg:left-[calc(50%+28px)]`). 활성 시 `border-ai-accent` 강조.
- 활성(open) 시: body portal `fixed inset-0 z-[60]`. `bg-black/40` 스크림이 앱 레일(z-50) 포함 전 영역을 딤 처리. 중앙에 불투명 모달 카드 `mx-auto max-w-[52rem]`, 풀-밴드 높이(`pt-16 pb-4` 밴드, `h-full`), `chat-dock-expand` 애니메이션(origin-top, 0.4s).
- 도크 내부: 헤더(`h-12`, 대화 선택 + 새 대화) → 본문(`flex-1 p-3`, 말풍선 `space-y-2`) → 입력바(`border-t p-2`).
- 단축키: ⌘K/Ctrl+K 토글, Esc/스크림 클릭 닫기.

### TSX Skeleton

```tsx
// AppLayout — 전역 셸 (상단 GNB 없음)
export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Zone 1: 앱 레일 (데스크톱 56px / 모바일 드로어) */}
      <AppRail />

      {/* Zone 2+3: 모듈 콘텐츠 + 전역 챗 도크 */}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden pt-12 lg:pt-0">
        <Outlet />          {/* 모듈 라우트: <Module>ModuleLayout 이 2차 사이드바 + 콘텐츠 렌더 */}
        <GlobalChatDock />  {/* body portal 오버레이 — 우측 패널 아님 */}
      </main>
    </div>
  )
}

// 각 모듈 라우트의 2차 사이드바 + 콘텐츠 (모든 모듈 동일 패턴)
export function IssueModuleLayout() {
  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* w-56 shrink-0 border-r bg-sidebar/40 */}
      <IssueSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet /> {/* 페이지가 자체 헤더 + p-6 본문 렌더 */}
      </div>
    </div>
  )
}
```

**너비 요약**

| 영역 | 데스크톱(lg) | 모바일(<lg) |
|------|-------------|-------------|
| 앱 레일 | `static w-[56px]` (아이콘) | `fixed w-60`(240px) 드로어 + `bg-black/50` 스크림 |
| 모듈 2차 사이드바 | `w-56`(224px) `shrink-0` | 동일(좁은 화면은 모듈별 처리) |
| 메인 콘텐츠 | `flex-1 min-w-0` | `flex-1`, `pt-12`(햄버거 여백) |
| 챗 도크 모달 | `max-w-[52rem]`(832px) 중앙 | 좌우 `px-4`~`px-6` 여백 내 |

---

## Grid Patterns

워크플레이스에서 실제로 사용하는 그리드 패턴. (fire-hub 의 react-grid-layout 동적 대시보드는 워크플레이스에 **없다** — `react-grid-layout` 미사용.)

### 패턴 1 — Stat Cards (통계 카드 행)

홈/대시보드 상단 KPI 카드 행. `lg:grid-cols-4` 가 실사용된다.

```tsx
<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
  <StatCard title="열린 이슈" value={42} />
  <StatCard title="내 담당" value={7} />
  <StatCard title="안읽음 알림" value={3} />
  <StatCard title="이번 주 완료" value={12} />
</div>
```

### 패턴 2 — Two-Column Content (2열 콘텐츠)

두 카드를 나란히 배치. `md:grid-cols-2`.

```tsx
<div className="grid gap-4 md:grid-cols-2">
  <Card>
    <CardHeader><CardTitle>최근 활동</CardTitle></CardHeader>
    <CardContent>{/* ... */}</CardContent>
  </Card>
  <Card>
    <CardHeader><CardTitle>내 이슈</CardTitle></CardHeader>
    <CardContent>{/* ... */}</CardContent>
  </Card>
</div>
```

### 패턴 3 — Detail Info Grid (상세 정보 그리드)

이슈/프로젝트/연락처 상세의 메타데이터 필드 나열. `grid-cols-2` 가 기본, 필드가 많으면 `md:grid-cols-3`.

```tsx
<div className="grid grid-cols-2 md:grid-cols-3 gap-4">
  <InfoField label="담당자" value={issue.assignee} />
  <InfoField label="상태" value={issue.status} />
  <InfoField label="우선순위" value={issue.priority} />
  <InfoField label="생성일" value={issue.createdAt} />
  <InfoField label="라벨" value={issue.labels.join(', ')} />
  <InfoField label="마일스톤" value={issue.milestone} />
</div>
```

### 패턴 4 — Fixed Panel + Fluid Area (고정 패널 + 가변 영역)

설정 패널/리스트가 고정 너비이고 본문이 가변일 때. 실사용 토큰: `lg:grid-cols-[280px_1fr]`(좌측 고정) 또는 `lg:grid-cols-[1fr_280px]`(우측 고정).

```tsx
{/* 좌측 280px 고정 + 우측 가변 */}
<div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
  <Card className="h-fit">
    <CardHeader><CardTitle>필터</CardTitle></CardHeader>
    <CardContent className="space-y-4">{/* 설정 폼 */}</CardContent>
  </Card>
  <div className="space-y-4">{/* 결과 영역 */}</div>
</div>

{/* 우측 280px 고정(예: 상세 + 사이드 메타) */}
<div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
  <div>{/* 본문 */}</div>
  <aside className="space-y-4">{/* 메타/액션 */}</aside>
</div>
```

> 이 280px 고정 패널은 **페이지 내부** 레이아웃이다. AppLayout 의 모듈 2차 사이드바(224px)와 혼동하지 말 것 — 후자는 셸 레벨 네비게이션이다.

### 패턴 5 — Auto/Token 컬럼 그리드

라벨-값 정렬 등 한 열은 콘텐츠 폭, 한 열은 가변일 때. `grid-cols-[1fr_auto]`, `grid-cols-[120px_1fr]` 같은 토큰을 사용한다.

```tsx
{/* 라벨(120px) + 값(가변) */}
<div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
  <span className="text-muted-foreground">담당자</span>
  <span>{issue.assignee}</span>
</div>
```

---

## Content Area 최대 너비

페이지 유형에 따라 콘텐츠 영역의 최대 너비를 다르게 적용한다. 폼/상세는 `mx-auto`로 가운데 정렬. (실측: `max-w-2xl` 8곳, `max-w-3xl` 2곳, `max-w-md` 3곳.)

| 페이지 유형 | 클래스 | 최대 너비 |
|------------|--------|-----------|
| 인증(로그인/가입) | `max-w-md mx-auto` | 448px |
| Forms / Settings | `max-w-2xl mx-auto` | 672px |
| Detail pages | `max-w-3xl mx-auto` | 768px |
| Tables / Boards / Lists | `w-full` | 제한 없음 |

```tsx
{/* 인증 페이지 */}
<div className="max-w-md mx-auto space-y-6">
  <h1 className="text-2xl font-semibold tracking-tight">로그인</h1>
  <form className="space-y-4">{/* ... */}</form>
</div>

{/* Form / Settings 페이지 */}
<div className="max-w-2xl mx-auto space-y-6 p-6">
  <h2 className="text-2xl font-semibold tracking-tight">프로필 설정</h2>
  <form className="space-y-4">{/* ... */}</form>
</div>

{/* Detail 페이지 */}
<div className="max-w-3xl mx-auto space-y-6 p-6">
  <DetailHeader />
  <DetailBody />
</div>

{/* 칸반 보드 / 이슈 목록 — 전체 너비 */}
<div className="w-full space-y-4 p-6">
  <IssueTable />
</div>
```

---

## 현재(As-Is) vs 권장(To-Be)

| 항목 | 현재(As-Is) | 권장(To-Be) |
|------|------------|------------|
| 임의 간격 값 | 페이지 padding 이 `p-6`/`p-4`/`p-8` 혼용 | 표준 `p-6`, compact 만 `p-4`, 넓은 화면만 `p-8` |
| Card padding | shadcn 기본 `p-6` 일관 | 유지, compact 변형만 `p-4` |
| 콘텐츠 최대 너비 | `max-w-md`/`2xl`/`3xl` 혼재 | 위 표의 4가지 패턴으로 표준화 |
| 그리드 패턴 | 페이지마다 임의 grid | 위 5가지 패턴 재사용 |
| 페이지 헤더 | 전역 GNB 없이 페이지마다 자체 헤더 | 헤더 컴포넌트 공통화 검토(높이/간격 표준) |
