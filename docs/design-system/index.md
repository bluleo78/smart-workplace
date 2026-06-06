# Smart Workplace — 디자인 시스템 가이드라인

> **버전**: 1.0.0
> **최종 검증**: 2026-06-06
> **참조 시스템**: [shadcn/ui](https://ui.shadcn.com) (new-york) — sibling `smart-fire-hub` 디자인 시스템에서 이식
> **대상 독자**: 개발자 + AI 에이전트 (Claude Code)
> **범위**: 가이드라인 + 코드 현황(As-Is) + 권장 패턴(To-Be). 잔여 작업은 [13-migration-backlog.md](./13-migration-backlog.md)

---

## 개요

이 디자인 시스템은 Smart Workplace 프론트엔드(`apps/workplace-web`)의 일관된 UI를 위한 단일 원본(Single Source of Truth)이다. 모든 규칙은 **구체적 Tailwind CSS 클래스**로 표현되어 개발자와 AI 에이전트가 즉시 적용할 수 있다.

토큰 정의·shadcn/ui 프리미티브(35개)는 sibling 프로젝트 `smart-fire-hub`와 거의 동일하게 미러링되어 있으나, **레이아웃·페이지 패턴은 워크플레이스 고유**(앱 레일 + 모듈별 2차 사이드바 + AI 챗 도크, 상단 GNB 없음)다. 이 문서는 fire-hub 문서를 베끼지 않고 **워크플레이스 실제 코드를 기준으로** 작성됐다.

### 표기 규칙

- **현재(As-Is)**: 코드베이스에서 실제 사용 중인 패턴
- **권장(To-Be)**: 통일·개선 목표 패턴 (잔여 작업은 13번 문서)
- 모든 색상값은 OKLch 색공간 사용 (`oklch(L C H)`)

### 기술 스택

| 영역 | 기술 |
|------|------|
| UI 프레임워크 | React 19 + TypeScript |
| 스타일링 | Tailwind CSS v4 (CSS 기반 설정, `@theme inline` — `tailwind.config.js` 없음) |
| 컴포넌트 라이브러리 | shadcn/ui (new-york style) + Radix |
| 테마 | next-themes (dark/light/system) + `.theme-ocean`/`.theme-sunset` hue 변형 |
| 폰트 | Inter (`@fontsource/inter`), mono는 Tailwind 기본 |
| 아이콘 | Lucide React (단독 사용) |
| 폼 | react-hook-form + `form-field.tsx`, 리치텍스트는 tiptap |
| 토스트 | Sonner |
| 로컬 포트 | web 6173 / api 9090 |

---

## 목차

| # | 문서 | 설명 |
|---|------|------|
| 01 | [Design Tokens](./01-design-tokens.md) | 색상 토큰(인디고 브랜드), 반경, Z-Index, 테마 변형 |
| 02 | [Typography](./02-typography.md) | 실사용 타이포 스케일 + 시맨틱 To-Be 스케일 |
| 03 | [Spacing & Layout](./03-spacing-layout.md) | 4px 스페이싱, AppLayout(앱 레일+사이드바) 골격, 그리드 |
| 04 | [Components](./04-components.md) | shadcn/ui 35개 프리미티브 사용 가이드 + variant API |
| 05 | [Page Patterns](./05-page-patterns.md) | 워크플레이스 실제 페이지 레이아웃 템플릿 (TSX 스켈레톤) |
| 06 | [Feedback States](./06-feedback-states.md) | Loading / Empty / Error / Toast 패턴 |
| 07 | [Iconography](./07-iconography.md) | Lucide 아이콘 사이즈·색상·간격 규칙 |
| 08 | [Animation & Motion](./08-animation-motion.md) | 트랜지션 타이밍, GPU 가속, Reduced Motion |
| 09 | [Form Patterns](./09-form-patterns.md) | react-hook-form 구조, 유효성 검사, 에러 표시 |
| 10 | [Accessibility](./10-accessibility.md) | WCAG 2.2 AA, ARIA, 키보드 네비게이션 |
| 11 | [Dark Mode](./11-dark-mode.md) | 다크 모드 토큰, 알파 오버레이 Surface Elevation |
| 12 | [Responsive](./12-responsive.md) | 브레이크포인트, 앱 셸 반응형, Desktop-first |
| 13 | [Migration Backlog](./13-migration-backlog.md) | 잔여 정리 작업 (P0~P3 우선순위) |

---

## Quick Reference Card

새 페이지나 컴포넌트를 만들 때 이 표를 참조한다. 상세는 각 문서 참고.

### Typography (As-Is 실사용)

| 용도 | 클래스 | 크기 |
|------|--------|------|
| 페이지·섹션 제목 | `text-2xl font-semibold` | 24px |
| Dialog/카드 제목 | `text-lg font-semibold` | 18px |
| 본문·폼 레이블·nav | `text-sm` | 14px |
| 활성 nav·버튼·카드 제목 | `text-sm font-medium` | 14px |
| 캡션·배지·메타·타임스탬프 | `text-xs` | 12px |
| 사이드바 그룹 라벨 | `text-xs font-semibold uppercase tracking-wider` | 12px |

> ⚠️ `text-[10px]`/`text-[11px]` 매직 넘버 23곳은 부채(12px 미만). To-Be 시맨틱 스케일은 [02번](./02-typography.md) 참조.

### Spacing (4px 기준 그리드)

| 토큰 | 값 | 용도 |
|------|----|----|
| `gap-2` / `p-2` | 8px | 아이콘-텍스트, 조밀한 요소 |
| `gap-4` / `p-4` | 16px | 카드 내부, 폼 필드 |
| `space-y-6` / `p-6` | 24px | 페이지 섹션 간격, 페이지 패딩 |
| `gap-8` | 32px | 주요 블록 분리 |

### Colors (시맨틱 토큰만 사용 — 하드코딩 hex 금지)

| 토큰 | 용도 |
|------|------|
| `bg-primary` / `text-primary-foreground` | 브랜드 CTA (인디고 `oklch(0.45 0.2 264)`) |
| `bg-background` / `text-foreground` | 기본 표면·텍스트 |
| `bg-muted` / `text-muted-foreground` | 보조 표면·텍스트 |
| `bg-card` / `border-border` | 카드 표면·테두리 |
| `bg-destructive` / `text-destructive` | 위험·삭제·에러 |
| `bg-sidebar*` | 사이드바 전용 토큰 |

### Layout (앱 셸)

| 영역 | 값 |
|------|----|
| 앱 레일(좌측 아이콘) | 고정 56px (모바일 240px 오버레이) |
| 모듈 2차 사이드바 | `w-56` (224px) |
| 메인 콘텐츠 | `flex-1` |
| 상단 GNB | **없음** — 페이지가 자체 헤더 렌더 |
| 반응형 분기 | `lg` (1024px) 단일 |

### Icons

| 컨텍스트 | 크기 |
|----------|------|
| 인라인(텍스트 옆)·버튼 | `h-4 w-4` (16px) |
| nav·툴바 | `h-5 w-5` (20px) |
| 빈 상태·대형 | `h-6 w-6`+ (24px+) |
| 색상 | `text-muted-foreground` 기본, 의미 시 토큰 색 |

### Z-Index

| 레이어 | 값 |
|--------|----|
| 드롭다운/팝오버/툴팁 | Radix 관리 (`z-50`) |
| Dialog/AlertDialog 오버레이 | `z-50` |
| AI 챗 도크 런처 칩 | `fixed top-2` |
| 토스트(Sonner) | 최상위 |

---

## 핵심 원칙

1. **시맨틱 토큰만** — 컴포넌트에 hex/임의 색 금지. `bg-primary` 등 토큰만 사용 (다크모드·테마 변형 자동 대응).
2. **`ui/`는 합성, 커스터마이즈 금지** — shadcn 생성 프리미티브는 직접 수정하지 않고 `cn()`으로 합성한다.
3. **AppLayout 셸 안에서** — 페이지는 앱 레일 + 모듈 사이드바 셸 내부에 렌더된다. 상단 GNB는 없다.
4. **AI 에이전트 일관성** — UI 작업 시 이 문서를 단일 원본으로 참조한다.
