# 11. 다크 모드 (Dark Mode)

> **기준 파일**: `apps/workplace-web/src/index.css`
> 토큰 전체 정의는 [01-design-tokens.md](./01-design-tokens.md) 참조.

---

## A. 인프라 (Infrastructure)

- **Theme provider**: `next-themes` (light / dark / system)
- **토글**: `AppRailUserMenu`(앱 레일 사용자 메뉴)에서 테마 전환 제공
- **CSS 변형**: `index.css` 상단 `@custom-variant dark (&:is(.dark *))` — `next-themes`가 root에 `.dark` 클래스를 추가/제거하면 `dark:` 유틸리티와 `.dark` 선택자가 동작
- **토큰 레이어**: 완비 — `:root`(라이트)와 `.dark`(다크)에 40여 개 토큰이 light/dark 값 쌍으로 정의됨
- **컬러 테마 변형**: `.theme-ocean` / `.theme-sunset`이 `.dark`와 조합 가능(`.theme-ocean.dark`). 단, 테마 클래스를 토글하는 스위처는 아직 미연결 ([01-design-tokens.md](./01-design-tokens.md) §2 참조)

---

## B. Light ↔ Dark 토큰 매핑

| 토큰 | Light | Dark | 규칙 |
|------|-------|------|------|
| `--background` | `oklch(0.985 0.002 264)` | `oklch(0.13 0.015 280)` | 명도 반전 + 한색(h 264→280) |
| `--foreground` | `oklch(0.145 0 0)` | `oklch(0.93 0 0)` | 반전 (순백 아님) |
| `--card` | `oklch(1 0 0)` | `oklch(1 0 0 / 3%)` | 솔리드 → 흰색 알파 오버레이 |
| `--primary` | `oklch(0.45 0.2 264)` | `oklch(0.65 0.2 264)` | 인디고 — 다크에서 더 밝게(L↑) |
| `--secondary` | `oklch(0.965 0.005 264)` | `oklch(1 0 0 / 5%)` | 솔리드 → 흰색 5% 알파 |
| `--muted` | `oklch(0.965 0.005 264)` | `oklch(1 0 0 / 5%)` | secondary와 동일 |
| `--muted-foreground` | `oklch(0.5 0 0)` | `oklch(0.6 0 0)` | 다크 배경에서 더 밝게 |
| `--accent` | `oklch(0.955 0.01 264)` | `oklch(1 0 0 / 7%)` | 솔리드 → 흰색 7% 알파 |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` | 다크에서 더 밝고 채도 낮게 |
| `--border` | `oklch(0.94 0.005 264)` | `oklch(1 0 0 / 10%)` | 솔리드 → 흰색 10% 알파 |
| `--input` | `oklch(0.92 0.005 264)` | `oklch(1 0 0 / 12%)` | 솔리드 → 흰색 12% 알파 |
| `--ring` | `oklch(0.55 0.15 264)` | `oklch(0.65 0.2 264)` | 인디고 — 다크에서 더 밝게 |

시맨틱 상태(`--success`/`--warning`/`--info`)와 도메인·AI 토큰(`--ai-accent` 등)도 모두 다크 값을 별도로 정의한다. 자세한 값은 [01-design-tokens.md](./01-design-tokens.md) §1-4·§1-5 참조.

---

## C. 표면 고도 모델 (Surface Elevation Model)

Workplace 다크 모드의 핵심 특징은 **솔리드 회색이 아니라 흰색 알파 오버레이**로 표면을 쌓는다는 점이다. 어두운 한색 베이스(`oklch(0.13 0.015 280)`) 위에 흰색을 점점 더 많이 섞어 고도를 표현한다 — 알파가 높을수록 더 "떠 보이는" 표면이다.

| 레벨 | 표면 | OKLch | 사용처 |
|------|------|-------|--------|
| 0 (Base) | 페이지 배경 | `oklch(0.13 0.015 280)` | Body / `--background` |
| 0' (Sidebar) | 사이드바 베이스 | `oklch(0.14 0.02 280)` | `--sidebar` |
| 1 (Card) | 카드 표면 | `oklch(1 0 0 / 3%)` | `--card` |
| 2 (Secondary/Muted) | 보조 표면 | `oklch(1 0 0 / 5%)` | `--secondary`, `--muted` |
| 3 (Accent) | hover/강조 표면 | `oklch(1 0 0 / 7%)` | `--accent`, `--sidebar-accent` |
| Popover | 드롭다운/팝오버 | `oklch(0.18 0.015 280)` | `--popover` (솔리드, 예외) |

> `--popover`만 알파가 아닌 솔리드 한색(`oklch(0.18 0.015 280)`)이다. 팝오버는 아래 콘텐츠가 비치면 안 되므로 의도적으로 불투명하게 둔다.
> 테두리(`--border` 10%) > Input(`--input` 12%)도 같은 알파 누적 모델을 따른다.

---

## D. 현재 구현 상태 (As-Is)

- **shadcn/ui primitive**: CSS 변수를 사용하므로 다크 모드 완전 지원
- **CSS 토큰**: light/dark 쌍 완비. `@layer base`에서 `* { @apply border-border outline-ring/50 }` + `body { @apply bg-background text-foreground }`로 전역 기본값 연결 (중복 정의 없음)
- **커스텀 효과의 다크 변형**: `index.css`의 커스텀 효과는 각각 `.dark` 전용 규칙을 별도로 가져 그림자가 안 보이는 다크 환경을 보완한다. 컴포넌트에서 실제 사용 중인 것은 `.row-hover`(인디고 알파 배경)와 `.nav-active-indicator`(인디고→퍼플 glow). `.card-hover`/`.status-online`/`.bg-gradient-main`/`logo-pulse`는 다크 분기까지 정의돼 있으나 아직 화면에 연결되지 않았다([08-animation-motion.md](./08-animation-motion.md) §B-3 참조).
- **애플리케이션 페이지**: 대부분 CSS 변수 자동 전환에 의존. 페이지 레벨 `dark:` 유틸리티 사용은 제한적이다.

---

## E. 다크 모드에서 주의할 점

1. **하드코딩 색상 회피**: `bg-green-100`, `bg-amber-50`, `text-blue-600` 같은 Tailwind 팔레트 직접 사용은 다크 배경에서 대비/가시성이 깨진다. 항상 시맨틱 토큰(`bg-success-subtle text-success` 등)을 사용한다.
2. **그림자(Shadow) 한계**: `shadow-sm`/`-lg` 등은 어두운 배경에서 거의 보이지 않는다. 분리감이 필요하면 알파 표면 고도(섹션 C) 또는 `.card-hover`/`.row-hover`의 다크 전용 box-shadow/border 효과를 사용한다.
3. **알파 표면의 누적**: secondary/muted/accent가 모두 흰색 알파이므로, 알파 표면을 또 다른 알파 표면 위에 겹치면 의도보다 밝아질 수 있다. 중첩 시 명도를 직접 확인한다.
4. **react-flow 잔존 CSS**: `index.css`에 `.dark .react-flow__*` 규칙이 남아 있으나, Workplace에는 react-flow 의존성/사용처가 없다 — sibling에서 물려받은 죽은 스타일로 **제거 후보**다.

---

## F. 설계 규칙 (Design Rules)

1. **순수 검은색 사용 금지**: `#000000` 대신 한색 베이스 `oklch(0.13 0.015 280)`를 사용 — 눈의 피로 감소 + 브랜드 한색 톤 유지.
2. **알파 기반 표면·테두리**: 다크 모드에서는 솔리드 회색 대신 `oklch(1 0 0 / N%)` 알파 오버레이로 표면과 테두리를 구성한다.
3. **다크에서 텍스트·브랜드색을 더 밝게**: muted-foreground는 `0.5 → 0.6`, primary는 `L 0.45 → 0.65`로 끌어올려 가독성·대비를 확보한다.
4. **시맨틱 토큰 사용**: 항상 `bg-background`, `text-foreground`, `border-border`, `text-primary` 등을 사용하고 색상 하드코딩을 금지한다.
5. **상태/도메인 색에 다크 변형 필수**: `--success`/`--warning`/`--info`/`--ai-accent` 등 새 색상 토큰을 추가할 때 반드시 `.dark` 값도 함께 정의한다.
6. **커스텀 효과는 다크 분기 작성**: box-shadow에 의존하는 효과는 `.dark` 셀렉터에 별도 규칙(밝은 표면·glow·border)을 추가해 다크에서도 분리감이 유지되게 한다.

---

## G. 향후 정리 후보

- `.dark .react-flow__*` 규칙 — react-flow 미사용, 제거 후보 (섹션 E-4).
- `--chart-1..5`, `--dtype-*` 토큰의 다크 값 — 라이트와 마찬가지로 참조하는 컴포넌트가 없다 ([01-design-tokens.md](./01-design-tokens.md) §1-6).
