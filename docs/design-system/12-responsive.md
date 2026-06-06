# 12. Responsive Design

Smart Workplace 디자인 시스템의 반응형 디자인 전략과 구현 규칙을 정의한다.

---

## 전략 개요

**Desktop-first** 전략을 채택한다. Smart Workplace 는 이슈 트래커·채팅·메일·드라이브 등 정보 밀도가 높은 업무 도구이며, 주 사용 환경은 데스크톱 브라우저(마우스/키보드)다.

- 기본 스타일은 데스크톱 기준으로 작성한다.
- 모바일 적응은 **레이아웃 붕괴 방지 수준**으로만 처리한다(앱 레일 드로어 전환 + grid stacking).
- **솔직한 현황**: 본격적인 모바일 UX(예: 메일 2-pane → 모바일 단일 뷰 전환, 칸반 보드의 터치 최적화, 모바일 전용 내비게이션)는 아직 정돈되지 않았다. 데스크톱-우선 앱이며, 모바일은 "깨지지 않는다" 수준이지 "최적화되었다" 수준이 아니다. 아래 본문은 이를 부풀리지 않고 있는 그대로 기술한다.

---

## Breakpoints

Tailwind v4 기본 breakpoint 를 그대로 사용한다. `index.css` 에 커스텀 breakpoint 나 별도의 반응형 유틸리티는 정의하지 않는다.

| Prefix | 최소 너비 | 주요 사용 목적 |
|--------|-----------|--------------|
| `sm:` | 640px | Dialog 최대 너비(`sm:max-w-lg`), Dialog footer flex 방향 전환, sidebar primitive 내부 |
| `md:` | 768px | Grid column 수 증가 (1열 → 2열), Input 텍스트 크기(`md:text-sm`) |
| `lg:` | 1024px | **앱 레일 모드 전환의 핵심 분기점** — 드로어↔아이콘 레일, grid 다열, 좌우 분할 레이아웃 |

> `xl:` (1280px), `2xl:` (1536px) 은 현재 프로젝트에서 사용하지 않는다(앱 코드 검색 결과 0건).

> **실측 사용량**: 앱 전체에서 반응형 prefix 가 쓰인 파일은 약 **16개**다. 빈도순으로 `lg:`(앱 레일·분할 레이아웃) > `md:`(grid 2열) > `sm:`(Dialog 한정). 즉 반응형 처리의 대부분은 앱 셸(레일/레이아웃)과 소수의 grid 스택킹에 집중되어 있고, 페이지 내부 콘텐츠 대부분은 단일(데스크톱) 레이아웃이다.

---

## 앱 셸 반응형 동작 (App Rail + Main)

전역 셸은 `AppLayout` 이 `AppRail`(좌측 앱 런처) + `main`(모듈 콘텐츠) + `GlobalChatDock` 로 구성한다. 상단 GNB 는 없다. 분기점은 오직 `lg`(1024px) 하나다.

```tsx
// AppLayout.tsx
<div className="flex h-screen overflow-hidden">
  <AppRail />
  {/* 모바일은 상단 고정 햄버거를 위해 pt-12, 데스크톱(lg)은 pt-0 */}
  <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden pt-12 lg:pt-0">
    <Outlet />
    <GlobalChatDock />
  </main>
</div>
```

### 데스크톱 (`>= lg`, 1024px 이상) — 상주 아이콘 레일

앱 레일은 **항상 56px 아이콘 레일**이다. 확장/축소 토글이 없다(Slack 워크스페이스 레일 / macOS 독 모델). 라벨은 아이콘 hover 시 우측 Tooltip 으로만 노출한다. 텍스트 맥락(깊은 네비)은 각 모듈의 2차 사이드바가 책임진다.

```
┌──────┬───────────────────────────────────────┐
│  []  │  MODULE CONTENT                       │   ← 레일은 lg:static (문서 흐름 차지)
│  []  │  (각 모듈이 자체 2차 사이드바를 가짐)   │
│  []  │                                       │
│ 56px │  flex-1 overflow-hidden               │
└──────┴───────────────────────────────────────┘
  lg:w-[56px] lg:static
```

```tsx
// AppRail.tsx — 데스크톱 분기
<aside className={cn(
  "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r bg-sidebar ...",
  "lg:static lg:w-[56px] lg:translate-x-0",   // 데스크톱: 정적 56px 아이콘 레일
  mobileOpen ? "translate-x-0" : "-translate-x-full",
)}>
```

### 모바일 (`< lg`, 1024px 미만) — 오버레이 드로어

레일은 화면 밖으로 숨고(`-translate-x-full`), 좌상단 고정 햄버거(`fixed left-3 top-3`, `aria-label="메뉴 열기"`)로 연다. 열리면 `w-60` 드로어가 슬라이드 인하고 `bg-black/50` 오버레이가 깔린다. 드로어 안에서는 아이콘+라벨을 함께 보여준다(데스크톱은 아이콘만). `Escape` 또는 오버레이 클릭으로 닫는다(접근성: [10-accessibility.md](10-accessibility.md) 참조).

```
[기본: 닫힘]                        [햄버거 클릭]
┌────────────────────────┐         ┌─────────┬──────────────────┐
│ ☰                      │         │ DRAWER  │░ Overlay z-40 ░░│
│   MODULE CONTENT       │         │ w-60    │░ bg-black/50  ░░│
│   (전체 너비, pt-12)    │         │ z-50    │░░░░░░░░░░░░░░░░░│
│                        │         │ 아이콘+  │░░░░░░░░░░░░░░░░░│
│                        │         │ 라벨    │░░░░░░░░░░░░░░░░░│
└────────────────────────┘         └─────────┴──────────────────┘
```

> **한계(솔직히)**: 앱 레일의 드로어 전환은 잘 동작하지만, **각 모듈 내부**(메일 2-pane, 이슈 상세 좌우 분할 등)는 모바일에서 별도 단일-뷰 전환을 하지 않는다. 좁은 화면에서는 2차 사이드바/패널이 함께 눌려 가독성이 떨어질 수 있다. 이는 데스크톱-우선 정책상 의도된 미완성이며, 모바일 본격 지원은 백로그다.

---

## 반응형 패턴 모음

### 1. 모바일에서 숨기기 / 데스크톱에서만 표시

가장 빈번한 패턴(`lg:hidden` 약 6곳, `lg:block` 약 4곳). 모바일 햄버거는 `lg:hidden`, 데스크톱 Tooltip 라벨은 `hidden lg:block`.

```tsx
{/* 모바일 전용 햄버거 */}
<button className="fixed left-3 top-3 z-30 ... lg:hidden" aria-label="메뉴 열기">
  <Menu className="h-5 w-5" />
</button>

{/* 드로어 라벨은 모바일에서만, 데스크톱은 Tooltip 으로 대체 */}
<span className="lg:hidden">{item.label}</span>
<TooltipContent side="right" className="hidden lg:block">{item.label}</TooltipContent>
```

### 2. Stacking Grid — 모바일 1열 → 데스크톱 다열

실제 사용처:

```tsx
{/* 홈 캔버스 / 일반 카드: 1 → 2열 */}
<div className="grid grid-cols-1 gap-4 md:grid-cols-2">…</div>

{/* 이슈 보드 통계 카드: 1 → 2 → 4열 */}
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">…</div>
```

### 3. 좌우 분할 — 모바일 수직 스택 → 데스크톱 고정폭 사이드 + 본문

이슈 상세, 에이전트 관리 등에서 사용. `lg` 미만은 위아래로 쌓이고, `lg` 이상에서 고정폭 컬럼이 생긴다.

```tsx
{/* 이슈 상세: 본문 + 우측 280px 메타 패널 */}
<div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
  <IssueMain />
  <IssueMetaPanel />
</div>

{/* 좌측 280px 설정 + 본문 */}
<div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
  <SettingsPanel />
  <ContentArea />
</div>
```

### 4. Dialog — 폭과 footer 방향

shadcn `Dialog`/`AlertDialog` 는 좁은 화면에서 `max-w-[calc(100%-2rem)]`(좌우 여백 확보), `sm` 이상에서 `sm:max-w-lg` 로 고정된다. Footer 버튼은 모바일 수직(취소가 아래) → `sm` 이상 수평 우측 정렬.

```tsx
<DialogContent>{/* w-full max-w-[calc(100%-2rem)] sm:max-w-lg */}…</DialogContent>

<DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
  <Button variant="outline" onClick={onClose}>취소</Button>
  <Button type="submit">저장</Button>
</DialogFooter>
```

```
모바일 (< sm)          데스크톱 (>= sm)
┌─────────────┐        ┌──────────────────────────┐
│    저장      │        │              취소   저장  │
├─────────────┤        └──────────────────────────┘
│    취소      │
└─────────────┘
```

### 5. Input 텍스트 크기

모바일은 기본(16px, iOS 자동 줌 방지), 데스크톱은 `md:text-sm` 로 밀도를 높인다.

```tsx
<Input className="md:text-sm" placeholder="검색…" />
```

### 6. 메일 목록 폭 제한

메일 인박스는 좌측 목록 + 우측 본문 구조에서 목록 폭을 `lg:max-w-md` 로 제한한다(데스크톱에서 본문 영역 확보).

```tsx
<div className="flex min-w-0 flex-1 flex-col border-r lg:max-w-md">{/* mail list */}</div>
```

---

## 현재 반응형 사용 현황

| Prefix | 사용 빈도 | 주요 패턴 |
|--------|-----------|-----------|
| `lg:` | 높음 | `lg:hidden`, `lg:static`, `lg:w-[56px]`, `lg:grid-cols-4`, `lg:grid-cols-[1fr_280px]`, `lg:pt-0`, `lg:max-w-md` |
| `md:` | 중간 | `md:grid-cols-2`, `md:text-sm` |
| `sm:` | 낮음 | `sm:max-w-lg`, `sm:flex-row`, `sm:justify-end` (Dialog 한정) + sidebar primitive 내부 |

> 반응형 클래스가 등장하는 파일은 약 16개로, 대부분 앱 셸(`AppLayout`/`AppRail`)과 소수 grid·분할 레이아웃에 몰려 있다. 페이지 콘텐츠 내부는 사실상 데스크톱 단일 레이아웃이다.

---

## 현재(As-Is) vs 권장(To-Be)

| 항목 | 현재(As-Is) | 권장(To-Be) |
|------|------------|------------|
| 전략 | Desktop-first | Desktop-first 명시, 모바일 최소 지원 범위 문서화(본 문서) |
| 앱 레일 | `lg` 기준 드로어↔56px 아이콘 레일 전환 (완성도 양호) | 현행 유지 |
| 모듈 내부 모바일 | 메일/이슈 분할 패널이 모바일 단일-뷰 미전환 | 좁은 화면에서 패널 1개씩 보이는 단계 네비게이션(백로그) |
| 칸반 보드 | 드래그 중심, 터치/키보드 대체 빈약 | 모바일 터치 DnD·키보드 대체 경로(백로그, [10-accessibility.md](10-accessibility.md) 연계) |
| `xl:` / `2xl:` | 미사용 | 도입 지양. 넓은 화면은 `max-w-*` 로 콘텐츠 폭 제어 |
| 반응형 테스트 | 없음 | `md`/`lg` 두 기준 스크린샷 회귀 테스트 추가(모바일 지원 착수 시) |

---

## 주의 사항

1. **`xl:` / `2xl:` 신규 도입 금지**: 현재 미사용. 넓은 화면 제어는 `max-w-*` 로 콘텐츠 폭을 제한해 처리한다.
2. **앱 레일 너비 `lg:w-[56px]` 는 임의 값(arbitrary value)**: Tailwind scale 에 없는 값으로, 변경 시 레일 내 모든 아이콘 정렬·Tooltip 위치·`main` 폭에 영향을 준다. 변경은 신중히.
3. **단일 분기점(`lg`) 의존**: 앱 셸 전환이 `lg`(1024px) 한 곳에 집중되어 있다. 768~1024px 태블릿 가로 구간에서도 모바일 드로어가 적용되므로, 태블릿 경험이 데스크톱과 다르다는 점을 인지한다.
4. **모바일 전용 UI 신규 설계는 신중히**: 본격 모바일 지원이 백로그인 상태에서 부분적 모바일 컴포넌트를 추가하면 일관성이 깨진다. 추가 전 본 문서·디자인 결정을 갱신한다.
5. **모듈 내부 분할 레이아웃**: `lg:grid-cols-[1fr_280px]` 같은 고정폭 사이드는 `lg` 미만에서 위아래로 쌓일 때 패널 순서(본문 먼저 vs 메타 먼저)가 의도와 맞는지 확인한다.
