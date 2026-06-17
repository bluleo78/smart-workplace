# Design Tokens — Smart Workplace

> **범위**: `apps/workplace-web` 프론트엔드 디자인 시스템의 토큰 정의, 현황, 권장 방향을 다룬다.
> **기준 파일**: `apps/workplace-web/src/index.css`, shadcn/ui 컴포넌트 라이브러리
> **스택**: React 19 · Tailwind v4 (CSS `@theme inline`, `tailwind.config.js` 없음) · shadcn/ui · next-themes

---

## 목차

1. [Color Tokens — 색상 토큰](#1-color-tokens--색상-토큰)
   - 1-1. Light Theme (`:root`)
   - 1-2. Dark Theme (`.dark`)
   - 1-3. 디자인 철학: 인디고 브랜드 팔레트
   - 1-4. Semantic Status Tokens (success / warning / info)
   - 1-5. Domain & Accent Tokens (sparkline · AI · caution)
   - 1-6. 정의됨·미사용 토큰 (chart / dtype)
2. [컬러 테마 변형 — Ocean / Sunset](#2-컬러-테마-변형--ocean--sunset)
3. [Border Radius Scale — 모서리 반경 스케일](#3-border-radius-scale--모서리-반경-스케일)
4. [Z-Index Scale — 레이어 순서 스케일](#4-z-index-scale--레이어-순서-스케일)
5. [Shadow Usage — 그림자 사용 패턴](#5-shadow-usage--그림자-사용-패턴)
6. [Tailwind v4 매핑 (`@theme inline`)](#6-tailwind-v4-매핑-theme-inline)

---

## 1. Color Tokens — 색상 토큰

Smart Workplace의 색상 시스템은 CSS 커스텀 프로퍼티(CSS Custom Properties)로 정의되며, 모든 색상은 [OKLch](https://oklch.com/) 색공간을 사용한다. OKLch는 인지적으로 균일한(perceptually uniform) 색공간으로, 명도(L), 채도(C), 색상각(h) 세 축으로 색상을 표현한다.

토큰은 `:root`(라이트)와 `.dark`(다크)에 light/dark 값 쌍으로 정의되고, `@theme inline` 블록에서 `--color-*` 형태의 Tailwind 유틸리티 토큰으로 매핑된다([섹션 6](#6-tailwind-v4-매핑-theme-inline) 참조).

### 1-1. Light Theme (`:root`)

라이트 모드의 기본 색상 토큰이다. `:root` 선택자에 정의되며 기본값으로 적용된다.

#### Core UI Tokens

| Token | OKLch 값 | 근사 색상 | 용도 |
|-------|----------|-----------|------|
| `--background` | `oklch(0.985 0.002 264)` | 거의 흰색(미세한 한색 기운) | 페이지 전체 배경 |
| `--foreground` | `oklch(0.145 0 0)` | Near-black | 기본 본문 텍스트 |
| `--card` | `oklch(1 0 0)` | 흰색 | 카드 컴포넌트 배경 |
| `--card-foreground` | `oklch(0.145 0 0)` | Near-black | 카드 내 텍스트 |
| `--popover` | `oklch(1 0 0)` | 흰색 | 팝오버, 드롭다운 배경 |
| `--popover-foreground` | `oklch(0.145 0 0)` | Near-black | 팝오버 내 텍스트 |

> `--background`는 순수 무채색이 아니라 `oklch(0.985 0.002 264)` — 인디고(h=264) 기운을 아주 미세하게 띤다. UI 전반의 한색 톤을 통일하기 위한 의도적 설정이다.

#### Brand & Interaction Tokens

| Token | OKLch 값 | 근사 색상 | 용도 |
|-------|----------|-----------|------|
| `--primary` | `oklch(0.45 0.2 264)` | 인디고/블루 | 기본 브랜드 색상, CTA 버튼 배경 |
| `--primary-foreground` | `oklch(0.985 0 0)` | Near-white | Primary 위 텍스트 |
| `--secondary` | `oklch(0.965 0.005 264)` | 연한 한색 회색 | 보조 버튼, 보조 배경 |
| `--secondary-foreground` | `oklch(0.25 0 0)` | 어두운 회색 | Secondary 위 텍스트 |
| `--muted` | `oklch(0.965 0.005 264)` | 연한 한색 회색 | 음소거 배경, 비활성 영역 |
| `--muted-foreground` | `oklch(0.5 0 0)` | 중간 회색 | 플레이스홀더, 부가 설명 텍스트 |
| `--accent` | `oklch(0.955 0.01 264)` | 연한 한색 회색 | hover·active 상태 배경 |
| `--accent-foreground` | `oklch(0.25 0 0)` | 어두운 회색 | Accent 위 텍스트 |
| `--destructive` | `oklch(0.577 0.245 27.325)` | 빨간색 | 위험·삭제 액션, 에러 상태 |

#### Structural Tokens

| Token | OKLch 값 | 근사 색상 | 용도 |
|-------|----------|-----------|------|
| `--border` | `oklch(0.94 0.005 264)` | 연한 한색 회색 | 일반 테두리 |
| `--input` | `oklch(0.92 0.005 264)` | 연한 한색 회색 | Input 컴포넌트 테두리 |
| `--ring` | `oklch(0.55 0.15 264)` | 인디고 (유색) | 키보드 Focus ring |

> `--ring`이 무채색이 아닌 인디고 계열인 점에 주목한다. Focus ring이 브랜드 색과 일치하여 키보드 포커스가 명확하게 드러난다.

#### Sidebar Tokens

| Token | OKLch 값 | 근사 색상 | 용도 |
|-------|----------|-----------|------|
| `--sidebar` | `oklch(1 0 0)` | 흰색 | 사이드바 배경 |
| `--sidebar-foreground` | `oklch(0.145 0 0)` | Near-black | 사이드바 텍스트 |
| `--sidebar-primary` | `oklch(0.45 0.2 264)` | 인디고 | 사이드바 선택 항목 배경 |
| `--sidebar-primary-foreground` | `oklch(0.985 0 0)` | Near-white | 사이드바 선택 항목 텍스트 |
| `--sidebar-accent` | `oklch(0.955 0.015 264)` | 연한 한색 회색 | 사이드바 hover 배경 |
| `--sidebar-accent-foreground` | `oklch(0.25 0 0)` | 어두운 회색 | 사이드바 hover 텍스트 |
| `--sidebar-border` | `oklch(0.94 0.005 264)` | 연한 한색 회색 | 사이드바 테두리 |
| `--sidebar-ring` | `oklch(0.55 0.15 264)` | 인디고 | 사이드바 focus ring |

---

### 1-2. Dark Theme (`.dark`)

`.dark` 클래스가 `<html>` 최상위 엘리먼트에 적용될 때 오버라이드되는 토큰이다. 다크 표면 모델·알파 오버레이 등 상세는 [11-dark-mode.md](./11-dark-mode.md)를 참조한다.

#### Core UI Tokens (Dark)

| Token | OKLch 값 | 근사 색상 |
|-------|----------|-----------|
| `--background` | `oklch(0.13 0.015 280)` | 한색(h=280)을 띤 매우 어두운 색 |
| `--foreground` | `oklch(0.93 0 0)` | Near-white |
| `--card` | `oklch(1 0 0 / 3%)` | 흰색 3% 알파 (반투명 표면) |
| `--card-foreground` | `oklch(0.93 0 0)` | Near-white |
| `--popover` | `oklch(0.18 0.015 280)` | 어두운 한색 회색 |
| `--popover-foreground` | `oklch(0.93 0 0)` | Near-white |

#### Brand & Interaction Tokens (Dark)

| Token | OKLch 값 | 근사 색상 |
|-------|----------|-----------|
| `--primary` | `oklch(0.65 0.2 264)` | 밝은 인디고 |
| `--primary-foreground` | `oklch(0.985 0 0)` | Near-white |
| `--secondary` | `oklch(1 0 0 / 5%)` | 흰색 5% 알파 |
| `--secondary-foreground` | `oklch(0.93 0 0)` | Near-white |
| `--muted` | `oklch(1 0 0 / 5%)` | 흰색 5% 알파 |
| `--muted-foreground` | `oklch(0.6 0 0)` | 중간 회색 |
| `--accent` | `oklch(1 0 0 / 7%)` | 흰색 7% 알파 |
| `--accent-foreground` | `oklch(0.93 0 0)` | Near-white |
| `--destructive` | `oklch(0.704 0.191 22.216)` | 밝은 빨간색 |

#### Structural Tokens (Dark)

| Token | OKLch 값 | 비고 |
|-------|----------|------|
| `--border` | `oklch(1 0 0 / 10%)` | 흰색 10% 알파 — 반투명 테두리 |
| `--input` | `oklch(1 0 0 / 12%)` | 흰색 12% 알파 — Input 테두리 |
| `--ring` | `oklch(0.65 0.2 264)` | 밝은 인디고 |

#### Sidebar Tokens (Dark)

| Token | OKLch 값 | 근사 색상 |
|-------|----------|-----------|
| `--sidebar` | `oklch(0.14 0.02 280)` | 한색 매우 어두운 색 |
| `--sidebar-foreground` | `oklch(0.93 0 0)` | Near-white |
| `--sidebar-primary` | `oklch(0.65 0.2 264)` | 밝은 인디고 |
| `--sidebar-primary-foreground` | `oklch(0.985 0 0)` | Near-white |
| `--sidebar-accent` | `oklch(1 0 0 / 7%)` | 흰색 7% 알파 |
| `--sidebar-accent-foreground` | `oklch(0.93 0 0)` | Near-white |
| `--sidebar-border` | `oklch(1 0 0 / 10%)` | 흰색 10% 알파 |
| `--sidebar-ring` | `oklch(0.65 0.2 264)` | 밝은 인디고 |

> 다크 모드의 표면(secondary/muted/accent/card)은 솔리드 회색이 아니라 **흰색 알파 오버레이**(`oklch(1 0 0 / N%)`)로 정의된다. 알파를 높일수록 고도(elevation)가 올라가는 모델이다. 자세한 설명은 [11-dark-mode.md](./11-dark-mode.md) "표면 고도 모델" 참조.

---

### 1-3. 디자인 철학: 인디고 브랜드 팔레트 (Indigo Brand Palette)

Smart Workplace의 색상 시스템은 **인디고(h≈264) 계열을 브랜드 축으로 삼는 유색(chromatic) 팔레트**이다.

핵심 관찰:

- `--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring`, `--chart-1`이 모두 인디고 계열(h=264, 채도 0.15~0.2)이다. UI 크롬 자체가 브랜드 색을 띤다.
- 배경·회색 계열(`--background`, `--secondary`, `--muted`, `--accent`, `--border`)조차 채도 `0.002~0.015 / h=264`로 **미세한 한색 기운**을 머금는다. 완전한 무채색이 아니다.
- 다크 모드 베이스는 h=280(살짝 더 보라 쪽)로 한색감을 강화한다.

**이 설계의 의도**:

- **브랜드 정체성**: AI Native 워크플레이스로서 인디고를 일관된 브랜드 시그니처로 사용한다.
- **포커스 가독성**: `--ring`이 유색이므로 키보드 포커스가 한눈에 드러난다.
- **테마 확장성**: 단일 hue 축(264) 구조 덕분에 hue만 바꾼 [Ocean(195)·Sunset(50) 테마](#2-컬러-테마-변형--ocean--sunset)를 쉽게 파생할 수 있다.
- **다크 일관성**: 한색 베이스(h=280)와 알파 오버레이 표면으로 라이트/다크 전환 시 톤 일관성을 유지한다.

색상이 보편 신호로 쓰이는 영역:

| 영역 | 색상 | 근거 |
|------|------|------|
| `--destructive` | 빨간색 (`h≈27`) | 위험·삭제 액션의 보편적 신호 색상 |
| `--success` / `--warning` / `--info` | 녹/황/청 | 시맨틱 상태 ([1-4](#1-4-semantic-status-tokens-success--warning--info)) |
| `--ai-accent` | 보라 (`h≈293`) | AI 기능 강조 ([1-5](#1-5-domain--accent-tokens-sparkline--ai--caution)) |

---

### 1-4. Semantic Status Tokens (success / warning / info)

성공·경고·정보 상태를 표현하는 시맨틱 토큰. `index.css`에 Light/Dark 값이 모두 정의되어 있다. 각 상태는 `--{status}`(진한 색), `--{status}-foreground`(그 위 텍스트), `--{status}-subtle`(연한 배경) 세 토큰으로 구성된다.

#### 토큰 정의

| 토큰 | Light | Dark | 용도 |
|------|-------|------|------|
| `--success` | `oklch(0.523 0.165 149.5)` | `oklch(0.65 0.15 149.5)` | 녹색 — 완료/해결 상태 (예: 이슈 Done, 메일 전송 성공) |
| `--success-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0 0)` | Success 위 텍스트 |
| `--success-subtle` | `oklch(0.95 0.05 149.5)` | `oklch(0.2 0.04 149.5)` | 연한 녹색 배경 (성공 배너) |
| `--warning` | `oklch(0.84 0.16 84)` | `oklch(0.76 0.14 84)` | 앰버 — 주의 상태 |
| `--warning-foreground` | `oklch(0.2 0 0)` | `oklch(0.985 0 0)` | Warning 위 텍스트 |
| `--warning-subtle` | `oklch(0.97 0.04 84)` | `oklch(0.2 0.04 84)` | 연한 황색 배경 |
| `--info` | `oklch(0.55 0.15 240)` | `oklch(0.7 0.13 240)` | 청색 — 정보/진행 상태 (예: 동기화 중) |
| `--info-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0 0)` | Info 위 텍스트 |
| `--info-subtle` | `oklch(0.95 0.04 240)` | `oklch(0.2 0.04 240)` | 연한 청색 배경 |

#### 사용 패턴

| 토큰 패턴 | 역할 | 사용 예 |
|-----------|------|---------|
| `--{status}` | 진한 상태 색상 (아이콘, 배지 배경) | `bg-success text-success-foreground` |
| `--{status}-foreground` | 상태 배경 위 텍스트 | `<Badge variant="success">` |
| `--{status}-subtle` | 연한 상태 배경 (알림 박스, 배너) | `bg-success-subtle text-success` |

```tsx
{/* 이슈 상태 배지 */}
<Badge className="bg-success-subtle text-success">완료</Badge>

{/* 메일 동기화 진행 안내 */}
<div className="bg-info-subtle text-info border border-info/20">동기화 중…</div>
```

이들 토큰은 `@theme inline`에서 `--color-success`, `--color-warning`, `--color-info`(및 `-foreground`·`-subtle`)로 매핑되어 `bg-success`, `text-warning`, `border-info-subtle` 등의 유틸리티로 쓸 수 있다.

---

### 1-5. Domain & Accent Tokens (sparkline · AI · caution)

도메인 시각화와 AI 기능 강조를 위한 토큰. 모두 Light/Dark 쌍으로 정의되어 있다.

#### AI Accent Tokens

AI 관련 UI(홈 캔버스 위젯, 플로팅 챗, 세션 스위처, AI 상태 칩 등)에 사용하는 보라색 계열 토큰. **실제 사용 중** — `src/components/home/`의 위젯·챗 컴포넌트에서 활용된다.

| Token | Light | Dark | 용도 |
|-------|-------|------|------|
| `--ai-accent` | `oklch(0.52 0.18 293)` | `oklch(0.72 0.15 293)` | AI 기능 강조 색상 (보라) |
| `--ai-accent-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0 0)` | AI accent 위 텍스트 |
| `--ai-accent-subtle` | `oklch(0.96 0.03 293)` | `oklch(0.2 0.04 293)` | AI 기능 연한 배경 |

```tsx
{/* AI 위젯 헤더 (홈 캔버스) */}
<div className="bg-ai-accent-subtle text-ai-accent border border-ai-accent/20">
  AI 추천 작업
</div>
```

#### Sparkline / Domain Tokens

소형 추세 시각화(`src/components/ui/sparkline.tsx`, 커스텀 SVG/div 막대)에서 막대 색상으로 사용한다. 차트 라이브러리는 도입되어 있지 않다.

| Token | Light | Dark | 용도 |
|-------|-------|------|------|
| `--pipeline` | `oklch(0.52 0.14 195)` | `oklch(0.75 0.12 195)` | sparkline `pipeline` 변형 막대 |
| `--pipeline-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0 0)` | Pipeline 위 텍스트 |
| `--dataset` | `oklch(0.45 0.2 264)` | `oklch(0.7 0.17 264)` | (정의됨, 현재 미사용 — `--primary`와 동일 hue) |
| `--dataset-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0 0)` | Dataset 위 텍스트 |
| `--dashboard-accent` | `oklch(0.48 0.2 300)` | `oklch(0.7 0.18 300)` | sparkline `dashboard` 변형 막대 |
| `--dashboard-accent-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0 0)` | Dashboard accent 위 텍스트 |

> **명명 유의**: `pipeline`/`dataset`/`dashboard-accent`는 sibling 프로젝트에서 물려받은 이름이다. Workplace에는 파이프라인/데이터셋 도메인이 없으며, 현재는 sparkline의 색상 변형(`pipeline` / `dataset`(=primary) / `dashboard`) 식별자로만 쓰인다. sparkline의 기본 변형은 `dataset`인데 실제로는 `--primary`를 사용하므로, `--dataset` 토큰 자체는 직접 참조되지 않는다.

#### Caution Tokens

orange 계열 주의 색상. warning(amber)보다 강한 주의를 표현하기 위한 토큰으로 **정의되어 있으나 현재 컴포넌트에서 직접 사용되는 곳은 없다**(예약).

| Token | Light | Dark |
|-------|-------|------|
| `--caution` | `oklch(0.7 0.15 55)` | `oklch(0.78 0.13 55)` |
| `--caution-foreground` | `oklch(0.2 0 0)` | `oklch(0.985 0 0)` |
| `--caution-subtle` | `oklch(0.96 0.04 55)` | `oklch(0.2 0.04 55)` |

---

### 1-6. 정의됨·미사용 토큰 (chart / dtype)

아래 토큰은 `index.css`에 정의되어 있고 `@theme inline`에 매핑되어 있으나, **현재 어떤 컴포넌트에서도 참조되지 않는다.** sibling 프로젝트의 데이터/시각화 기능에서 물려받은 토큰으로, Workplace에는 해당 기능(차트 라이브러리, 스키마 탐색기)이 없다.

#### Chart Tokens — 정의됨, 차트 라이브러리 미도입 → 미사용

| Token | Light | Dark |
|-------|-------|------|
| `--chart-1` | `oklch(0.45 0.2 264)` | `oklch(0.65 0.2 264)` |
| `--chart-2` | `oklch(0.55 0.15 195)` | `oklch(0.7 0.15 195)` |
| `--chart-3` | `oklch(0.5 0.18 300)` | `oklch(0.65 0.2 300)` |
| `--chart-4` | `oklch(0.7 0.15 84)` | `oklch(0.75 0.15 84)` |
| `--chart-5` | `oklch(0.6 0.2 27)` | `oklch(0.7 0.2 27)` |

> recharts/nivo 등 차트 라이브러리는 의존성에 없으며, sparkline(커스텀 SVG)도 `--chart-*`가 아니라 `--primary`/`--pipeline`/`--dashboard-accent`를 사용한다. 따라서 `--chart-1..5`는 현재 죽은 토큰이다. 향후 차트 도입 시 활용하거나, 불필요하면 제거를 검토할 수 있다.

#### Data Type Tokens (`--dtype-*`) — 정의됨, 미사용

`--dtype-text`, `--dtype-number`, `--dtype-date`, `--dtype-boolean`, `--dtype-json`, `--dtype-geometry`, `--dtype-uuid` 7종이 정의되어 있으나(SQL 데이터 타입 구분용), Workplace에는 스키마 탐색기가 없어 참조되지 않는다. **제거 후보**다.

---

### 1-7. Categorical Palette — 식별색 (승인된 예외)

라벨·아바타·프로젝트 등 **서로 구분되어야 하는 식별(categorical) 색**은 시맨틱 토큰 체계로 표현할 수 없다(`bg-primary` 같은 단일 시맨틱 토큰은 "구분"이 아니라 "역할"을 나타내므로). 이 영역에 한해 **Tailwind 기본 팔레트(`bg-red-200 dark:bg-red-900` 등) 사용을 명시적으로 허용**한다. 그 외 컴포넌트의 hex/임의 색/팔레트색 금지 원칙은 그대로 유효하다.

| 사용처 | 파일 | 방식 |
|--------|------|------|
| 이슈/프로젝트 라벨 색 | `src/lib/labelColors.ts` | `ColorToken`(사용자 선택값, 백엔드 저장) → Tailwind 팔레트 정적 매핑(`bg`/`text`/`dot`, light+dark) |
| 사용자 아바타 배경색 | `src/lib/avatarColor.ts` | **단일 출처**. `userId` 해시 → 9색 팔레트(`-500 text-white`). `ChatAvatar`·`UserAvatar` 가 공통 사용 |
| 프로젝트 컬러 사각형 | `src/lib/project-color.ts` | key 해시 → `hsl(hue 60% 45%)`(고정 채도/명도, 흰 텍스트) |

**설계 원칙**:

- **테마 무관 고정**: 식별색은 식별 신호이므로 브랜드 테마(Indigo/Ocean/Sunset)나 다크 전환에 **반응하지 않는다**(고정). 따라서 `.theme-*`/`--primary` 에 묶지 않는다. 다크 대응이 필요한 곳(`labelColors`)은 `dark:` 변형으로 명시 처리한다.
- **단일 출처**: 아바타 색은 `avatarColor.ts` 한 곳에서만 정의한다(과거 `UserAvatar` 내 중복 팔레트는 제거됨, #DS-categorical).
- **정적 문자열 필수**: Tailwind purge 가 추출하도록 클래스는 인라인 리터럴로 둔다(동적 조립 금지).

> 즉 "컴포넌트엔 시맨틱 토큰만" 규칙의 **유일한 예외가 이 categorical 팔레트**다. 새 식별색이 필요하면 위 세 유틸 중 하나를 재사용하거나 같은 패턴(정적 팔레트 + 결정적 해시)으로 추가한다.

---

## 2. 컬러 테마 변형 — Ocean / Sunset

`index.css`에는 인디고 기본 테마 외에 hue만 바꾼 두 가지 컬러 테마가 정의되어 있다. 최상위 엘리먼트에 `.theme-ocean` 또는 `.theme-sunset` 클래스를 부여하면 `--primary`, `--ring`, `--sidebar-primary`, `--chart-1`, `--accent`가 해당 hue로 오버라이드된다. `.dark`와 조합 가능(`.theme-ocean.dark`).

| 테마 | hue | Light `--primary` | Dark `--primary` |
|------|-----|-------------------|------------------|
| 기본(Indigo) | 264 | `oklch(0.45 0.2 264)` | `oklch(0.65 0.2 264)` |
| `.theme-ocean` | 195 (틸/시안) | `oklch(0.52 0.14 195)` | `oklch(0.75 0.12 195)` |
| `.theme-sunset` | 50 (오렌지) | `oklch(0.55 0.18 50)` | `oklch(0.72 0.15 50)` |

각 테마는 `.bg-gradient-main` 배경 그라데이션과 `logo-pulse` 애니메이션의 색상도 함께 오버라이드한다([08-animation-motion.md](./08-animation-motion.md) 참조).

> **현재 상태**: 테마 변형 CSS는 완비되어 있으나, `.theme-ocean`/`.theme-sunset` 클래스를 실제로 토글하는 스위처 UI는 아직 연결되어 있지 않다(정의됨·미연결). next-themes는 light/dark/system 전환만 담당한다.

---

## 3. Border Radius Scale — 모서리 반경 스케일

기준 반경은 `--radius: 0.625rem` (약 10px)이며, `@theme inline` 블록에서 7개 레벨의 파생 토큰이 정의된다.

| Token | 계산식 | 근사값 (px) | 주요 사용처 |
|-------|--------|------------|-------------|
| `--radius-sm` | `calc(var(--radius) - 4px)` | ≈ 6px | Badge, 소형 chip, 라벨 태그 |
| `--radius-md` | `calc(var(--radius) - 2px)` | ≈ 8px | Input, Button |
| `--radius-lg` | `var(--radius)` | = 10px | 카드 기본, 일반 컨테이너 |
| `--radius-xl` | `calc(var(--radius) + 4px)` | ≈ 14px | Card 컴포넌트, Dialog, 챗 도크 패널 |
| `--radius-2xl` | `calc(var(--radius) + 8px)` | ≈ 18px | 대형 컨테이너, 모달 |
| `--radius-3xl` | `calc(var(--radius) + 12px)` | ≈ 22px | 현재 미사용 (예약) |
| `--radius-4xl` | `calc(var(--radius) + 16px)` | ≈ 26px | 현재 미사용 (예약) |

**설계 특징**:

- 모든 레벨이 `--radius` 단일 변수에서 파생되므로, `--radius` 하나만 바꿔도 전체 시스템의 둥글기가 일괄 조정된다.
- shadcn/ui의 `rounded-sm`/`-md`/`-lg`/`-xl` 유틸리티가 이 토큰을 참조한다.
- `--radius-3xl`, `--radius-4xl`은 정의만 되어 있고 현재 사용처가 없다.

---

## 4. Z-Index Scale — 레이어 순서 스케일

CSS 커스텀 프로퍼티로 정의된 z-index 스케일은 없다. Tailwind 유틸리티 클래스를 직접 사용하며, 코드베이스에서 관찰되는 암묵적 계층은 다음과 같다.

| 계층(비공식) | Tailwind | z-index | 용도 (관찰된 사용 빈도) |
|--------------|----------|---------|--------------------------|
| content | `z-10` | 10 | 스티키 테이블 헤더, 위젯 오버레이 등 (1) |
| header | `z-30` | 30 | 앱 헤더 (1) |
| overlay | `z-40` | 40 | 모바일 사이드바 배경 오버레이 (1) |
| modal | `z-50` | 50 | 사이드바, Dialog, Popover, Tooltip, Select, Dropdown, 플로팅 챗 등 (다수) |
| above-modal | `z-60` | 60 | modal 위에 떠야 하는 레이어 (2) |
| top | `z-70` | 70 | 최상위 레이어 (1) |

**관찰 / 한계**:

- `z-50`에 사이드바·Dialog·Tooltip·Select·플로팅 챗 등이 혼재한다. 동시 렌더 시 DOM 순서에 의존해 레이어 충돌이 잠재한다.
- sibling 문서가 `z-50`에서 멈추는 것과 달리 Workplace는 `z-60`/`z-70`까지 사용한다 — modal 위에 떠야 하는 레이어가 필요한 케이스로 추정된다(의도는 미확인).
- CSS 변수로 명시 정의돼 있지 않아, 새 레이어드 컴포넌트 추가 시 어떤 값을 써야 할지 불명확하다.

**권장(To-Be)** — 명시적 스케일 토큰화 검토:

```css
:root {
  --z-content:  10;
  --z-header:   30;
  --z-overlay:  40;
  --z-sidebar:  50;
  --z-dialog:   60;
  --z-popover:  70;
  --z-tooltip:  80;
  --z-floating: 90;
}
```

---

## 5. Shadow Usage — 그림자 사용 패턴

그림자는 Tailwind 표준 shadow 유틸리티를 사용한다. CSS 변수로 정의된 shadow 토큰은 없다. 코드베이스에서 관찰되는 패턴:

| Shadow 클래스 | 대략적 사용 빈도 | 맥락 |
|--------------|------------------|------|
| `shadow-sm` | 3건 | 경미한 입체감, 평면 UI에서의 약한 분리 |
| `shadow-md` | 5건 | Popover/드롭다운 콘텐츠 레이어 분리 |
| `shadow-lg` | 4건 | Dialog/AlertDialog 모달 분리 |
| `shadow-xl` | 1건 | 일부 패널 |
| `shadow-2xl` | 2건 | 플로팅 챗 패널 등 강한 부유감 |

**관찰**:

- shadow 강도와 레이어 깊이(z-index)가 대략 상관한다 — 높은 레이어일수록 강한 shadow.
- 다크 모드에서는 그림자가 잘 보이지 않으므로, 알파 표면 고도 모델과 `.card-hover`/`.row-hover` 같은 커스텀 효과로 분리감을 보완한다([11-dark-mode.md](./11-dark-mode.md), [08-animation-motion.md](./08-animation-motion.md) 참조).

---

## 6. Tailwind v4 매핑 (`@theme inline`)

Workplace는 Tailwind v4를 사용하며 `tailwind.config.js`가 없다. 대신 `index.css` 최상단의 `@theme inline` 블록에서 모든 토큰을 `--color-*` 형태로 매핑하여 유틸리티 클래스를 생성한다.

```css
@theme inline {
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-success: var(--success);
  --color-success-subtle: var(--success-subtle);
  --color-ai-accent: var(--ai-accent);
  /* … 모든 토큰 동일 패턴 … */
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
}
```

이 매핑 덕분에 `bg-primary`, `text-success`, `border-ai-accent-subtle`, `bg-pipeline/20` 같은 유틸리티를 쓸 수 있다. **새 토큰을 추가할 때는 `:root`/`.dark`에 값을 정의하고, 반드시 `@theme inline`에도 `--color-*` 매핑을 추가**해야 유틸리티로 노출된다.

> 폰트는 `--font-sans`가 `Inter`를 우선한다. 타이포그래피 상세는 [02-typography.md](./02-typography.md) 참조.

---

## 변경 이력

| 날짜 | 버전 | 내용 |
|------|------|------|
| 2026-06-06 | v1.0 | 최초 작성 — Workplace `index.css` 기준 Color/테마변형/Radius/Z-Index/Shadow/Tailwind v4 매핑 토큰 정리 |
