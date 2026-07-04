# 에픽 패널 재설계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에픽 패널의 진입점을 뷰 탭 바 「에픽」 토글로 일원화하고, 패널 UI를 디자인 시스템에 맞게 재구성하며(전체 높이·A안 아이템·빈 상태·에픽 만들기), 「에픽 미할당」 필터를 추가한다.

**Architecture:** 프론트엔드 전용(`apps/workplace-web`). 열림 상태는 `useEpicPanelOpen` 훅(프로젝트별 localStorage, 기본 닫힘)으로 `IssueArea`에 끌어올리고, `ViewChipBar`(토글 버튼)와 `EpicSidePanel`(조건 마운트)에 배선한다. 「에픽 미할당」은 기존 `typeIds`(전체 유형−EPIC) 필터 재사용 — 백엔드·마이그레이션 변경 없음.

**Tech Stack:** React 19 + TS, TanStack Query, shadcn/ui + Tailwind 4, Playwright E2E(API 모킹).

**Spec:** `docs/superpowers/specs/2026-07-04-epic-panel-redesign-design.md` · **이슈:** #629

## Global Constraints

- 한국어 주석 필수(컴포넌트·훅·주요 로직).
- 색상은 시맨틱 토큰만(`bg-accent`, `bg-muted`, `text-muted-foreground` 등). 예외: 에픽 식별색은 `avatarColorClass` categorical 팔레트(§1-7) — 반환값 `"bg-x-500 text-white"`에서 `.split(' ')[0]`로 `bg-*`만 추출.
- 목록 행 hover 는 `hover:bg-muted/50` + `transition-colors`, 선택은 `bg-accent font-medium`(계열 분리).
- 모든 클릭 항목은 실제 `<button>`(focus-visible 링·키보드 확보). 텍스트 동반 장식 아이콘은 `aria-hidden`.
- `animate-pulse` 사용처엔 `motion-reduce:animate-none` 병기.
- 경계·구분은 `border`만 사용(shadow 금지 — 다크 모드 무효).
- E2E 는 `page.route()` API 모킹, 모킹 데이터는 `src/types/` 타입 적용.
- 커밋 메시지는 `docs/COMMIT_CONVENTION.md` 준수(한국어, `feat(web): ...` 형식 + #629).
- shadcn `Toggle` 프리미티브 없음 — `Button variant="outline" size="sm"` + `aria-pressed` 사용.
- `src/components/ui/` 수동 편집 금지.

## File Structure

- Create: `src/hooks/useEpicPanelOpen.ts` — 열림 상태 훅(프로젝트별 localStorage)
- Modify: `src/pages/projects/ProjectDetailPage.tsx` — `IssueArea` 훅 호출·배선·`items-stretch`
- Modify: `src/pages/projects/components/ViewChipBar.tsx` — 우측 「에픽」 토글 버튼
- Modify: `src/pages/projects/components/EpicSidePanel.tsx` — 패널 전면 재구성
- Modify: `src/pages/projects/components/IssueCreateDialog.tsx` — `initialTypeId` 옵션 prop
- Rewrite: `e2e/pages/projects/epic-side-panel.spec.ts` — 토글·영속·미할당·빈 상태·생성
- Check: `e2e/pages/projects/epic-hierarchy.spec.ts` 등 `epic-side-panel`/`epic-panel-collapse-toggle`/`epic-filter-` 참조 스펙 보정

---

### Task 1: `useEpicPanelOpen` 훅 + 탭 바 토글 + 조건 마운트 배선

**Files:**
- Create: `src/hooks/useEpicPanelOpen.ts`
- Modify: `src/pages/projects/ProjectDetailPage.tsx:80-114` (IssueArea)
- Modify: `src/pages/projects/components/ViewChipBar.tsx`
- Test: `e2e/pages/projects/epic-side-panel.spec.ts` (기존 스펙 중 접기 테스트 대체 + 나머지에 열기 스텝 추가)

**Interfaces:**
- Produces: `useEpicPanelOpen(projectKey: string): { open: boolean; toggle: () => void }` — localStorage 키 `epicSidePanel.open.<projectKey>`
- Produces: `ViewChipBar` 신규 props `epicPanelOpen: boolean`, `onToggleEpicPanel: () => void`
- Produces: 토글 버튼 `data-testid="epic-panel-toggle"` (Task 2~4 의 E2E 가 사용)
- 주의: 이 태스크부터 패널은 **기본 숨김** — `EpicSidePanel` 은 `open`일 때만 마운트

- [ ] **Step 1: 훅 작성**

`src/hooks/useEpicPanelOpen.ts` 생성:

```tsx
// 에픽 패널 열림 상태 — 프로젝트별 localStorage 영속(기본 닫힘).
// 진입점은 뷰 탭 바의 「에픽」 토글 하나(스펙 2026-07-04-epic-panel-redesign).
import { useState } from 'react';

const KEY_PREFIX = 'epicSidePanel.open.';

// localStorage 접근 불가 환경(사파리 프라이빗 등)에서는 기본값(닫힘)으로 동작.
function readStored(projectKey: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + projectKey) === 'true';
  } catch {
    return false;
  }
}

export function useEpicPanelOpen(projectKey: string) {
  // 라우트가 /projects/:key 단일이라 프로젝트 간 이동 시 컴포넌트가 리마운트되지 않는다 —
  // key 변경을 감지해 상태를 리셋하는 "derive state from props" 패턴.
  const [state, setState] = useState(() => ({ projectKey, open: readStored(projectKey) }));
  if (state.projectKey !== projectKey) {
    setState({ projectKey, open: readStored(projectKey) });
  }

  const toggle = () => {
    setState((prev) => {
      const next = !prev.open;
      try {
        localStorage.setItem(KEY_PREFIX + projectKey, String(next));
      } catch {
        // 저장 실패 시 세션 내 상태만 유지
      }
      return { projectKey: prev.projectKey, open: next };
    });
  };

  return { open: state.open, toggle };
}
```

- [ ] **Step 2: ViewChipBar 에 토글 버튼 추가**

`ViewChipBar.tsx` 수정 — import 에 `PanelLeft` 와 `Button` 추가:

```tsx
import { Pencil, PanelLeft, Plus, Star, Trash2, Users } from 'lucide-react'
// ...
import { Button } from '@/components/ui/button'
```

시그니처 변경:

```tsx
export function ViewChipBar({
  projectKey,
  epicPanelOpen,
  onToggleEpicPanel,
}: {
  projectKey: string
  epicPanelOpen: boolean
  onToggleEpicPanel: () => void
}) {
```

「＋ 뷰 저장」 버튼 바로 다음, `<SaveViewDialog …>` 앞에 삽입:

```tsx
      {/* 에픽 패널 토글 — 우측 끝 고정(ml-auto). shadcn Toggle 프리미티브가 없어
          앱 관례(aria-pressed 토글 버튼)대로 Button + aria-pressed 로 구현. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="epic-panel-toggle"
        aria-pressed={epicPanelOpen}
        onClick={onToggleEpicPanel}
        className={cn('ml-auto rounded-full transition-colors', epicPanelOpen && 'bg-accent')}
      >
        <PanelLeft aria-hidden="true" /> 에픽
      </Button>
```

- [ ] **Step 3: IssueArea 배선 + 전체 높이**

`ProjectDetailPage.tsx` — import 추가:

```tsx
import { useEpicPanelOpen } from '../../hooks/useEpicPanelOpen';
```

`IssueArea` 본문 수정(토글 상태를 끌어올려 형제에 배선, `items-start` → `items-stretch` 로 패널이 목록 높이만큼 늘어나도록):

```tsx
  const [params] = useSearchParams();
  const filters = parseFilters(params);
  const view = parseView(params);
  const groupBy = parseGroupBy(params);
  // 에픽 패널 열림 상태 — ViewChipBar(토글 버튼)와 EpicSidePanel(조건 마운트)이 공유.
  const { open: epicPanelOpen, toggle: toggleEpicPanel } = useEpicPanelOpen(projectKey);

  return (
    <section aria-label="태스크" className="flex items-stretch gap-4">
      {epicPanelOpen && (
        <EpicSidePanel projectKey={projectKey} canCreateIssue={onOpenCreate != null} />
      )}
      <div className="min-w-0 flex-1">
        <ViewChipBar
          projectKey={projectKey}
          epicPanelOpen={epicPanelOpen}
          onToggleEpicPanel={toggleEpicPanel}
        />
```

(나머지 JSX 는 그대로. `canCreateIssue` prop 은 Task 2 에서 `EpicSidePanel` 에 추가되므로, **이 태스크에서는** `<EpicSidePanel projectKey={projectKey} />` 로 두고 Task 2 에서 prop 을 붙인다.)

- [ ] **Step 4: EpicSidePanel 의 접힘 분기 임시 정리**

Task 2 에서 전면 재구성하지만, 이 태스크의 트리를 그린으로 유지하기 위해 최소 수정:
`EpicSidePanel.tsx` 에서 `collapsed` state·`toggleCollapsed`·`if (collapsed) {…}` 블록·헤더의 `«` 버튼(`epic-panel-collapse-toggle`)·`ChevronsLeft/ChevronsRight` import·`COLLAPSE_STORAGE_KEY` 상수를 **삭제**한다. 파일 상단 주석에 "열림/닫힘은 ViewChipBar 의 「에픽」 토글이 단일 진입점(조건 마운트)" 한 줄 추가.

- [ ] **Step 5: E2E 스펙 갱신 (실패 확인 → 수정)**

`e2e/pages/projects/epic-side-panel.spec.ts`:

1. 파일 상단 주석을 새 UX 로 갱신.
2. 공통 헬퍼 추가:

```ts
// 패널은 기본 닫힘 — 각 테스트는 탭 바 토글로 연다.
async function openEpicPanel(page: import('@playwright/test').Page) {
  await page.getByTestId('epic-panel-toggle').click();
  await expect(page.getByTestId('epic-side-panel')).toBeVisible();
}
```

3. 첫 테스트(@smoke)에 진입 직후 검증 추가:

```ts
      await page.goto(`/projects/${PROJECT_KEY}`);

      // 기본 닫힘 + 토글 버튼 노출.
      await expect(page.getByTestId('epic-panel-toggle')).toBeVisible();
      await expect(page.getByTestId('epic-side-panel')).not.toBeAttached();
      await expect(page.getByTestId('epic-panel-toggle')).toHaveAttribute('aria-pressed', 'false');

      await openEpicPanel(page);
      await expect(page.getByTestId('epic-panel-toggle')).toHaveAttribute('aria-pressed', 'true');
```

(이후 기존 단언 유지.)

4. '접기 상태는 새로고침 후에도 유지된다' 테스트를 다음으로 **교체**:

```ts
  test('열림 상태는 새로고침 후에도 프로젝트별로 유지된다', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());
    // 두 번째 프로젝트 — 프로젝트별 독립 영속 검증용.
    await mockApi(page, 'GET', `/api/v1/projects/WP2`, createProject({ key: 'WP2', type: 'TEAM' }));
    await mockApi(page, 'GET', `/api/v1/projects/WP2/members`, []);
    await mockApi(page, 'GET', `/api/v1/projects/WP2/types`, systemTypes());
    await page.route(
      (url) => url.pathname === `/api/v1/projects/WP2/issues`,
      (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      }),
    );
    await routeIssueSearch(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([epic(10, '결제 리뉴얼', 6, 10)])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await openEpicPanel(page);

    // 새로고침 후에도 열림 유지.
    await page.reload();
    await expect(page.getByTestId('epic-side-panel')).toBeVisible();

    // 다른 프로젝트는 독립 — 기본 닫힘.
    await page.goto(`/projects/WP2`);
    await expect(page.getByTestId('epic-side-panel')).not.toBeAttached();
  });
```

5. 'EPIC 유형이 없는 프로젝트' 테스트는 이 태스크에서는 "토글로 열기 전에는 아무것도 없다"만 유지되도록 `await page.goto(...)` 뒤 단언을 `await expect(page.getByTestId('epic-side-panel')).not.toBeAttached()` 그대로 두되, 열었을 때의 동작 검증은 Task 2 에서 추가한다(현행 코드는 `!epicType → null` 이라 열어도 미표시 — Task 2 전까지 허용).
6. 저장소 전체에서 잔존 참조 정리 확인:

Run: `grep -rn "epic-panel-collapse-toggle" apps/workplace-web/src apps/workplace-web/e2e`
Expected: (no matches)

- [ ] **Step 6: 타입 체크 + 대상 E2E 실행**

Run: `cd apps/workplace-web && pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit`
Expected: PASS

Run: `cd apps/workplace-web && npx playwright test e2e/pages/projects/epic-side-panel.spec.ts e2e/pages/projects/epic-hierarchy.spec.ts`
Expected: PASS (epic-hierarchy 가 패널 기본 닫힘으로 깨지면 해당 스펙에도 `openEpicPanel` 스텝 반영)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(web): 에픽 패널 토글을 뷰 탭 바로 일원화(#629) — 기본 닫힘·프로젝트별 영속"
```

---

### Task 2: EpicSidePanel 재구성 — 헤더·A안 아이템·스켈레톤·빈 상태·전체 높이

**Files:**
- Modify: `src/pages/projects/components/EpicSidePanel.tsx` (전면 재구성)
- Test: `e2e/pages/projects/epic-side-panel.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 조건 마운트(패널은 열림 상태에서만 렌더), `openEpicPanel` E2E 헬퍼
- Produces: `EpicSidePanel({ projectKey, canCreateIssue }: { projectKey: string; canCreateIssue?: boolean })`
- Produces: `data-testid` — `epic-panel-count` · `epic-panel-empty` · `epic-panel-skeleton` (기존 `epic-side-panel`·`epic-filter-all`·`epic-filter-<n>` 유지)
- 주의: `if (!epicType) return null` 게이팅 제거 — 열림이면 항상 렌더(빈 상태)

- [ ] **Step 1: 컴포넌트 재구성**

`EpicSidePanel.tsx` 의 렌더 부분을 다음 구조로 교체(데이터 훅·`selectEpic`·`invalidateBodyIssueSearch` 로직은 유지). import 에 `Layers` 추가(`lucide-react`), `Skeleton`(`@/components/ui/skeleton`) 추가:

```tsx
  const epics = epicSearch.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  // 로딩: 유형 목록 로딩 중이거나, EPIC 유형 확정 후 에픽 검색 로딩 중.
  const loading = types.isLoading || (!!epicType && epicSearch.isLoading);

  return (
    <aside
      aria-label="에픽 필터"
      data-testid="epic-side-panel"
      className="flex w-56 shrink-0 flex-col self-stretch border-r pr-3"
    >
      {/* 헤더 — 레이블 + 에픽 개수. 접기 버튼 없음(진입점은 뷰 탭 바 토글). */}
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-xs font-medium text-muted-foreground">에픽</span>
        <span className="text-xs text-muted-foreground" data-testid="epic-panel-count">
          {epics.length}
        </span>
      </div>

      <button
        type="button"
        onClick={() => {
          setParams(filtersToParams({ ...filters, parentNumber: null }, view, groupBy), { replace: true });
          invalidateBodyIssueSearch();
        }}
        aria-pressed={filters.parentNumber == null}
        data-testid="epic-filter-all"
        className={cn(
          'w-full rounded px-2 py-1.5 text-left text-sm transition-colors',
          filters.parentNumber == null ? 'bg-accent font-medium' : 'hover:bg-muted/50',
        )}
      >
        전체 이슈
      </button>

      {/* 「에픽 미할당」 자리 — Task 3 에서 여기에 고정 항목 삽입 */}

      <div className="my-2 border-t" />

      {/* 에픽 목록 — 내부 스크롤(헤더/고정 항목/푸터는 고정). */}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-3 px-2 py-2" data-testid="epic-panel-skeleton">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-2 w-2 rounded-full motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                </div>
                <Skeleton className="ml-4 h-1 w-full rounded-full motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ) : epics.length === 0 ? (
          {/* 빈 상태 — 아이콘+제목+설명(06-feedback-states §B). 다음 행동은 푸터 「＋ 에픽 만들기」. */}
          <div className="flex flex-col items-center gap-2 px-2 py-10 text-center" data-testid="epic-panel-empty">
            <Layers className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">아직 에픽이 없습니다</p>
            <p className="text-xs text-muted-foreground">
              에픽으로 큰 작업을 묶어 진행률을 추적할 수 있습니다
            </p>
          </div>
        ) : (
          epics.map((ep) => {
            const pct = ep.childCount > 0 ? Math.round((ep.childDoneCount / ep.childCount) * 100) : 0;
            const selected = filters.parentNumber === ep.number;
            // avatarColorClass 는 "bg-x-500 text-white" 복합 문자열 — 색점/진행바에는 bg-* 만 사용.
            const colorBg = avatarColorClass(ep.number).split(' ')[0];
            return (
              <button
                key={ep.number}
                type="button"
                onClick={() => selectEpic(ep.number)}
                aria-pressed={selected}
                data-testid={`epic-filter-${ep.number}`}
                className={cn(
                  'w-full rounded px-2 py-1.5 text-left text-sm transition-colors',
                  selected ? 'bg-accent font-medium' : 'hover:bg-muted/50',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', colorBg)} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{ep.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {ep.childDoneCount}/{ep.childCount}
                  </span>
                </span>
                {/* 진행바 — FreshnessBar 패턴(h-1 rounded-full bg-muted 트랙 + 색 채움). button 내부라 span 만 사용. */}
                <span
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="mt-1.5 ml-4 block h-1 overflow-hidden rounded-full bg-muted"
                >
                  <span className={cn('block h-full rounded-full', colorBg)} style={{ width: `${pct}%` }} />
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* 푸터 「＋ 에픽 만들기」 — Task 4 에서 삽입 */}
    </aside>
  );
```

시그니처는 `export function EpicSidePanel({ projectKey, canCreateIssue = false }: { projectKey: string; canCreateIssue?: boolean })` 로 변경(푸터는 Task 4 에서 사용 — 이 태스크에서는 미사용이어도 prop 정의; TS unused 경고가 나면 `void canCreateIssue;` 대신 prop 을 구조분해에서 제외하지 말고 lint 상황에 맞게 처리하되, 가장 단순한 해법은 Task 4 까지 구조분해에 포함하지 않고 타입에만 두는 것: `function EpicSidePanel({ projectKey }: { projectKey: string; canCreateIssue?: boolean })`).
`if (!epicType) return null;` 줄 삭제. `ProjectDetailPage.tsx` 의 `<EpicSidePanel projectKey={projectKey} />` 를 `<EpicSidePanel projectKey={projectKey} canCreateIssue={onOpenCreate != null} />` 로 갱신.

주의: JSX 안에 `{/* */}` 주석을 삼항 분기 내부 최상위에 두면 syntax error — 위 코드 블록을 그대로 옮길 때 빈 상태 분기의 주석은 `<div>` 위가 아니라 안쪽 첫 줄로 이동해야 한다.

- [ ] **Step 2: E2E 추가 (실패 확인)**

`epic-side-panel.spec.ts` 에 추가:

```ts
  test('에픽이 없으면 빈 상태를 보여준다', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());
    await routeIssueSearch(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await openEpicPanel(page);

    await expect(page.getByTestId('epic-panel-empty')).toBeVisible();
    await expect(page.getByTestId('epic-panel-empty')).toContainText('아직 에픽이 없습니다');
    await expect(page.getByTestId('epic-panel-count')).toHaveText('0');
  });

  test('EPIC 유형이 없는 프로젝트도 열면 빈 상태를 보여준다', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    await mockApi(
      page,
      'GET',
      `/api/v1/projects/${PROJECT_KEY}/types`,
      systemTypes().filter((t) => t.name !== 'EPIC'),
    );
    await routeIssueSearch(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await openEpicPanel(page);
    await expect(page.getByTestId('epic-panel-empty')).toBeVisible();
  });
```

기존 'EPIC 유형이 없는 프로젝트에는 패널이 노출되지 않는다' 테스트는 **삭제**(위 테스트로 대체). @smoke 테스트에 진행바 a11y 단언 추가:

```ts
      // 진행바 — 색상 단독 의존 금지(a11y): aria 값으로도 진행률 노출.
      await expect(
        page.getByTestId('epic-filter-10').getByRole('progressbar'),
      ).toHaveAttribute('aria-valuenow', '60');
```

Run: `cd apps/workplace-web && npx playwright test e2e/pages/projects/epic-side-panel.spec.ts`
Expected: 신규 테스트 FAIL (빈 상태 미구현 상태에서 먼저 실행했다면) → 구현 후 PASS

- [ ] **Step 3: 타입 체크 + E2E**

Run: `cd apps/workplace-web && pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit && npx playwright test e2e/pages/projects/epic-side-panel.spec.ts e2e/pages/projects/epic-hierarchy.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): 에픽 패널 UI 재구성(#629) — 전체 높이·진행바·빈 상태·개수 헤더"
```

---

### Task 3: 「에픽 미할당」 고정 필터 항목

**Files:**
- Modify: `src/pages/projects/components/EpicSidePanel.tsx`
- Test: `e2e/pages/projects/epic-side-panel.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 패널 구조(「전체 이슈」 아래 삽입 지점 주석)
- Produces: `data-testid="epic-filter-unassigned"` 항목 — 클릭 시 `typeIds = (전체 유형 − EPIC)`, `parentNumber = null`
- 백엔드 변경 없음: 기존 `filtersToParams` 의 `type` CSV 직렬화 재사용

- [ ] **Step 1: 구현**

`EpicSidePanel.tsx` — 데이터 부분에 추가:

```tsx
  // 「에픽 미할당」 = 기본 목록(topLevel) 중 유형이 EPIC 이 아닌 이슈.
  // 백엔드에 "부모 없음" 전용 파라미터가 없어 typeIds(전체 유형 − EPIC) 로 표현한다.
  const nonEpicTypeIds = (types.data ?? []).filter((t) => t.name !== 'EPIC').map((t) => t.id);
  // 활성 판정: parent 필터 없음 + typeIds 집합이 정확히 (전체 유형 − EPIC).
  // (FacetFilter 로 동일 집합을 직접 만든 경우도 활성으로 취급 — 의미상 동일 필터.)
  const sortedKey = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',');
  const unassignedActive =
    filters.parentNumber == null &&
    nonEpicTypeIds.length > 0 &&
    filters.typeIds.length > 0 &&
    sortedKey(filters.typeIds) === sortedKey(nonEpicTypeIds);

  // 미할당 토글 — 활성 상태에서 재클릭하면 유형 필터를 비워 「전체 이슈」 상태로 복귀.
  function selectUnassigned() {
    const next = unassignedActive ? [] : nonEpicTypeIds;
    setParams(
      filtersToParams({ ...filters, parentNumber: null, typeIds: next }, view, groupBy),
      { replace: true },
    );
    // 해제(빈 필터 복귀)는 캐시된 동일 queryKey 로 돌아가므로 무효화 필요(선택 해제와 동일 근거).
    if (unassignedActive) invalidateBodyIssueSearch();
  }
```

「전체 이슈」 버튼의 `onClick`/`aria-pressed`/활성 클래스를 미할당과 상호배타로 보정:

```tsx
        onClick={() => {
          setParams(
            filtersToParams(
              // 미할당 활성 중이면 그 유형 필터도 함께 해제 — 사용자가 직접 건 유형 필터는 보존.
              { ...filters, parentNumber: null, typeIds: unassignedActive ? [] : filters.typeIds },
              view,
              groupBy,
            ),
            { replace: true },
          );
          invalidateBodyIssueSearch();
        }}
        aria-pressed={filters.parentNumber == null && !unassignedActive}
```

(활성 클래스 조건도 `filters.parentNumber == null && !unassignedActive` 로 동일하게.)

「전체 이슈」 버튼 아래(Task 2 의 삽입 지점 주석 자리)에, EPIC 유형이 있을 때만:

```tsx
      {epicType && (
        <button
          type="button"
          onClick={selectUnassigned}
          aria-pressed={unassignedActive}
          data-testid="epic-filter-unassigned"
          className={cn(
            'w-full rounded px-2 py-1.5 text-left text-sm transition-colors',
            unassignedActive ? 'bg-accent font-medium' : 'hover:bg-muted/50',
          )}
        >
          에픽 미할당
        </button>
      )}
```

- [ ] **Step 2: E2E 추가**

```ts
  test('에픽 미할당 클릭 시 EPIC 제외 유형 필터가 적용되고, 재클릭 시 해제된다', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());

    let lastBodyIssuesUrl: URL | null = null;
    await routeIssueSearch(page, async (route, url) => {
      if (url.searchParams.get('type') === String(makeEpicType().id)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([epic(10, '결제 리뉴얼', 6, 10)])),
        });
        return;
      }
      lastBodyIssuesUrl = url;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await openEpicPanel(page);

    // 클릭 → type=(EPIC 제외 전 유형) 쿼리로 본문 이슈 검색.
    const expected = systemTypes()
      .filter((t) => t.name !== 'EPIC')
      .map((t) => t.id)
      .sort((a, b) => a - b)
      .join(',');
    await page.getByTestId('epic-filter-unassigned').click();
    await expect
      .poll(() =>
        (lastBodyIssuesUrl?.searchParams.get('type') ?? '')
          .split(',')
          .filter(Boolean)
          .map(Number)
          .sort((a, b) => a - b)
          .join(','),
      )
      .toBe(expected);
    await expect(page.getByTestId('epic-filter-unassigned')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('epic-filter-all')).toHaveAttribute('aria-pressed', 'false');

    // 재클릭 → 해제(전체 이슈 상태 복귀).
    await page.getByTestId('epic-filter-unassigned').click();
    await expect.poll(() => lastBodyIssuesUrl?.searchParams.get('type')).toBeNull();
    await expect(page.getByTestId('epic-filter-all')).toHaveAttribute('aria-pressed', 'true');
  });
```

'EPIC 유형이 없는 프로젝트' 테스트에 단언 추가:

```ts
    await expect(page.getByTestId('epic-filter-unassigned')).not.toBeAttached();
```

- [ ] **Step 3: 타입 체크 + E2E**

Run: `cd apps/workplace-web && pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit && npx playwright test e2e/pages/projects/epic-side-panel.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): 에픽 미할당 필터 항목 추가(#629) — EPIC 제외 유형 필터 재사용"
```

---

### Task 4: 「＋ 에픽 만들기」 푸터 + IssueCreateDialog EPIC 프리셋

**Files:**
- Modify: `src/pages/projects/components/IssueCreateDialog.tsx`
- Modify: `src/pages/projects/components/EpicSidePanel.tsx`
- Test: `e2e/pages/projects/epic-side-panel.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `canCreateIssue` prop(타입에 정의됨), 푸터 삽입 지점 주석
- Produces: `IssueCreateDialog` 신규 prop `initialTypeId?: number` — 유형 기본값을 TASK 대신 해당 id 로

- [ ] **Step 1: IssueCreateDialog 에 `initialTypeId` 추가**

시그니처:

```tsx
export function IssueCreateDialog({
  projectKey, open, onOpenChange, personal = false, initialTypeId,
}: {
  projectKey: string; open: boolean; onOpenChange: (v: boolean) => void; personal?: boolean;
  // 유형 기본값 오버라이드 — 에픽 패널 「＋ 에픽 만들기」가 EPIC id 를 넘긴다. 미지정 시 기존 TASK 기본.
  initialTypeId?: number;
}) {
```

기본값 effect 의 `setValue` 부분 교체:

```tsx
    const task = list.find((t) => t.name === 'TASK');
    // initialTypeId 우선(존재하는 유형일 때만) → TASK → 첫 항목.
    const preferred = initialTypeId != null ? list.find((t) => t.id === initialTypeId) : undefined;
    setValue('typeId', preferred?.id ?? task?.id ?? list[0].id);
```

- [ ] **Step 2: EpicSidePanel 푸터 구현**

`EpicSidePanel.tsx` — 구조분해에 `canCreateIssue = false` 포함, `useState` 로 `createOpen` 추가, `Plus` import, `IssueCreateDialog` import. `</aside>` 닫기 직전(푸터 삽입 지점)에:

```tsx
      {/* 푸터 — 빈 상태의 "다음 행동"이자 상시 생성 진입점. 생성 권한 + EPIC 유형이 있을 때만. */}
      {canCreateIssue && epicType && (
        <div className="mt-2 border-t pt-2">
          <button
            type="button"
            data-testid="epic-create-button"
            onClick={() => setCreateOpen(true)}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> 에픽 만들기
          </button>
          <IssueCreateDialog
            projectKey={projectKey}
            open={createOpen}
            onOpenChange={setCreateOpen}
            initialTypeId={epicType.id}
          />
        </div>
      )}
```

- [ ] **Step 3: E2E 추가**

주의: `stubProjectMeta` 의 프로젝트 목킹이 `viewerIsMember` 를 포함해야 푸터가 보인다 — `createProject({ key: PROJECT_KEY, type: 'TEAM', viewerIsMember: true })` 로 갱신(팩토리 기본값이 이미 true 면 그대로).

```ts
  test('＋ 에픽 만들기 클릭 시 EPIC 유형이 프리셋된 생성 다이얼로그가 열린다', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());
    await routeIssueSearch(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await openEpicPanel(page);

    await page.getByTestId('epic-create-button').click();
    // 유형 select 가 EPIC 라벨로 프리셋 — getIssueTypeLabel('EPIC') 표기와 일치해야 함.
    await expect(page.getByTestId('create-type-select')).toContainText('에픽');
  });
```

(라벨 '에픽'은 `src/lib/issueTypeLabels.ts` 의 `getIssueTypeLabel('EPIC')` 반환값을 확인해 그 값으로 단언한다 — 다르면 실제 값으로 교체.)

- [ ] **Step 4: 타입 체크 + E2E**

Run: `cd apps/workplace-web && pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit && npx playwright test e2e/pages/projects/epic-side-panel.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): 에픽 패널 푸터 에픽 만들기 + 생성 다이얼로그 EPIC 프리셋(#629)"
```

---

### Task 5: 회귀·디자인 검증 게이트

**Files:**
- Modify: 발견된 회귀 스펙(있다면)
- 산출물: 라이트/다크 스크린샷(`test-results/exploratory/epic-panel/<timestamp>/screenshots/`)

**Interfaces:**
- Consumes: Task 1~4 전체

- [ ] **Step 1: 잔존 참조·회귀 스캔**

Run: `grep -rn "epic-panel-collapse-toggle\|epicSidePanel.collapsed" apps/workplace-web`
Expected: (no matches)

Run: `grep -rln "epic-side-panel\|epic-filter-" apps/workplace-web/e2e`
나온 스펙 파일 각각에 대해 기본 닫힘 전제(열기 스텝) 위반 여부 확인·보정.

- [ ] **Step 2: 프론트 전체 게이트**

Run: `cd apps/workplace-web && pnpm lint && pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit`
Expected: PASS

Run: `cd apps/workplace-web && pnpm test:e2e`
Expected: PASS (본 변경과 무관한 기존 flake 는 격리 재실행으로 판별)

- [ ] **Step 3: 디자인 가이드라인 리뷰**

`web-design-guidelines` 스킬로 변경 파일(`EpicSidePanel.tsx`·`ViewChipBar.tsx`·`ProjectDetailPage.tsx`) 리뷰 → 지적사항 수정 후 재실행. `docs/design-system/` 규칙(시맨틱 토큰·hover/선택 분리·focus-visible·아이콘 aria) 준수 확인.

- [ ] **Step 4: 브라우저 시각 검증 (생략 불가 — feedback-ui-must-visually-verify)**

로컬 스택(`pnpm dev` + API 9090)에서 실제 브라우저로:
- 패널 열림/닫힘 토글, 전체 높이(경계선 끊김 없음)
- 에픽 다수(스크롤)·0개(빈 상태) 두 케이스
- 라이트/다크 모드 각각 — 선택 `bg-accent` 대비 육안 확인
- 스크린샷을 `test-results/exploratory/epic-panel/<timestamp>/screenshots/` 에 저장

- [ ] **Step 5: Commit (보정분)**

```bash
git add -A && git commit -m "test(web): 에픽 패널 재설계 회귀 보정 및 검증(#629)"
```

---

## Self-Review 결과

- 스펙 §3.1(토글)→Task 1, §3.2(패널 A안·빈 상태·스켈레톤)→Task 2, §4.3(미할당)→Task 3, §3.2-7(푸터)+§4.4(initialTypeId)→Task 4, §6(검증 게이트)→Task 5. 미할당 개수 배지는 스펙에서 1차 제외 — 태스크 없음(의도적).
- `canCreateIssue` prop 은 Task 2 타입 정의 → Task 4 사용으로 명시.
- localStorage 키·testid 명칭 태스크 간 일치 확인(`epicSidePanel.open.<key>`, `epic-panel-toggle`, `epic-filter-unassigned`, `epic-create-button`).
