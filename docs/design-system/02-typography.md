# 02. Typography

Smart Workplace 타이포그래피 시스템 — As-Is 감사 결과와 To-Be 권장 스케일.

> 관련 문서: [01-design-tokens.md](01-design-tokens.md) · [03-spacing-layout.md](03-spacing-layout.md)

---

## 1. 현재(As-Is) 감사

`apps/workplace-web/src` 를 스캔하여 실제 사용 중인 타이포그래피 패턴을 정리했다. 빈도는 클래스 출현 횟수 기준(근사치).

| Level | Tailwind Classes | Size | Weight | 용도 | 빈도 |
|-------|-----------------|------|--------|------|------|
| Page / Section Title | `text-2xl font-semibold` | 24px | 600 | 페이지·섹션 제목 (프로젝트 상세, 이슈 상세, 설정 등) | ~10 곳 |
| Dialog / Card Title | `text-lg font-semibold` | 18px | 600 | Dialog/Sheet 제목, 카드 헤더 (shadcn 기본값) | ~15 곳 |
| Sidebar App Title | `text-[15px] font-bold tracking-tight` | 15px | 700 | 2차 사이드바 상단 앱 타이틀(`appTitleTextClass`), 홈 상단 워드마크 | 공유 토큰 |
| Section / Card Sub-head | `text-base font-medium` | 16px | 500 | 카드 내부 소제목, 빈 상태 제목 | ~5 곳 |
| Body / Label | `text-sm` | 14px | 400 | **일반 본문, 폼 레이블, 모듈 사이드바 nav 항목** | ~270 곳 |
| Label (medium) | `text-sm font-medium` | 14px | 500 | 카드 제목, 활성 nav 항목, 버튼 텍스트 | ~110 곳 |
| App-Rail Nav | `text-[13px] font-medium` | 13px | 500 | 앱 레일(56px) 링크 라벨 | AppRail |
| Caption | `text-xs` | 12px | 400 | 배지, 메타데이터, 타임스탬프, 그룹 라벨 | ~155 곳 |
| Group Label | `text-xs font-semibold uppercase tracking-wider` | 12px | 600 | 사이드바 섹션 그룹 라벨("메일 계정" 등) | ~6 곳 |
| Tiny | `text-[10px]` / `text-[11px]` | 10–11px | 400–600 | 인박스 배지, AI 칩, 상대 시각 등 | 19 + 4 곳 |

### 현재 문제점

- **충돌하는 의미**: 페이지 제목과 섹션 제목이 모두 `text-2xl font-semibold` 를 공유한다. 의미 계층(H1/H2)이 시각적으로 구분되지 않는다.
- **누락된 단계**: `text-xl`(20px)은 거의 미사용(2곳), `text-3xl` 이상은 완전히 미사용. 가장 큰 실사용 크기가 `text-2xl`(24px)이라 페이지 진입점의 시각적 강조가 약하다.
- **비일관적인 line-height**: `leading-*` 클래스를 대부분 생략하여 브라우저 기본값에 의존한다.
- **`text-[10px]`/`text-[11px]` 매직 넘버**: 합산 23곳으로, 디자인 토큰 범위 밖의 부채다. 접근성 최소 크기(12px) 미만 텍스트가 산재한다.
- **두 종류의 nav 크기 혼재**: 앱 레일은 `text-[13px]`, 모듈 2차 사이드바는 `text-sm`(14px). 의도된 차이지만(레일=아이콘 보조 라벨, 사이드바=텍스트 네비), 문서화되지 않으면 혼동을 부른다.
- **`tabular-nums` 미사용**: `index.css` 에 유틸리티가 정의돼 있으나 실제 숫자 데이터에 적용된 곳이 없다.

---

## 2. 권장(To-Be) 타이포그래피 스케일

Vercel Geist 3-tier 시스템(Heading / Body / Label)을 참고하여 의미론적 레벨을 정의한다. 워크플레이스의 실사용 최대 크기가 24px(`text-2xl`)이므로, 그보다 큰 단계는 **신규 제안(net-new)** 으로 명시한다.

### 2.1 전체 스케일

| Semantic Name | 용도 | Tailwind Classes | Size | Line-Height | Weight | Tracking |
|---------------|------|-----------------|------|-------------|--------|----------|
| `heading-page` ⭐신규 | 페이지 타이틀 (H1) | `text-[28px] leading-9 font-semibold tracking-tight` | 28px | 36px | 600 | -0.025em |
| `heading-section` | 섹션 제목 (H2) — 현 페이지 제목 | `text-2xl leading-8 font-semibold tracking-tight` | 24px | 32px | 600 | -0.025em |
| `heading-card` | 카드/다이얼로그 제목 (H3) | `text-lg leading-7 font-semibold` | 18px | 28px | 600 | normal |
| `heading-app-title` | 사이드바/홈 앱 타이틀 | `text-[15px] leading-5 font-bold tracking-tight` | 15px | 20px | 700 | -0.025em |
| `heading-group` | 폼/설정 그룹 헤딩 (H4) | `text-base leading-6 font-medium` | 16px | 24px | 500 | normal |
| `heading-column` | 테이블 컬럼 헤더 | `text-sm leading-5 font-semibold` | 14px | 20px | 600 | normal |
| `body-primary` | 주요 본문 텍스트 | `text-base leading-7` | 16px | 28px | 400 | normal |
| `body-secondary` | 보조 본문, 카드 설명, 메시지 본문 | `text-sm leading-6` | 14px | 24px | 400 | normal |
| `caption` | 캡션, 힌트, 타임스탬프 | `text-xs leading-4` | 12px | 16px | 400 | normal |
| `label-primary` | 폼 레이블, nav 항목, 버튼 | `text-sm leading-5 font-medium` | 14px | 20px | 500 | normal |
| `label-rail` | 앱 레일 아이콘 라벨 | `text-[13px] leading-5 font-medium` | 13px | 20px | 500 | normal |
| `label-group` | 사이드바 섹션 그룹 라벨 | `text-xs leading-4 font-semibold uppercase tracking-wider` | 12px | 16px | 600 | +0.05em |
| `label-secondary` | 배지, 태그, 상태 칩 | `text-xs leading-4 font-medium` | 12px | 16px | 500 | normal |
| `code-inline` | 인라인 코드, 키, 식별자 | `text-sm font-mono` | 14px | - | 400 | normal |
| `code-block` | 코드 블록 | `text-[13px] leading-5 font-mono` | 13px | 20px | 400 | normal |
| `data-number` | 데이터 테이블 숫자 | `text-sm font-mono tabular-nums` | 14px | - | 400 | normal |

⭐ `heading-page`(28px)는 현재 코드에 없는 신규 제안이다. 도입 전까지는 `heading-section`(24px)을 페이지 H1 로 사용한다.

### 2.2 Heading 계층

`heading-page`부터 `heading-column`까지. 반드시 의미론적 HTML 요소(`h1`–`h4`, `th`)와 함께 사용한다. 시각적 스타일과 HTML 계층이 일치해야 스크린 리더 접근성이 보장된다.

```tsx
// heading-page (신규 제안) — 페이지 진입점, 페이지당 1개만
<h1 className="text-[28px] leading-9 font-semibold tracking-tight">
  내 작업
</h1>

// heading-section — 현재 페이지 제목 표준. 페이지 내 주요 섹션 구분에도 사용
<h2 className="text-2xl leading-8 font-semibold tracking-tight">
  프로젝트 설정
</h2>

// heading-card — 카드, 다이얼로그, 시트 제목
<h3 className="text-lg leading-7 font-semibold">
  이슈 생성
</h3>

// heading-group — 폼 섹션, 설정 그룹 라벨
<h4 className="text-base leading-6 font-medium">
  알림 설정
</h4>

// heading-column — 칸반/이슈 테이블 컬럼 헤더
<th className="text-sm leading-5 font-semibold text-muted-foreground">
  담당자
</th>
```

### 2.3 Body 계층

본문 텍스트. `body-primary`는 이슈 설명·메일 본문 같은 긴 콘텐츠에, `body-secondary`는 카드 내 설명이나 채팅 메시지 본문에 사용한다.

```tsx
// body-primary — 이슈 설명, 메일 본문, 노트 콘텐츠
<p className="text-base leading-7 text-foreground">
  이 이슈는 메일 동기화 성능을 개선합니다. 목록 우선 적재 후
  본문은 OnDemand 로 가져옵니다.
</p>

// body-secondary — 카드 설명, 채팅 메시지, 보조 정보
<p className="text-sm leading-6 text-muted-foreground">
  마지막 활동: 2시간 전
</p>

// caption — 힌트, 타임스탬프, 부가 메타데이터
<span className="text-xs leading-4 text-muted-foreground">
  2026-06-06 14:32
</span>
```

### 2.4 Label 계층

UI 컨트롤에 붙는 레이블. 본문 텍스트와 달리 수직 정렬이 중요하므로 `leading-5`(20px) 고정을 기본으로 한다. 워크플레이스에는 nav 라벨이 **세 종류**(앱 레일 13px · 모듈 사이드바 14px · 그룹 라벨 12px uppercase)로 분화되어 있다.

```tsx
// label-primary — 폼 레이블, 모듈 사이드바 nav 항목, 버튼 텍스트
<label className="text-sm leading-5 font-medium">
  표시 이름
</label>

// label-rail — 앱 레일(56px) 아이콘 라벨 (데스크톱은 Tooltip, 모바일 드로어는 인라인)
<span className="text-[13px] leading-5 font-medium">대화</span>

// label-group — 사이드바 섹션 그룹 라벨
<p className="text-xs leading-4 font-semibold uppercase tracking-wider text-muted-foreground">
  메일 계정
</p>

// label-secondary — 배지, 태그, 상태 칩, AI 칩
<span className="text-xs leading-4 font-medium px-2 py-0.5 rounded-full bg-muted">
  In Progress
</span>
```

### 2.5 Code / Data 계층

코드와 숫자 데이터 전용. `font-mono`를 반드시 명시하여 가변폭 폰트와 구분한다.

```tsx
// code-inline — 이슈 키, 식별자, 인라인 코드
<code className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded">
  WP-142
</code>

// code-block — 코드 블록, 로그 뷰어
<div className="text-[13px] leading-5 font-mono">
  {/* code content */}
</div>

// data-number — 통계/테이블 내 숫자 (이슈 수, 안읽음 수, 파일 크기)
<td className="text-sm font-mono tabular-nums text-right">
  1,234
</td>
```

---

## 3. As-Is → To-Be 마이그레이션 매핑

| As-Is 클래스 조합 | 용도 | To-Be Semantic Name | To-Be 클래스 조합 |
|-----------------|------|---------------------|-----------------|
| `text-2xl font-semibold` | 페이지 제목 | `heading-section` (또는 `heading-page` ⭐) | `text-2xl leading-8 font-semibold tracking-tight` |
| `text-lg font-semibold` | Dialog/Card 제목 | `heading-card` | `text-lg leading-7 font-semibold` |
| `text-[15px] font-bold tracking-tight` | 사이드바/홈 앱 타이틀 | `heading-app-title` | 동일 (`text-[15px] leading-5 font-bold tracking-tight`) |
| `text-base font-medium` | 카드 소제목, 빈 상태 | `heading-group` | `text-base leading-6 font-medium` |
| `text-sm font-medium` | 카드 제목, 활성 nav | `label-primary` | `text-sm leading-5 font-medium` |
| `text-sm` | 일반 본문 / 폼 레이블 / 사이드바 nav | `body-secondary` / `label-primary` | 문맥에 따라 분기 |
| `text-[13px] font-medium` | 앱 레일 nav | `label-rail` | `text-[13px] leading-5 font-medium` |
| `text-xs font-semibold uppercase tracking-wider` | 그룹 라벨 | `label-group` | 동일 |
| `text-xs` | 배지, 메타데이터 | `caption` / `label-secondary` | 문맥에 따라 분기 |
| `text-[10px]` / `text-[11px]` | 인박스 배지, AI 칩 | `label-secondary` | `text-xs leading-4 font-medium` |

> **마이그레이션 우선순위**: `text-[10px]`/`text-[11px]` 제거(23곳, 접근성 부채) → 페이지 H1/섹션 H2 의미 분리 → 나머지 점진적 적용.

---

## 4. font-mono 사용 규칙

`font-mono`는 아래 컨텍스트에서만 사용한다. 그 외 일반 UI 텍스트에는 절대 사용하지 않는다. (현재 코드에서 `font-mono` 출현은 12곳.)

| 컨텍스트 | Semantic Name | 예시 |
|---------|---------------|------|
| 이슈 키, 식별자 | `code-inline` | `WP-142` |
| API 키, 토큰 | `code-inline` | `sk-ant-...` |
| 코드 블록, 로그 | `code-block` | 에디터/로그 영역 |
| 숫자 데이터 (테이블) | `data-number` | `1,234` |

---

## 5. Letter-Spacing 규칙

워크플레이스는 두 곳에서 tracking 을 의도적으로 사용한다: 큰 제목의 `tracking-tight`, 작은 uppercase 그룹 라벨의 `tracking-wider`.

| 조건 | Tracking | 이유 |
|------|----------|------|
| `heading-section`(24px) 이상, `heading-app-title` | `tracking-tight` (-0.025em) | 큰/굵은 글자는 자간이 넓어 보여 타이트하게 보정 |
| `heading-card`(18px) ~ 일반 본문/라벨 | normal | 작은 크기에서 tight tracking 은 가독성 저하 |
| `label-group` (12px **uppercase**) | `tracking-wider` (+0.05em) | 대문자 소형 라벨은 자간을 넓혀야 글자 구분이 명확 |
| 임의 tracking 매직 넘버 (`tracking-[...]`) | 금지 | 디자인 토큰 범위 밖 |

> uppercase 가 아닌 소형 텍스트에 `tracking-wider` 를 쓰지 않는다. 대문자 그룹 라벨에만 한정한다.

---

## 6. Font Family

### 6.1 현재(As-Is)

**Inter** 를 `@fontsource/inter` 로 self-host 한다. `apps/workplace-web/src/main.tsx` 가 weight 400/500/600/700 을 직접 import 하고, `index.css` 의 `@theme inline` 에서 `--font-sans` 토큰으로 연결한다.

```ts
// apps/workplace-web/src/main.tsx
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
```

```css
/* apps/workplace-web/src/index.css — @theme inline */
--font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
```

`font-mono`는 **별도 토큰을 정의하지 않으므로** Tailwind v4 기본 mono 스택을 그대로 사용한다.

```css
font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
  "Liberation Mono", "Courier New", monospace;
```

### 6.2 권장(To-Be)

- **Sans**: Inter 유지. weight 는 현재 import 된 400/500/600/700 범위 내에서만 사용한다(800/900 신규 추가 금지).
- **Mono**: 코드/숫자 표기가 늘어나면 `--font-mono` 전용 토큰 도입을 검토한다(예: Geist Mono, JetBrains Mono). 도입 시 `@theme inline` 에 `--font-mono` 를 추가하고 `@fontsource` 로 self-host 한다.

> **현재 액션**: Sans=Inter, Mono=시스템 기본 유지. Mono 전용 폰트는 코드 표면이 늘어날 때 사용자와 협의해 도입한다.

---

## 7. 접근성 가이드라인

- **최소 폰트 크기**: 본문 텍스트는 12px(`text-xs`) 이상. `text-[10px]`/`text-[11px]` 사용 금지(현재 23곳 → To-Be 에서 제거).
- **색상 대비**: `text-muted-foreground`는 배경 대비 WCAG AA(4.5:1) 이상을 유지해야 한다. 12px 이하 텍스트는 AAA(7:1) 권장.
- **line-height**: 본문(`body-primary`, `body-secondary`)은 font-size 대비 1.5배 이상(`leading-6` 이상) 유지.
- **HTML 의미론**: 시각적 스타일이 아닌 문서 구조에 따라 `h1`–`h6` 계층을 결정한다. 스타일은 CSS로 분리.

---

## 8. Tailwind CSS v4 참고 사항

현재 프로젝트는 Tailwind CSS v4를 사용한다(`@import "tailwindcss"`). v4에서 달라진 점:

- `text-[28px]`, `text-[13px]` 같은 arbitrary value 그대로 지원.
- `leading-9`, `leading-[36px]` 모두 지원.
- `tabular-nums`는 `index.css` 에 `font-variant-numeric: tabular-nums` 로 정의되어 있다(아직 미사용 — `data-number` 도입 시 활용).
- `tracking-tight` = `-0.025em`, `tracking-wider` = `+0.05em`.

```tsx
// v4에서 data-number 사용 예
<td className="text-sm font-mono tabular-nums text-right">
  1,234
</td>
```
