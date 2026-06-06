# 08. Animation & Motion

UI 전반의 애니메이션과 전환 효과 패턴을 정의한다. 일관된 타이밍과 목적 있는 모션은 인터페이스의 품질감을 높이고 사용자의 맥락 유지를 돕는다.

> **기준 파일**: `apps/workplace-web/src/index.css`, 컴포넌트 코드
> **스택**: Tailwind v4 + `tw-animate-css` + shadcn/ui. 커스텀 키프레임은 `index.css`에 정의.

---

## A. 현재(As-Is) Tailwind 전환 패턴

코드베이스에서 실제로 사용 중인 Tailwind 기반 전환·애니메이션 패턴.

### 1. `transition-colors` — 색상 전환

테이블 행 hover, 버튼, 네비게이션 아이템에 가장 광범위하게 사용된다(약 17개 인스턴스로 최다).

```tsx
{/* 이슈 테이블 행 hover */}
<TableRow className="transition-colors hover:bg-muted/50 cursor-pointer" />

{/* 사이드바 네비게이션 아이템 */}
<NavItem className="transition-colors hover:bg-accent hover:text-accent-foreground" />
```

### 2. `transition-[color,box-shadow]` — Input/포커스 전환

Input·Button의 포커스 ring 전환 등에 특정 속성만 명시한다(약 4건). shadcn/ui Input 기본 패턴.

```tsx
<input className="transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50" />
```

### 3. `transition-opacity` — 투명도 전환

`group-hover`와 함께 hover 시 액션 버튼을 표시/숨김 처리한다.

```tsx
<TableRow className="group">
  <TableCell>
    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
      <Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
    </div>
  </TableCell>
</TableRow>
```

### 4. `transition-all` / `transition-transform duration-200` — 패널/사이드바 전환

사이드바 펼침·접힘, 패널 크기 조정 등에 사용된다.

```tsx
<aside className="transition-transform duration-200" />
```

### 5. `animate-spin` — 로딩 스피너

`Loader2` 아이콘과 함께 로딩 상태를 나타낸다(2건).

```tsx
<Loader2 className="h-4 w-4 animate-spin" />
```

### 6. `animate-pulse` — 진행/대기 인디케이터

도구 실행 중·로딩 상태 표시에 사용된다(3건).

```tsx
<span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
```

### 7. `animate-in` / `animate-out` — shadcn 진입/퇴장

Dialog, Popover, Tooltip 등 shadcn/ui 컴포넌트에 기본 적용된다(`animate-in` 10건, `animate-out` 9건). `tw-animate-css`가 키프레임을 제공한다.

```tsx
{/* shadcn Dialog 내부 (자동 적용) */}
"animate-in fade-in-0 zoom-in-95"
"animate-out fade-out-0 zoom-out-95"
```

---

## B. 커스텀 키프레임 & 효과 클래스 (`index.css`)

Workplace는 `index.css`에 브랜드 고유의 커스텀 애니메이션과 효과 유틸리티를 직접 정의한다. 대부분 라이트/다크/테마변형별 분기를 가진다.

> 아래 "사용 중" 표기는 `src/**/*.{tsx,ts}` 컴포넌트 코드에서의 실제 참조 기준이다. CSS 정의만 있고 컴포넌트가 참조하지 않는 효과는 [B-3](#b-3-정의됨미사용-효과-제거-후보)에 따로 분류한다.

### B-1. 사용 중인 효과 클래스

#### `.row-hover` — 행 hover 배경 (컴포넌트 3건)

목록 행(이슈/메일/연락처 리스트)의 hover 배경 전환. 다크에서는 인디고 알파 배경으로 분기.

```css
.row-hover { transition: background-color 0.15s, border-color 0.15s; }
.dark .row-hover:hover { background-color: oklch(0.65 0.2 264 / 4%); }
```

#### `.nav-active-indicator` — 활성 사이드바 표시기 (컴포넌트 1건)

활성 네비 항목 좌측의 3px 바. 다크에서는 인디고→퍼플 그라데이션 + glow로 분기한다.

```css
.nav-active-indicator::before { /* … */ width: 3px; background: var(--primary); }
.dark .nav-active-indicator::before {
  background: linear-gradient(180deg, oklch(0.65 0.2 264), oklch(0.6 0.2 300));
  box-shadow: 0 0 8px oklch(0.65 0.2 264 / 40%);
}
```

### B-2. `chat-dock-expand` — AI 챗 도크 등장 (사용 중)

AI 플로팅 챗(`FloatingChat`)이 상단 런처에서 아래로 내려오며 펼쳐지는 진입 애니메이션. `origin-top`과 함께 `translateY` + 가벼운 `scaleY` 성장을 결합한다.

```css
@keyframes chat-dock-expand {
  from { opacity: 0; transform: translateY(-56px) scaleY(0.9); }
  to { opacity: 1; transform: translateY(0) scaleY(1); }
}
```

```tsx
{/* FloatingChat */}
<div className="origin-top animate-[chat-dock-expand_0.4s_cubic-bezier(0.16,1,0.3,1)]" />
```

### B-3. 정의됨·미사용 효과 (제거 후보)

다음 효과 클래스/키프레임은 `index.css`에 완전히 정의(라이트/다크 분기 포함)되어 있으나, **현재 컴포넌트 코드에서 참조되지 않는다.** 일부는 향후 적용 의도가 있는 브랜드 효과이고, 일부는 sibling 프로젝트(react-flow 캔버스·AI 칩)에서 물려받은 잔존 코드다.

#### 효과 클래스 (CSS 정의만 존재)

| 클래스 | 의도 | 다크 분기 | 상태 |
|--------|------|-----------|------|
| `.bg-gradient-main` | 페이지 베이스 라디얼 그라데이션 (테마별) | 있음 | 정의됨, 컴포넌트 미참조 |
| `.card-hover` | 카드 hover 부유(`translateY` + shadow/border glow) | 있음 | 정의됨, 컴포넌트 미참조 |
| `.status-online` | 아바타 온라인 점(녹색, 다크 glow) | 있음 | 정의됨, 컴포넌트 미참조 |
| `logo-pulse` (6종 키프레임) | 로고 box-shadow 펄스(테마별) | 있음 | 정의됨, 컴포넌트 미참조 |
| `.glass` | 글래스모피즘 `backdrop-filter: blur(12px)` | — | 정의됨, 컴포넌트 미참조 |

> 이들은 브랜드 효과로 잘 설계돼 있으나 아직 화면에 연결되지 않았다. 적용 시 위 CSS를 그대로 클래스로 부여하면 된다(예: `<Card className="card-hover" />`).

#### 잔존 키프레임 (sibling 유래, 제거 후보)

| 키프레임 | 원 용도 | 상태 |
|----------|---------|------|
| `ai-chip-pulse` / `ai-chip-slide` / `ai-chip-hover-progress` | AI 상태 칩 애니메이션 | 미사용 |
| `canvas-widget-in` / `canvas-widget-out` | 캔버스 위젯 진입/퇴장 | 미사용 |
| `canvas-page-slide-in-left` / `-right` / `canvas-dim-in` | 캔버스 페이지 전환 | 미사용 |

> 같은 맥락으로 `.dark .react-flow__*` 스타일도 react-flow 의존성이 없어 죽은 코드다([11-dark-mode.md](./11-dark-mode.md) §E-4).

---

## C. 권장 타이밍 스케일 (To-Be)

상호작용 유형별 권장 duration·easing·대상 속성.

| 상호작용 | Duration | Easing | 대상 속성 | Tailwind / 커스텀 |
|----------|----------|--------|-----------|-------------------|
| 행 hover | 100–150ms | ease-out | background-color | `transition-colors` / `.row-hover` |
| 버튼 hover | 150ms | ease-out | background-color, box-shadow | `transition-colors` |
| Input focus | 150ms | ease-out | color, box-shadow | `transition-[color,box-shadow]` |
| 액션 표시/숨김 | 150ms | ease-out | opacity | `transition-opacity` |
| 카드 hover 부유 (미연결) | 200ms | (기본) | transform, box-shadow, border | `.card-hover` ([B-3](#b-3-정의됨미사용-효과-제거-후보)) |
| Dropdown 열림 | 200ms | ease-out | opacity, transform | shadcn 기본 |
| Dropdown 닫힘 | 150ms | ease-in | opacity, transform | shadcn 기본 |
| 사이드바 토글 | 200ms | ease-in-out | transform | `transition-transform duration-200` |
| Modal 진입 | 200–300ms | ease-out | opacity, transform | shadcn `animate-in` |
| AI 챗 도크 등장 | 400ms | `cubic-bezier(0.16,1,0.3,1)` | opacity, transform | `animate-[chat-dock-expand…]` |
| 로고 펄스 (미연결) | 3s (무한) | ease-in-out | box-shadow | `logo-pulse` ([B-3](#b-3-정의됨미사용-효과-제거-후보)) |
| 로딩 스피너 | continuous | linear | transform(rotate) | `animate-spin` |
| 대기/펄스 | 1500ms (무한) | — | opacity | `animate-pulse` |

### 타이밍 원칙

- **빠른 반응** (100–150ms): hover, focus 등 즉각 피드백
- **자연스러운 전환** (200ms): 패널 열림/닫힘, 카드 부유, 컴포넌트 진입
- **명확한 변화** (300–400ms): 모달 진입, AI 챗 도크 등장처럼 큰 컨텍스트 변화
- **지속 애니메이션**: 스피너(continuous), 로고 펄스(3s 루프), 대기 펄스(1500ms 루프)

---

## D. GPU 가속 규칙

**애니메이션 권장 속성 (Compositor 레이어)**:
- `opacity` — 레이아웃/페인트 없음
- `transform` (translate, scale, rotate) — 레이아웃/페인트 없음

커스텀 키프레임은 이 규칙을 따른다: `chat-dock-expand`(translate+scale), `canvas-*`(translate+opacity), `logo-pulse`(box-shadow만 — 페인트지만 빈도 낮음).

**애니메이션 금지 속성 (Layout/Paint 유발)**:

| 속성 | 이유 |
|------|------|
| `width`, `height` | Layout 재계산 |
| `margin`, `padding` | Layout 재계산 |
| `top`, `left` | Layout 재계산 (`transform: translate` 사용) |
| `font-size` | Layout 재계산 |
| `background-color` | Paint (단, 색상 전환은 GPU 비용이 낮아 허용) |

```tsx
{/* 권장: transform 사용 */}
<div className="transition-transform duration-200 translate-x-0 data-[collapsed]:translate-x-full" />

{/* 비권장: top/left 애니메이션 */}
<div style={{ top: isOpen ? 0 : -100 }} />
```

---

## E. Reduced Motion (모션 감소)

`prefers-reduced-motion` 미디어 쿼리로 전정 장애 사용자를 위해 애니메이션을 억제한다.

> **현재 상태**: `index.css`에 전역 `prefers-reduced-motion` 규칙은 아직 없다. `logo-pulse`·`chat-dock-expand` 등 무한/진입 애니메이션이 많으므로, 아래 전역 규칙 추가를 권장한다(To-Be).

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

컴포넌트 단위로는 Tailwind `motion-reduce:` 유틸리티를 사용할 수 있다.

```tsx
<Loader2 className="animate-spin motion-reduce:animate-none" />
<div className="transition-all duration-200 motion-reduce:transition-none" />
```

접근성 전반은 [10-accessibility.md](./10-accessibility.md) 참조.

---

## F. 패턴 적용 요약

```tsx
// 이슈 목록 행 — hover 색상 전환
<TableRow className="row-hover transition-colors hover:bg-muted/50" />

// 버튼 내 스피너
<Button disabled={isPending}>
  {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
  저장
</Button>

// hover 시 액션 표시
<div className="group relative">
  <span>{content}</span>
  <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
    <ActionButtons />
  </div>
</div>

// 카드 부유 효과 — 정의됨·미연결(B-3). 적용 시 클래스만 부여하면 됨
<Card className="card-hover" />

// AI 챗 도크 진입
<div className="origin-top animate-[chat-dock-expand_0.4s_cubic-bezier(0.16,1,0.3,1)]" />
```
