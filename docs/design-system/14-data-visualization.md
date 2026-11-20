# 14. Data Visualization

Smart Workplace 디자인 시스템의 데이터 시각화(지표 카드·차트·대시보드) 규칙과 공용 부품을 정의한다. 부품은 `apps/workplace-web/src/components/metrics/` 에, 차트 토큰은 `index.css` 의 `--chart-*` 에 있다.

> 관련 문서: [01. Design Tokens](./01-design-tokens.md) §1-6 · [06. Feedback States](./06-feedback-states.md) · [10. Accessibility](./10-accessibility.md) · [11. Dark Mode](./11-dark-mode.md) · [12. Responsive](./12-responsive.md)

---

## 전략 개요

- **차트는 Recharts 를 shadcn `chart` 래퍼(`components/ui/chart.tsx`) 위에서 쓴다.** 화면 코드는 Recharts 를 직접 import 하지 않고 `components/metrics/` 의 공용 부품(`TrendChart`·`StackedBarChart`)만 부른다. Recharts 를 import 하는 곳은 `chart.tsx` 와 `*.impl.tsx` 둘뿐이다.
- **Recharts 는 지연 로딩한다.** `TrendChart.tsx`·`StackedBarChart.tsx`(껍데기)가 `lazy(() => import('./…impl'))` 로 구현을 늦게 불러, 차트를 그리는 화면만 Recharts 청크를 받는다. 데이터가 비면 impl 을 부르지 않고 「데이터 없음」으로 끝낸다. `components/metrics/index.ts` 같은 배럴 파일은 두지 않는다(지연 경계가 깨진다).
- **색은 `--chart-1..5` + `--chart-other` 토큰만 쓴다.** 값은 색맹(CVD) 검증을 통과한 것이고, 계열 색은 순위가 아니라 **고정 배정**이다.
- **차트가 필요 없는 지표는 차트로 그리지 않는다.** 숫자 하나는 `StatCard`, 한도 대비 사용률은 `UsageMeter`, 이상 목록은 `AlertList` 다.
- 손으로 그린 SVG·div 차트를 새로 만들지 않는다. 기존 것은 [현재 사용 현황](#현재-사용-현황)에 적고 후속으로 옮긴다.

---

## 대시보드 페이지 패턴

위에서 아래로 한 방향으로 읽히게 쌓는다.

```
┌─ 머리: 제목 · 갱신 시각 · 기간(PeriodToggle) ─────────┐
├─ 지표 줄: StatCard × N ───────────────────────────────┤
├─ 경고·사용률: AlertList · UsageMeter ─────────────────┤
├─ 추세: ChartCard > TrendChart / StackedBarChart ──────┤
└─ 표: 세부 목록 ───────────────────────────────────────┘
```

- 카드 사이 간격은 **16px**(`gap-4` / `space-y-4`). 카드 표면은 `rounded-lg border bg-card p-4` 하나다(`MetricCard` 가 한 벌로 갖고 `StatCard`·`ChartCard`·`OverviewCard` 가 쓴다).
- 기간은 머리 오른쪽 하나뿐이다. 카드마다 기간 선택기를 따로 두지 않는다.
- 한 화면의 지표 줄은 한 줄에 둔다. 넘치면 줄바꿈이 아니라 지표를 줄인다.

---

## 차트 형식 고르기

| 보여줄 것 | 형식 | 부품 |
|-----------|------|------|
| 시간에 따른 추세 | 선 | `TrendChart` |
| 시간대별 구성·누적량 | 누적 막대 | `StackedBarChart` |
| 한도 대비 사용량 | 사용률 막대 + 상한 점선 | `UsageMeter` / 차트의 `limit` |
| 비율 하나 | 지표 카드(숫자) | `StatCard` + `formatPercent` |
| 이상·주의 목록 | 아이콘+글자 목록 | `AlertList` |

- **두 축(이중 Y 축) 금지.** 단위가 다른 두 지표는 차트를 둘로 나눈다.
- 파이·도넛은 쓰지 않는다. 비율 하나는 숫자, 구성은 누적 막대로 그린다.
- 차트는 **음수 없는 지표**(건수·시간·비용) 용이다. 음수가 있으면 이 부품으로 그리지 않는다.

---

## 차트 색

### 규칙

- 계열 색은 `chartColorVar(i)` 로 얻는다(`var(--chart-1..5)`, `'other'` → `var(--chart-other)`). 하드코딩 hex·`oklch()` 금지.
- **고정 배정**: 같은 대상(예: 같은 AI 계정)은 어느 화면·기간에서나 같은 색 번호를 쓴다. 이번 기간 순위로 색을 다시 칠하지 않는다.
- **6번째부터는 구분하지 않고 「기타」**(`--chart-other` 회색)로 묶는다. `groupTopN(items, 5)` 가 값이 큰 순 상위 5개와 나머지 합(`other`, `count` 포함)을 돌려준다.
- **상태 색(success·warning·destructive·info)을 계열 색으로 쓰지 않는다.** 계열 색은 상태를 뜻하지 않는다. 빨강 계열(hue 15–35)과 AI 표식 보라(hue 280–310)도 피한다(`--destructive`·`--ai-accent` 와 혼동).
- 한도·기준선은 계열 색이 아니라 `--muted-foreground` 점선이다.
- 다크 모드는 CSS 변수가 바꿔 준다. 컴포넌트에서 `.dark` 분기를 두지 않는다.

### 팔레트 값

색 순서는 파랑 · 청록 · 황토 · 분홍 · 연두로 고정이다.

| 토큰 | 라이트 | 다크 |
|------|--------|------|
| `--chart-1` | `oklch(0.519 0.19 258)` `#0362d3` | `oklch(0.62 0.17 258)` `#3d84ea` |
| `--chart-2` | `oklch(0.593 0.105 183)` `#049284` | `oklch(0.661 0.116 185)` `#04a99c` |
| `--chart-3` | `oklch(0.662 0.14 75)` `#c48400` | `oklch(0.67 0.14 78)` `#c48800` |
| `--chart-4` | `oklch(0.599 0.19 350)` `#cd4290` | `oklch(0.639 0.17 350)` `#d4599a` |
| `--chart-5` | `oklch(0.62 0.17 135)` `#559b1b` | `oklch(0.661 0.151 135)` `#68a63f` |
| `--chart-other` | `oklch(0.65 0 0)` `#8f8f8f` | `oklch(0.55 0 0)` `#717171` |

`--color-chart-other` 도 `@theme inline` 에 매핑돼 `bg-chart-other` 등으로 쓸 수 있다.

### 검증 결과 요약

판정 도구는 dataviz 스킬의 `validate_palette.js`(범주형 팔레트 검사: 명도 대역·채도 하한·CVD 인접쌍 분리·정상 시야 분리·표면 대비 3:1)다. 표면은 라이트 `--card` `#ffffff`, 다크 `--card`(`oklch(1 0 0 / 4.5%)`)를 다크 `--background` 위에 합성한 `#111218` 이다.

| 모드 | 결과 | 최악 인접쌍 (CVD) | 최악 인접쌍 (정상 시야) |
|------|------|-------------------|--------------------------|
| 라이트 | 전부 통과 | `#c48400`↔`#049284` ΔE 12.2 (protan) | `#049284`↔`#0362d3` ΔE 20.6 |
| 다크 | 전부 통과 | `#68a63f`↔`#d4599a` ΔE 11.7 (deutan) | `#04a99c`↔`#3d84ea` ΔE 17.9 |

- CVD ΔE 가 6–8 대역에 들면 보조 표현(직접 라벨·간격·질감)이 있어야 한다. 최악 인접쌍은 protan/deutan 이 라이트 12.2·다크 11.7 로 10 이상이지만, **tritan 은 라이트 7.3·다크 5.5 로 6–8 대역이거나 그 아래**다. 그래서 **계열이 둘 이상이면 범례를 항상 켠다**(공용 차트가 자동으로 켠다).
- `--chart-other` 는 채도 0 이라 채도 검사 대상이 아니다. 표면 대비만 계산했다(라이트 3.23:1, 다크 3.85:1).

다시 검증하는 명령(색을 바꿀 때 반드시 둘 다 돌리고 FAIL 0 을 확인):

```bash
node validate_palette.js "#0362d3,#049284,#c48400,#cd4290,#559b1b" --mode light --surface "#ffffff"
node validate_palette.js "#3d84ea,#04a99c,#c48800,#d4599a,#68a63f" --mode dark  --surface "#111218"
```

`validate_palette.js` 는 dataviz 스킬 `scripts/` 에 있다. oklch → sRGB hex 변환은 범위 밖을 클립하므로, 새 값은 hex 로 변환한 뒤 CSS 에는 그 hex 를 되읽은 oklch 로 적는다. 전체 검증 기록은 WP-1822 이슈 증빙(`palette-validation.txt`)에 있다.

---

## 선·막대·격자·축 규격

두 차트 모두 `ChartContainer`(shadcn) 위에 그리고, 규격은 impl 이 이미 지킨다. 새 차트 부품을 만들 때도 같게 한다.

| 요소 | 규격 |
|------|------|
| 선(`TrendChart`) | 굵기 **2px**, 점(dot) 없음, `type="monotone"`, `connectNulls={false}` — **빈 구간(`null`)은 이어 그리지 않고 끊는다** |
| 누적 막대(`StackedBarChart`) | 한 `stackId` 로 쌓고, 막대 조각 사이 **2px** 는 `var(--background)` stroke 로 만든다(다크 `--card` 는 반투명이라 `var(--card)` 를 쓰면 틈이 비쳐 보인다. 카드(`bg-card`) 위에서는 배경색과 카드색이 달라 이음매가 살짝 보일 수 있다 — 의도한 절충이다). **맨 위 조각만** 위 끝 둥글게(`[4,4,0,0]`, `isTopSegment` 로 판정) |
| 격자 | 가로선만(`vertical={false}`), 점선 `3 3`, `strokeOpacity 0.5` |
| 축 | 눈금선·축선 없음(`tickLine`·`axisLine` false), 글자 `text-xs fill-muted-foreground`(12px), Y 축 폭 40px |
| 한도선 | `ReferenceLine` 점선 `4 4`, `--muted-foreground`, 라벨은 오른쪽 위 `text-xs`. `ifOverflow="extendDomain"` 이라 한도가 데이터 최댓값보다 커도 Y 축이 늘어나 선이 보인다 |
| 애니메이션 | 끔(`isAnimationActive={false}`) |
| 높이 | 기본 200px(`height` prop), 폭은 부모를 따른다 |

---

## 범례·툴팁

- **범례**: 계열이 2개 이상이면 항상 켠다(`ChartLegend`). 색만으로 계열을 구분하게 두지 않는다. 한 계열이면 카드 제목이 곧 범례다. 범례를 카드 머리에 따로 두려면 `ChartCard` 의 `legend` 슬롯을 쓴다.
- **툴팁**: 선은 **세로 기준선**(`--border` 1px) 위에서 그 시점의 모든 계열 값을 보여 준다. 막대는 **막대마다** 툴팁이 뜬다. 값 표기는 `valueFormatter`, 가로축 표기는 `xFormatter` 로 넘기고 [숫자 표기](#숫자-표기)의 함수를 쓴다.
- 막대를 눌러 이동하는 동작은 `StackedBarChart` 의 `onBarClick(datum)` 으로 받는다(`cursor: pointer` 가 함께 켜진다).

---

## 빈·로딩·오류 상태

`ChartCard` 의 `state` prop 하나로 세 상태를 같게 그린다.

| 상태 | `state` | 표시 |
|------|---------|------|
| 불러오는 중 | `'loading'` | `Skeleton`(`h-40 w-full`) |
| 비어 있음 | `'empty'` | 「데이터 없음」 (`emptyLabel` 로 바꿀 수 있다), 가운데 정렬 `text-sm text-muted-foreground` |
| 실패 | `'error'` | 「불러오지 못함」 + `onRetry` 가 있으면 「다시 시도」 단추(`outline` `sm`) |

- 차트 자체도 모든 계열이 `null`/없음이면 「데이터 없음」을 그린다(`hasAnyValue`). 일부 시점만 비면 그 구간만 끊어서 보인다 — 0 으로 채우지 않는다. 0 은 「측정했더니 0」이고 `null` 은 「측정 없음」이다.
- 문구를 바꾸지 않는다: 「데이터 없음」·「불러오지 못함」·「다시 시도」. 일반 화면 상태는 [06-feedback-states.md](./06-feedback-states.md) 를 따른다.
- `AlertList` 가 비면 「이상 없음」(`emptyLabel`)을 보인다.

---

## 숫자 표기

`apps/workplace-web/src/lib/formatters.ts` 의 함수를 쓴다. 직접 `toFixed`·`toLocaleString` 으로 조립하지 않는다. `NaN`·`Infinity`·음수는 `EMPTY_GLYPH`(—) 로 나온다(`formatPercentPointDiff` 는 음수 차이를 허용).

| 함수 | 입력 | 예 |
|------|------|-----|
| `formatNumber(n)` | 수 | `1234` → `1,234` (정확한 건수, 기존 함수) |
| `formatCompactNumber(n)` | 수 | `1234` → `1.2K`, `3100000` → `3.1M`, `1500000000` → `1.5B` (축·좁은 카드용. `999950` → `1M`) |
| `formatPercent(ratio, digits = 1)` | **0~1 비율**(퍼센트 값 아님) | `0.123` → `12.3%`, `0.5` → `50%` |
| `formatPercentPointDiff(cur, prev)` | 두 **0~1 비율** | `(0.05, 0.034)` → `+1.6%p`, 같으면 `0%p` |
| `formatDurationMs(ms)` | 밀리초 | `850` → `850ms`, `12300` → `12.3초`, `245000` → `4분 5초`, `7380000` → `2시간 3분` |

- 소수는 1자리, 끝의 `.0` 은 생략한다. 숫자 열은 `tabular-nums` 로 맞춘다(`StatCard` 의 값이 그렇다).
- 변화량은 비율 차이를 `%p`(퍼센트포인트)로, 건수 차이는 부호를 붙인 숫자로 적는다. 비율끼리의 차이를 `%` 로 적지 않는다.
- `formatDurationMs` 와 기존 `formatDuration(startedAt, completedAt)` 은 다르다(시각 쌍용 vs 밀리초용).

---

## 기간 선택

- 기간 고르기는 **버튼 묶음 하나**, `PeriodToggle` 이다. `role="group"` + 버튼마다 `aria-pressed`, `aria-label`(묶음이 무엇을 고르는지)은 필수다. 제네릭 `T extends string` 이라 `options: { value: T; label: string }[]` 를 넘긴다.
- 선택값은 주소에 둔다(공유·새로고침 유지): `usePeriodParam(key, values, defaultValue)` → `[value, setValue]`. 기본값은 주소에서 빠지고, 주소에 모르는 값이 있으면 기본값으로 본다. 다른 파라미터는 건드리지 않고 이력도 쌓지 않는다(`replace`).

```tsx
const PERIODS = ['7d', '30d', '90d'] as const
const [period, setPeriod] = usePeriodParam('period', PERIODS, '30d')

<PeriodToggle
  aria-label="조회 기간"
  options={[{ value: '7d', label: '7일' }, { value: '30d', label: '30일' }, { value: '90d', label: '90일' }]}
  value={period}
  onChange={setPeriod}
/>
```

---

## 모바일

> 이 절은 새로 만들거나 고치는 화면에 적용하는 규칙이다. 프로젝트 개요 카드 같은 기존 화면은 아직 다 따르지 않는다.

- 지표 카드는 **2열**(`grid-cols-2`)로 쌓는다. 데스크톱은 한 줄에 N 개.
- 그래프는 **한 줄에 하나**. 가로로 나란히 두지 않는다.
- 막대는 줄인다 — 좁은 폭에서는 표시 구간(막대 수)을 줄이고, 막대 조각을 더 얇게 하지 말고 개수를 줄인다.
- 표는 모바일에서 **목록**(카드형 행)으로 바꾼다. 가로 스크롤 표로 두지 않는다. 일반 반응형 규칙은 [12-responsive.md](./12-responsive.md).
- 호버 전용 정보를 두지 않는다. 터치에서 툴팁이 단추가 되는 곳(`StatCard` 의 아랫줄)은 링크 밖에 둔다.

---

## 접근성

> 이 절은 새로 만들거나 고치는 화면에 적용하는 규칙이다. 프로젝트 개요 카드 같은 기존 화면은 아직 다 따르지 않는다.

- **색만으로 구분하지 않는다.** 계열은 범례(색 점+이름)로, 위험 수준은 `AlertList` 의 아이콘+글자(위험/주의/알림)로 함께 보인다. 사용률 막대의 tone 도 숫자 라벨을 곁에 둔다.
- 차트는 `role="img"` 에 `aria-label`(필수 prop)을 달아 무엇을 그린 것인지 한 문장으로 알린다. 세부 값은 같은 화면의 표나 툴팁이 맡는다.
- `UsageMeter` 는 `role="progressbar"` + `aria-valuemin/max/now` + `aria-label`(예: 「5시간 사용률」).
- `PeriodToggle` 은 `aria-pressed` 로 선택 상태를 알린다.
- 계열 색의 표면 대비는 3:1 이상이다(검증 항목). 더 엄격한 기준은 [10-accessibility.md](./10-accessibility.md).

---

## 공용 부품

모두 `apps/workplace-web/src/components/metrics/` 에 있다.

| 부품 | 파일 | 주요 props | 용도 |
|------|------|-----------|------|
| `StatCard` | `StatCard.tsx` | `title`, `value`, `meta`, `testId`, `href?`, `LinkAs?` | 숫자 카드. `href` 가 있으면 제목·숫자만 링크(아랫줄 `meta` 는 링크 밖) |
| `PeriodToggle<T>` | `PeriodToggle.tsx` | `options`, `value`, `onChange`, `aria-label`, `className?` | 기간 버튼 묶음 |
| `usePeriodParam` | `usePeriodParam.ts` | `(key, values, defaultValue)` | 기간 ↔ 주소 파라미터 |
| `UsageMeter` | `UsageMeter.tsx` | `percent`, `tone: UsageBarTone`, `label`, `className?` | 0~100% 사용률 막대. tone 은 `destructive`·`warning`·`primary`·`muted`, 판정은 `lib/agentAccountUsage.ts` |
| `AlertList` | `AlertList.tsx` | `items: { id, level: 'danger'\|'warning'\|'info', label, action? }[]`, `emptyLabel?` | 위험·주의·알림 목록 |
| `ChartCard` | `ChartCard.tsx` | `title`, `unit?`, `legend?`, `actions?`, `state?`, `onRetry?`, `emptyLabel?`, `children` | 차트 카드 틀과 세 상태 |
| `TrendChart` | `TrendChart.tsx` (+ `.impl.tsx`) | `data`, `xKey`, `series`, `limit?`, `valueFormatter?`, `xFormatter?`, `height?`, `width?`, `aria-label` | 선 그래프 |
| `StackedBarChart` | `StackedBarChart.tsx` (+ `.impl.tsx`) | `TrendChart` 와 같고 `onBarClick?(datum)` 추가 | 누적 막대 |
| `MetricCard` | `MetricCard.tsx` | `className?`, `children`, `testId?` | 카드 표면 한 벌(`StatCard`·`ChartCard`·`OverviewCard` 가 씀) |
| `chartColors` | `chartColors.ts` | `chartColorVar(i)`, `groupTopN(items, n = 5)`, `buildChartConfig(series)` | 색 번호 → CSS 변수, 상위 N + 기타, 계열 → 차트 config(타입만 가져와 Recharts 를 끌고 오지 않는다) |
| `chartData` / `chartTypes` / `lazyChart` / `chartTooltip` | `chartData.ts`·`chartTypes.ts`·`lazyChart.tsx`·`chartTooltip.tsx` | `hasAnyValue`·`isTopSegment`, `ChartSeries`·`ChartLimit` 타입, `makeLazyChart`, 툴팁 포맷터·`buildTooltipContent` | 내부 도구. `chartTooltip` 은 Recharts 를 쓰는 impl 에서만 가져오고, `chartTypes`·`lazyChart` 는 Recharts 를 끌고 오지 않는다 |

`ChartSeries` 는 `{ key, label, colorIndex }` 이고 `colorIndex` 는 `1~5 | 'other'` 다. **`key` 는 유효한 CSS 사용자 지정 속성 이름이어야 하고(`--color-<key>` 로 쓰인다) 점(`.`)을 넣지 않는다** — Recharts 가 점을 중첩 경로로 읽는다. 이메일·ID 같은 값은 안전한 키(`s0`, `s1` …)로 매핑하고 사람이 읽는 값은 `label` 에 둔다. `limit` 은 `{ value, label }`.

```tsx
<ChartCard title="일별 호출" unit="건" actions={<PeriodToggle … />} state={state} onRetry={refetch}>
  <StackedBarChart
    aria-label="일별 호출 수(계정별)"
    data={rows}
    xKey="day"
    series={[
      { key: 'a', label: '계정 A', colorIndex: 1 },
      { key: 'b', label: '계정 B', colorIndex: 2 },
    ]}
    valueFormatter={formatCompactNumber}
  />
</ChartCard>
```

---

## 현재 사용 현황

공용 부품으로 이미 옮긴 곳:

- `StatCard` — `pages/me/overview/MyOverviewTab.tsx`, `pages/projects/overview/OverviewNumberCards.tsx` (둘 다 `@/components/metrics/StatCard` 를 import).
- `UsageMeter` — `pages/admin/components/AgentAccountUsageParts.tsx`.

아직 공용 부품으로 옮기지 않은 곳(As-Is, 옮기기는 후속):

| 구분 | 위치 | 비고 |
|------|------|------|
| 손그림 차트 | `pages/me/overview/OverviewCharts.tsx` | div 막대 + SVG 도넛(완료 추이·마감 준수) |
| 손그림 차트 | `pages/projects/overview/OverviewProgress.tsx` | 범위·완료·예상 선을 SVG 로 직접 그림 |
| 손그림 소형 차트 | `components/ui/sparkline.tsx` | `--primary` 등을 쓰는 커스텀 막대 |
| 기간 선택기 | `pages/me/overview/MyOverviewTab.tsx` 의 `OverviewPeriodPicker` | 버튼 묶음 + 주소 파라미터를 직접 구현 |
| 기간 선택기 | `pages/projects/timeline/TimelinePeriodPicker.tsx` | 필터바의 「기간」 드롭다운(이슈를 거르는 필터 성격) |
| 기간 선택기 | `pages/admin/HelpMetricsPage.tsx` | `Select` (7·30·90일) |

> 새 화면(예: AI 현황)은 처음부터 `components/metrics/` 부품을 쓴다. 위 표의 옛 구현을 새 화면이 따라 만들지 않는다.

---

## 현재(As-Is) vs 권장(To-Be)

| 항목 | 현재(As-Is) | 권장(To-Be) |
|------|------------|------------|
| 차트 그리기 | 개요 화면마다 SVG·div 손그림 | `TrendChart`·`StackedBarChart` |
| 차트 색 | 손그림은 `--primary` 등 임의 토큰 | `--chart-1..5`·`--chart-other` 고정 배정 |
| 기간 선택 | 세 곳이 제각각(버튼 묶음·드롭다운·Select) | `PeriodToggle` + `usePeriodParam` 하나 |
| 숫자 표기 | 화면별 `toFixed`·`toLocaleString` 혼재 | `formatters.ts` 의 지표 함수 |
| 사용률 막대 | `UsageMeter` 로 이전 완료 | 현행 유지 |
| 지표 카드 | `StatCard` 를 `components/metrics/` 로 이전 완료 | 현행 유지 |
| 손그림 차트·옛 기간 선택기 이전 | 미착수 | 후속 이슈로 하나씩(설계 §9 「기존 화면 옮기기」) |

---

## 주의 사항

1. **`components/ui/chart.tsx` 는 한 줄을 손으로 고쳤다.** shadcn CLI 가 존재하지 않는 `"cn"` 패키지를 import 하는 버그가 있어 `@/lib/utils` 로 바꿨다. **다음 `shadcn add chart --overwrite` 때 되돌아갈 수 있으니**, 덮어쓴 뒤 `import { cn }` 줄을 확인한다.
2. **다크 `--chart-3`(hue 78)과 `--warning`(hue 84)이 가깝다.** CVD 인접쌍을 통과시키려고 색 순서를 순열 탐색해 얻은 값이며(검증 기록에 이 근접 자체를 따로 다룬 설명은 없다 — 검증 통과 값이라는 사실만 근거다), 상태 색을 계열 색으로 쓰지 않는 규칙(위 [차트 색](#차트-색))과 계열 둘 이상일 때 범례를 항상 켜는 규칙이 이 둘을 구분해 준다. 경고 표시는 `AlertList` 의 아이콘+글자로 하므로 차트 황토와 겹쳐 읽히지 않는다.
3. **테마 덮어쓰기 4개를 삭제했다.** `.theme-ocean`·`.theme-sunset` 의 라이트·다크 `--chart-1` 이 옛 팔레트 위에서는 테마 주색을 따랐지만, 새 팔레트에서 검증하니 ocean 라이트(채도 0.085·청록과 ΔE 10.0)·ocean 다크(L 0.749)·sunset 다크(L 0.72)가 FAIL 이었다. sunset 라이트는 통과했지만 같은 테마 안에서 라이트·다크가 달라지지 않게 함께 지웠다. 이제 차트 색은 테마와 무관하게 모든 테마에서 같다. **테마별 다크 표면(`.theme-*.dark` 의 `--card` 합성색)은 검증하지 않았다** — 검증 표면은 기본 다크 `#111218` 하나다.
4. **음수 없는 지표용이다.** 누적 막대 맨 위 둥글기(`isTopSegment`)는 음수 값을 고려하지 않는다. 음수가 필요하면 부품을 확장하고 이 문서를 고친다.
5. **테스트에서 `ChartContainer` 는 jsdom 에서 그려지지 않는다.** `ResponsiveContainer` 가 크기 0 을 받기 때문이다. 테스트 키트 `src/test/kits/chartResize.ts` 의 `stubChartResize()` 가 `ResizeObserver` 를 400×200 으로 스텁하니, 새 차트 테스트는 이 도구를 쓴다(`ChartContainer` 는 항상 `ResponsiveContainer` 를 써서 우회할 수 없다).
6. **한도선은 데이터보다 커도 보인다.** `ifOverflow="extendDomain"` 이 Y 축 범위를 한도까지 늘린다. 기본값(`discard`)은 범위 밖 선을 지워 버린다.
7. **Recharts 를 화면에서 직접 import 하지 않는다.** `chart.tsx` 와 `*.impl.tsx` 밖에서 import 하면 메인·개요 청크에 Recharts 가 섞인다. `components/metrics/` 에 배럴(`index.ts`)도 두지 않는다.
8. **색을 바꿀 때는 검증을 다시 돌린다.** [검증 결과 요약](#검증-결과-요약)의 두 명령에서 FAIL 0 이어야 하고, 이 문서의 값 표와 `index.css` 주석의 hex 를 함께 고친다.
