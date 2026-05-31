# Phase 7d — 홈 AI Chat 세션 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 홈 캔버스에 세션 스위처(▾)·복원(대화 transcript + 캔버스 재구성, AI 재호출 없음)·새 세션·삭제 UI 를 추가한다. (#49, 에픽 #45 마지막)

**Architecture:** 7a 백엔드 세션 CRUD(4종 엔드포인트)는 완비. 7d 는 **순수 web**. 핵심은 (1) `sessionId`+`turns` 를 `FloatingChat` 밖 `useHomeSession` 훅으로 끌어올려 스위처/챗/캔버스 3자를 한 곳에서 전이, (2) 복원은 **기본 구성으로 시드 후 ASSISTANT 위젯 배치를 라이브 compose 와 동일한 `applyBatch` 경로로 fold**(reducer 의 `apply` 와 코드 공유 — 드리프트 방지). 새로고침은 **기본 구성 + 스위처 복원**(7c 의 즉시·AI-free 마운트 유지; 설계 §7 "마지막 세션 or 기본 구성" 이 허용). "＋새 세션" 은 POST 안 하고 **로컬 리셋**(첫 compose 가 서버에서 세션 생성 — 빈 무제목 세션 방지).

**Tech Stack:** React 19 + TS, TanStack Query v5, shadcn/ui(dropdown-menu), Vitest(순수 로직), Playwright E2E(UI 플로우).

---

## 백엔드 계약 (7a, 변경 없음 — 참조용)

- `GET  /api/v1/home/sessions?size=` → `{ items: HomeSessionSummary[], nextCursor: string|null }`
  - `HomeSessionSummary = { id: UUID, title: string, lastMessageAt: Instant, widgetCount: int }`
- `GET  /api/v1/home/sessions/{id}/messages` → `HomeMessageResponse[]`
  - `HomeMessageResponse = { id: long, role: "USER"|"ASSISTANT", content: string, widgets: JsonNode|null, createdAt: Instant }`
  - 정렬 `created_at ASC`. ASSISTANT 의 `widgets` 가 캔버스 복원 원천. USER 는 `widgets:null`.
- `DELETE /api/v1/home/sessions/{id}` → 204
- `POST /api/v1/home/compose {sessionId, query}` → `{ sessionId, message, widgets }` (sessionId null 이면 서버가 새 세션 생성 + 제목 자동). **7d 에서 변경 없음.**
- 제목은 백엔드가 첫 USER 메시지로 자동 생성 — **UI 는 표시만**(클라이언트 제목 생성 X).

## 파일 구조

- **수정** `src/types/home.ts` — `ChatTurn`(이동)·`HomeSessionSummary`·`HomeSessionPage`·`HomeMessage` 추가
- **수정** `src/api/home.ts` — `listSessions`·`sessionMessages`·`deleteSession`
- **수정** `src/hooks/queries/useHomeQueries.ts` — `homeKeys.sessions`·`useSessions`·`useDeleteSession`; `useHomeCompose` 에 세션목록 invalidate
- **수정** `src/hooks/useCanvasState.ts` — `applyBatch`/`defaultState`/`restoreState` 추출 + `restore` 액션
- **생성** `src/hooks/useCanvasState.test.ts` — `restoreState` 단위 테스트(Vitest)
- **생성** `src/lib/home-restore.ts` — `parseRestoredSession` 순수 매퍼
- **생성** `src/lib/home-restore.test.ts` — 단위 테스트(Vitest)
- **생성** `src/hooks/useHomeSession.ts` — 세션 상태 코디네이터
- **생성** `src/components/home/SessionSwitcher.tsx` — 스위처 드롭다운
- **수정** `src/components/home/FloatingChat.tsx` — controlled(turns/pending/onSubmit props)
- **수정** `src/components/home/HomeShell.tsx` — `useHomeSession` + 캔버스 헤더(스위처) 배선
- **수정** `e2e/fixtures/auth.fixture.ts` — `GET /home/sessions` 빈 스텁
- **수정** `e2e/pages/home.spec.ts` — 새세션·복원·삭제 E2E

---

### Task 1: 세션 타입 + API + 쿼리 훅 + compose invalidate

**Files:**
- Modify: `src/types/home.ts`
- Modify: `src/api/home.ts`
- Modify: `src/hooks/queries/useHomeQueries.ts`

- [ ] **Step 1: 타입 추가** — `src/types/home.ts`. 기존 `ComposeResponse` 아래에 추가. 그리고 `FloatingChat` 의 로컬 `ChatTurn` 을 여기로 이동(다른 모듈이 공유).

```ts
/** 챗 말풍선 한 턴. (FloatingChat 로컬 정의에서 이동 — 복원 매퍼/세션 훅이 공유) */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** 세션 스위처 목록 항목 (GET /home/sessions). */
export interface HomeSessionSummary {
  id: string;
  title: string;
  lastMessageAt: string; // ISO 8601
  widgetCount: number;
}

/** 세션 목록 페이지(커서 페이지네이션). */
export interface HomeSessionPage {
  items: HomeSessionSummary[];
  nextCursor: string | null;
}

/** 복원용 메시지 (GET /home/sessions/{id}/messages). ASSISTANT 의 widgets 가 캔버스 복원 원천. */
export interface HomeMessage {
  id: number;
  role: 'USER' | 'ASSISTANT';
  content: string;
  widgets: WidgetSpec[] | null;
  createdAt: string; // ISO 8601
}
```

- [ ] **Step 2: API 함수 추가** — `src/api/home.ts`. import 에 `HomeMessage, HomeSessionPage` 추가하고 `homeApi` 에 3개 추가.

```ts
  /** 세션 목록(스위처). */
  listSessions: (size = 30) =>
    client.get<HomeSessionPage>('/home/sessions', { params: { size } }),

  /** 세션 전체 메시지(복원용). */
  sessionMessages: (sessionId: string) =>
    client.get<HomeMessage[]>(`/home/sessions/${sessionId}/messages`),

  /** 세션 삭제. */
  deleteSession: (sessionId: string) =>
    client.delete<void>(`/home/sessions/${sessionId}`),
```

- [ ] **Step 3: 쿼리 훅 + invalidate** — `src/hooks/queries/useHomeQueries.ts`. `useQueryClient` import, `homeKeys.sessions` 추가, `useSessions`/`useDeleteSession` 추가, `useHomeCompose` 에 `onSuccess` invalidate 추가.

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
// ... homeKeys 에 추가:
  sessions: () => [...homeKeys.all, 'sessions'] as const,

/** 세션 목록 — 스위처. */
export function useSessions() {
  return useQuery({
    queryKey: homeKeys.sessions(),
    queryFn: () => homeApi.listSessions().then((r) => r.data),
  });
}

/** 세션 삭제 — 성공 시 목록 갱신. */
export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => homeApi.deleteSession(sessionId).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: homeKeys.sessions() }),
    onError: (err) => handleApiError(err, '세션 삭제에 실패했어요'),
  });
}
```

`useHomeCompose` 를 다음으로 교체(세션 생성/last_message_at 변화를 스위처에 반영):

```ts
export function useHomeCompose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ComposeRequest) => homeApi.compose(body).then((r) => r.data),
    // 새 세션 생성/마지막 메시지 시각 갱신을 스위처 목록에 반영.
    onSuccess: () => qc.invalidateQueries({ queryKey: homeKeys.sessions() }),
    onError: (err) => handleApiError(err, 'AI 구성에 실패했어요'),
  });
}
```

- [ ] **Step 4: 타입체크** — Run: `cd apps/workplace-web && pnpm typecheck`. Expected: PASS. (이 태스크는 순수 배선 — 단위테스트 없이 typecheck + 이후 E2E 로 검증.)

- [ ] **Step 5: Commit**

```bash
git add apps/workplace-web/src/types/home.ts apps/workplace-web/src/api/home.ts apps/workplace-web/src/hooks/queries/useHomeQueries.ts
git commit -m "feat(web): home 세션 타입/API/쿼리 훅 + compose 시 세션목록 invalidate — #49"
```

---

### Task 2: useCanvasState 복원(restore) — applyBatch 추출 + 단위 테스트

**핵심 정확성 게이트.** 복원은 **빈 상태가 아니라 기본 구성으로 시드** 후 fold 해야 라이브 compose 와 동일(빈 시드면 `page:'current'` 첫 배치에서 `active` 가 undefined → 깨진 페이지; `page:'new'` 첫 배치면 기본 페이지가 라이브와 달리 사라짐).

**Files:**
- Modify: `src/hooks/useCanvasState.ts`
- Test: `src/hooks/useCanvasState.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `src/hooks/useCanvasState.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import type { WidgetSpec } from '@/types/home';

import { restoreState } from './useCanvasState';

const DEF: WidgetSpec[] = [{ type: 'my_tasks' }];
const types = (page: { widgets: { spec: WidgetSpec }[] }) => page.widgets.map((w) => w.spec.type);

describe('restoreState', () => {
  it('빈 배치 → 기본 구성 단일 페이지', () => {
    const s = restoreState(DEF, []);
    expect(s.pages).toHaveLength(1);
    expect(types(s.pages[0])).toEqual(['my_tasks']);
    expect(s.activeIndex).toBe(0);
  });

  it('page:current 첫 배치 → 기본 페이지 replace-all(페이지 수 유지)', () => {
    const batch: WidgetSpec[] = [{ type: 'issue_list', layout: { page: 'current' } }];
    const s = restoreState(DEF, [batch]);
    expect(s.pages).toHaveLength(1);
    expect(types(s.pages[0])).toEqual(['issue_list']);
  });

  it('page:new 첫 배치 → 기본 페이지 보존 + 새 페이지 추가/이동(라이브와 동일)', () => {
    const batch: WidgetSpec[] = [{ type: 'issue_detail', layout: { page: 'new', pageLabel: 'PROJ-1' } }];
    const s = restoreState(DEF, [batch]);
    expect(s.pages).toHaveLength(2);
    expect(types(s.pages[0])).toEqual(['my_tasks']); // 기본 보존
    expect(s.pages[1].label).toBe('PROJ-1');
    expect(s.activeIndex).toBe(1);
  });

  it('여러 배치 fold(current→new)', () => {
    const b1: WidgetSpec[] = [{ type: 'issue_list', layout: { page: 'current' } }];
    const b2: WidgetSpec[] = [{ type: 'activity', layout: { page: 'new' } }];
    const s = restoreState(DEF, [b1, b2]);
    expect(s.pages).toHaveLength(2);
    expect(types(s.pages[0])).toEqual(['issue_list']);
    expect(types(s.pages[1])).toEqual(['activity']);
    expect(s.activeIndex).toBe(1);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `cd apps/workplace-web && pnpm test -- useCanvasState`. Expected: FAIL (`restoreState` is not exported).

- [ ] **Step 3: 리팩터 + 구현** — `src/hooks/useCanvasState.ts`. `reducer` 안의 분기 로직을 순수 헬퍼로 추출하고 `restore` 액션/`restoreState` export 추가.

기존 `loadDefault`/`apply` 케이스 본문을 헬퍼로 교체:

```ts
// 기본 구성 단일 페이지 상태 생성.
function defaultState(specs: WidgetSpec[]): CanvasState {
  const page: CanvasPage = { id: nextId('p'), label: '홈', widgets: toWidgets(specs) };
  return { pages: [page], activeIndex: 0 };
}

// 위젯 배치 1개를 상태에 적용 — page='new' 면 새 페이지 추가+이동, 그 외엔 활성 페이지 replace-all.
// (apply 액션과 복원 fold 가 공유 — 동작 드리프트 방지)
function applyBatch(state: CanvasState, specs: WidgetSpec[]): CanvasState {
  if (specs.length === 0) return state;
  const first = specs[0].layout;
  if (first?.page === 'new') {
    const page: CanvasPage = {
      id: nextId('p'),
      label: first.pageLabel ?? '새 구성',
      widgets: toWidgets(specs),
    };
    return { pages: [...state.pages, page], activeIndex: state.pages.length };
  }
  const pages = [...state.pages];
  const idx = state.activeIndex;
  const active = pages[idx] ?? pages[0];
  // layout.replace(위젯 단위 교체)는 7c~7d 미지원(클라 생성 id 를 백엔드가 echo 불가). 계약 타입만 유지.
  pages[idx] = { ...active, widgets: toWidgets(specs) };
  return { ...state, pages };
}

/** 복원: 기본 구성으로 시드 후 ASSISTANT 위젯 배치를 순서대로 fold(라이브 compose 와 동일 경로). */
export function restoreState(defaultSpecs: WidgetSpec[], batches: WidgetSpec[][]): CanvasState {
  let next = defaultState(defaultSpecs);
  for (const batch of batches) next = applyBatch(next, batch);
  return next;
}
```

`Action` 유니온에 추가:

```ts
  | { type: 'restore'; defaultSpecs: WidgetSpec[]; batches: WidgetSpec[][] };
```

`reducer` 케이스를 다음으로 교체:

```ts
    case 'loadDefault':
      // 기본 구성 — 단일 페이지로 초기화(AI 호출 없음).
      return defaultState(action.specs);
    case 'apply':
      return applyBatch(state, action.specs);
    case 'restore':
      // 메시지 복원 — 기본 시드 후 배치 fold(AI 재호출 없음).
      return restoreState(action.defaultSpecs, action.batches);
    case 'setActive':
      return { ...state, activeIndex: action.index };
```

훅에 `restore` 추가:

```ts
  const restore = useCallback(
    (defaultSpecs: WidgetSpec[], batches: WidgetSpec[][]) =>
      dispatch({ type: 'restore', defaultSpecs, batches }),
    [],
  );
  return { ...state, loadDefault, apply, setActive, restore };
```

- [ ] **Step 4: 통과 확인** — Run: `cd apps/workplace-web && pnpm test -- useCanvasState`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/workplace-web/src/hooks/useCanvasState.ts apps/workplace-web/src/hooks/useCanvasState.test.ts
git commit -m "feat(web): useCanvasState restore — 기본 시드 후 위젯 배치 fold(applyBatch 공유) — #49"
```

---

### Task 3: parseRestoredSession 순수 매퍼 + 단위 테스트

**Files:**
- Create: `src/lib/home-restore.ts`
- Test: `src/lib/home-restore.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `src/lib/home-restore.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import type { HomeMessage } from '@/types/home';

import { parseRestoredSession } from './home-restore';

const msgs: HomeMessage[] = [
  { id: 1, role: 'USER', content: '내 이슈', widgets: null, createdAt: 't1' },
  { id: 2, role: 'ASSISTANT', content: '여기요', widgets: [{ type: 'issue_list' }], createdAt: 't2' },
  { id: 3, role: 'USER', content: '그 중 HIGH', widgets: null, createdAt: 't3' },
  { id: 4, role: 'ASSISTANT', content: '필터링', widgets: [{ type: 'issue_list', params: { priority: 'HIGH' } }], createdAt: 't4' },
];

describe('parseRestoredSession', () => {
  it('역할 매핑(대문자→소문자) + 순서 보존', () => {
    const { turns } = parseRestoredSession(msgs);
    expect(turns).toEqual([
      { role: 'user', content: '내 이슈' },
      { role: 'assistant', content: '여기요' },
      { role: 'user', content: '그 중 HIGH' },
      { role: 'assistant', content: '필터링' },
    ]);
  });

  it('ASSISTANT widgets(non-null, 비어있지 않음)만 배치로 수집', () => {
    const { widgetBatches } = parseRestoredSession(msgs);
    expect(widgetBatches).toHaveLength(2);
    expect(widgetBatches[1][0].params).toEqual({ priority: 'HIGH' });
  });

  it('빈/위젯없는 ASSISTANT 는 배치 제외', () => {
    const r = parseRestoredSession([
      { id: 1, role: 'ASSISTANT', content: '음', widgets: [], createdAt: 't' },
      { id: 2, role: 'ASSISTANT', content: '음2', widgets: null, createdAt: 't' },
    ]);
    expect(r.widgetBatches).toEqual([]);
    expect(r.turns).toHaveLength(2);
  });

  it('빈 메시지 → 빈 결과', () => {
    expect(parseRestoredSession([])).toEqual({ turns: [], widgetBatches: [] });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `cd apps/workplace-web && pnpm test -- home-restore`. Expected: FAIL (module not found).

- [ ] **Step 3: 구현** — `src/lib/home-restore.ts`

```ts
import type { ChatTurn, HomeMessage, WidgetSpec } from '@/types/home';

/**
 * 복원: 세션 메시지 목록 → 대화 transcript(턴) + ASSISTANT 위젯 배치 목록.
 * - role 은 백엔드 대문자(USER/ASSISTANT) → 프론트 소문자(user/assistant)로 매핑.
 * - USER 는 widgets 없음. ASSISTANT 의 non-null·비어있지 않은 widgets 만 캔버스 fold 배치로 수집.
 * - 입력은 created_at ASC(7a 보장) — 그대로 순서 유지(역순 X).
 */
export function parseRestoredSession(messages: HomeMessage[]): {
  turns: ChatTurn[];
  widgetBatches: WidgetSpec[][];
} {
  const turns: ChatTurn[] = [];
  const widgetBatches: WidgetSpec[][] = [];
  for (const m of messages) {
    turns.push({ role: m.role === 'ASSISTANT' ? 'assistant' : 'user', content: m.content });
    if (m.role === 'ASSISTANT' && m.widgets && m.widgets.length > 0) {
      widgetBatches.push(m.widgets);
    }
  }
  return { turns, widgetBatches };
}
```

- [ ] **Step 4: 통과 확인** — Run: `cd apps/workplace-web && pnpm test -- home-restore`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/workplace-web/src/lib/home-restore.ts apps/workplace-web/src/lib/home-restore.test.ts
git commit -m "feat(web): parseRestoredSession — 세션 메시지→transcript+위젯배치 매퍼 — #49"
```

---

### Task 4: useHomeSession 코디네이터 훅

`sessionId`+`turns`+캔버스를 한 곳에서 전이. 세 전이: `submitQuery`(compose), `newSession`(로컬 리셋), `restoreSession`(메시지 fetch→재현). 삭제는 활성 세션이면 리셋.

**Files:**
- Create: `src/hooks/useHomeSession.ts`

- [ ] **Step 1: 구현** — `src/hooks/useHomeSession.ts`

```ts
import { useCallback, useEffect, useState } from 'react';

import { homeApi } from '@/api/home';
import { useDeleteSession, useHomeCompose } from '@/hooks/queries/useHomeQueries';
import { useCanvasState } from '@/hooks/useCanvasState';
import { handleApiError } from '@/lib/api-error';
import { parseRestoredSession } from '@/lib/home-restore';
import type { ChatTurn, WidgetSpec } from '@/types/home';

/**
 * 홈 세션 상태 코디네이터 — sessionId / 대화 transcript / 캔버스를 한 곳에서 전이.
 * defaultSpecs 는 안정 참조(모듈 const)여야 한다(마운트 effect/콜백 deps 안정).
 */
export function useHomeSession(defaultSpecs: WidgetSpec[]) {
  const canvas = useCanvasState();
  const { loadDefault, apply, restore } = canvas;
  const compose = useHomeCompose();
  const del = useDeleteSession();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);

  // 마운트 시 기본 구성 1회 로드(AI 미호출, 7c 동작 유지).
  useEffect(() => {
    loadDefault(defaultSpecs);
  }, [loadDefault, defaultSpecs]);

  // 챗 명령 → compose. 성공 시 sessionId 추적 + assistant 턴 + 캔버스 재구성.
  const submitQuery = useCallback(
    (query: string) => {
      setTurns((t) => [...t, { role: 'user', content: query }]);
      compose.mutate(
        { sessionId, query },
        {
          onSuccess: (res) => {
            setSessionId(res.sessionId);
            setTurns((t) => [...t, { role: 'assistant', content: res.message }]);
            apply(res.widgets);
          },
        },
      );
    },
    [compose, sessionId, apply],
  );

  // 새 세션 — 로컬 리셋만(POST 안 함; 첫 compose 가 서버에서 세션 생성).
  const newSession = useCallback(() => {
    setSessionId(null);
    setTurns([]);
    loadDefault(defaultSpecs);
  }, [loadDefault, defaultSpecs]);

  // 복원 — 메시지 fetch → transcript 재현 + 위젯 배치 fold(AI 재호출 없음).
  const restoreSession = useCallback(
    async (id: string) => {
      try {
        const { data } = await homeApi.sessionMessages(id);
        const { turns: restored, widgetBatches } = parseRestoredSession(data);
        setSessionId(id);
        setTurns(restored);
        restore(defaultSpecs, widgetBatches);
      } catch (err) {
        handleApiError(err, '세션을 불러오지 못했어요');
      }
    },
    [restore, defaultSpecs],
  );

  // 삭제 — 활성 세션이면 새 세션으로 리셋.
  const deleteSession = useCallback(
    (id: string) => {
      del.mutate(id, {
        onSuccess: () => {
          if (id === sessionId) newSession();
        },
      });
    },
    [del, sessionId, newSession],
  );

  return {
    pages: canvas.pages,
    activeIndex: canvas.activeIndex,
    setActive: canvas.setActive,
    sessionId,
    turns,
    pending: compose.isPending,
    submitQuery,
    newSession,
    restoreSession,
    deleteSession,
  };
}
```

- [ ] **Step 2: 타입체크** — Run: `cd apps/workplace-web && pnpm typecheck`. Expected: PASS. (훅 통합 동작은 Task 7 E2E 로 검증.)

- [ ] **Step 3: Commit**

```bash
git add apps/workplace-web/src/hooks/useHomeSession.ts
git commit -m "feat(web): useHomeSession — 세션/transcript/캔버스 전이 코디네이터 — #49"
```

---

### Task 5: SessionSwitcher 컴포넌트

캔버스 헤더 드롭다운: 현재 세션 제목 ▾, `＋새 세션` + 최근 세션 목록(제목·상대시각·위젯 수)·행별 삭제. 삭제는 v1 즉시(확인 모달은 fast-follow). 드롭다운 open 은 자체 제어 — 새세션/선택 시 닫고, 삭제는 열어둠(목록 갱신 확인).

**Files:**
- Create: `src/components/home/SessionSwitcher.tsx`

- [ ] **Step 1: 구현** — `src/components/home/SessionSwitcher.tsx`

```tsx
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { HomeSessionSummary } from '@/types/home';

interface Props {
  sessions: HomeSessionSummary[];
  currentSessionId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

// 상대 시각(분/시간/일) 간단 표기.
function relTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/** 캔버스 헤더 세션 스위처 — 현재 세션 제목 ▾, ＋새 세션 + 최근 세션 목록·삭제. */
export function SessionSwitcher({ sessions, currentSessionId, onNew, onSelect, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const current = sessions.find((s) => s.id === currentSessionId);
  const label = current?.title ?? '새 세션';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="flex items-center gap-1 rounded px-2 py-1 text-sm font-medium hover:bg-muted"
        data-testid="session-switcher"
      >
        {label}
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuItem
          data-testid="session-new"
          onSelect={() => {
            setOpen(false);
            onNew();
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> 새 세션
        </DropdownMenuItem>
        {sessions.length > 0 && <DropdownMenuSeparator />}
        {sessions.map((s) => (
          // 행 자체는 비-DropdownMenuItem div(삭제 버튼과 onSelect 충돌 방지). open 은 수동 제어.
          <div
            key={s.id}
            data-testid="session-item"
            className={cn(
              'flex items-center gap-2 rounded px-2 py-1.5 text-sm',
              s.id === currentSessionId && 'bg-ai-accent-subtle',
            )}
          >
            <button
              type="button"
              data-testid="session-select"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                setOpen(false);
                onSelect(s.id);
              }}
            >
              <div className="truncate">{s.title}</div>
              <div className="text-xs text-muted-foreground">
                {relTime(s.lastMessageAt)} · 위젯 {s.widgetCount}
              </div>
            </button>
            <button
              type="button"
              aria-label="세션 삭제"
              data-testid="session-delete"
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(s.id)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: 타입체크** — Run: `cd apps/workplace-web && pnpm typecheck`. Expected: PASS. (`lucide-react`·`dropdown-menu` 존재 확인 후 진행. 렌더 검증은 Task 7 E2E.)

- [ ] **Step 3: Commit**

```bash
git add apps/workplace-web/src/components/home/SessionSwitcher.tsx
git commit -m "feat(web): SessionSwitcher — 세션 스위처 드롭다운(새세션·목록·삭제) — #49"
```

---

### Task 6: FloatingChat controlled 전환 + HomeShell 헤더 배선

`FloatingChat` 이 `turns`/`pending`/`onSubmit` 을 props 로 받는 controlled 컴포넌트로. `HomeShell` 은 `useHomeSession` + `useSessions` 로 헤더(스위처)·캔버스·챗을 배선.

**Files:**
- Modify: `src/components/home/FloatingChat.tsx`
- Modify: `src/components/home/HomeShell.tsx`

- [ ] **Step 1: FloatingChat controlled 전환** — 전체 교체.

```tsx
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ChatTurn } from '@/types/home';

interface Props {
  /** 대화 transcript(상위 useHomeSession 소유). */
  turns: ChatTurn[];
  /** compose 진행 중 여부. */
  pending: boolean;
  /** 입력 제출 → 상위가 compose 실행. */
  onSubmit: (query: string) => void;
}

/** 떠있는 챗 레이어 — 평소 입력창만, ⌘K/포커스 시 패널 펼침, 응답 완료 시 자동 접힘. 상태는 상위 소유(controlled). */
export function FloatingChat({ turns, pending, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const prevPending = useRef(false);

  // ⌘K / Ctrl+K 토글.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => {
          const next = !v;
          if (next) setTimeout(() => inputRef.current?.focus(), 0);
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 응답 완료(pending true→false) 시 자동 접힘(결과 전면).
  useEffect(() => {
    if (prevPending.current && !pending) setOpen(false);
    prevPending.current = pending;
  }, [pending]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || pending) return;
    onSubmit(query);
    setInput('');
  };

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="챗 닫기"
          className="fixed inset-0 z-10 bg-background/60"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col items-center">
        {open && (
          <div
            className="mb-2 max-h-[50vh] w-full max-w-2xl overflow-auto rounded-lg border bg-card p-3 shadow-lg"
            data-testid="chat-panel"
          >
            {turns.length === 0 ? (
              <p className="text-sm text-muted-foreground">무엇을 보여드릴까요? (예: "이번 주 마감인 내 HIGH 이슈")</p>
            ) : (
              <ul className="space-y-2">
                {turns.map((t, i) => (
                  <li
                    key={i}
                    className={cn('text-sm', t.role === 'assistant' ? 'text-ai-accent' : 'text-foreground')}
                  >
                    {t.content}
                  </li>
                ))}
                {pending && <li className="text-sm text-muted-foreground" data-testid="chat-pending">구성 중…</li>}
              </ul>
            )}
          </div>
        )}
        <form onSubmit={submit} className="mb-4 w-full max-w-2xl px-4">
          <div className="flex gap-2 rounded-lg border bg-card p-2 shadow-lg">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setOpen(true)}
              placeholder="AI 에게 요청…  (⌘K)"
              data-testid="chat-input"
            />
            <Button type="submit" disabled={pending} className="bg-ai-accent text-ai-accent-foreground">
              보내기
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
```

- [ ] **Step 2: HomeShell 배선** — 전체 교체.

```tsx
import { FloatingChat } from './FloatingChat';
import { HomeCanvas } from './HomeCanvas';
import { ModuleSidebar } from './ModuleSidebar';
import { SessionSwitcher } from './SessionSwitcher';
import { useSessions } from '@/hooks/queries/useHomeQueries';
import { useHomeSession } from '@/hooks/useHomeSession';
import type { WidgetSpec } from '@/types/home';

// 기본 구성(AI 호출 없이 즉시 렌더) — 설계 §6. 모듈 const(안정 참조 — useHomeSession deps).
const DEFAULT_SPECS: WidgetSpec[] = [
  { type: 'my_tasks' },
  { type: 'issue_list', params: { assignee: 'me', status: 'IN_PROGRESS' } },
  { type: 'activity' },
];

/** 홈 셸 — 사이드바 + (세션 헤더 + 캔버스 + 떠있는 챗). 세션 전이는 useHomeSession 이 소유. */
export function HomeShell() {
  const session = useHomeSession(DEFAULT_SPECS);
  const sessions = useSessions();

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <ModuleSidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* 캔버스 헤더 — 세션 스위처 */}
        <header className="flex h-10 shrink-0 items-center border-b px-4" data-testid="canvas-header">
          <SessionSwitcher
            sessions={sessions.data?.items ?? []}
            currentSessionId={session.sessionId}
            onNew={session.newSession}
            onSelect={session.restoreSession}
            onDelete={session.deleteSession}
          />
        </header>
        <div className="relative flex-1 overflow-hidden">
          <HomeCanvas pages={session.pages} activeIndex={session.activeIndex} onSelectPage={session.setActive} />
          <FloatingChat turns={session.turns} pending={session.pending} onSubmit={session.submitQuery} />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: 타입체크 + 빌드** — Run: `cd apps/workplace-web && pnpm typecheck`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/workplace-web/src/components/home/FloatingChat.tsx apps/workplace-web/src/components/home/HomeShell.tsx
git commit -m "feat(web): FloatingChat controlled 전환 + HomeShell 세션 헤더 배선 — #49"
```

---

### Task 7: E2E — auth fixture 스텁 + 세션 플로우 테스트

**Files:**
- Modify: `e2e/fixtures/auth.fixture.ts`
- Modify: `e2e/pages/home.spec.ts`

- [ ] **Step 1: auth fixture 스텁 추가** — `e2e/fixtures/auth.fixture.ts` 의 `setupAuthMocks` 안, 기존 `/me/activity` 빈 스텁 옆에 `/home/sessions` 빈 목록 스텁 추가(`/` 진입 테스트가 새 마운트-페치로 깨지지 않게). 기존 스텁의 `page.route` 스타일을 그대로 따른다.

```ts
  // 홈 세션 스위처 마운트 페치 — 기본 빈 목록(개별 테스트에서 덮어씀).
  await page.route(
    (u) => u.pathname === '/api/v1/home/sessions',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null }),
      }),
  );
```

- [ ] **Step 2: 실패 테스트 작성** — `e2e/pages/home.spec.ts`. 기존 `mockHome` 헬퍼에 세션 목록 스텁 추가하고, 세션 플로우 3종 추가. (기존 테스트 헬퍼/팩토리 형태를 따른다. `mockApi` 시그니처: `mockApi(page, method, path, body, { status?, capture? })`, capture 시 `waitForRequest()` 로 payload 검증.)

```ts
import type { HomeMessage, HomeSessionPage } from '@/types/home';

// (기존 mockHome 에 추가) 세션 목록 기본 빈 스텁.
async function mockSessions(page: Page, sessions: HomeSessionPage = { items: [], nextCursor: null }) {
  await mockApi(page, 'GET', '/api/v1/home/sessions', sessions);
}

test('새 세션 — compose 후 ＋새 세션 으로 기본 구성 복귀', async ({ authenticatedPage: page }) => {
  await mockHome(page); // me/issues, watched, activity
  await mockSessions(page);
  await mockApi(page, 'POST', '/api/v1/home/compose', {
    sessionId: 's1',
    message: '구성했어요',
    widgets: [{ type: 'issue_list', params: { status: 'TODO' }, layout: { page: 'current' } }],
  });
  await page.goto('/');

  // compose → 캔버스 위젯 1개로 재구성
  await page.getByTestId('chat-input').fill('TODO 이슈만');
  await page.getByTestId('chat-input').press('Enter');
  await expect(page.getByTestId('home-widget')).toHaveCount(1);

  // ＋새 세션 → 기본 구성(3 위젯) 복귀
  await page.getByTestId('session-switcher').click();
  await page.getByTestId('session-new').click();
  await expect(page.getByTestId('home-widget')).toHaveCount(3);
});

test('복원 — 세션 선택 시 대화 transcript + 캔버스 재구성(AI 재호출 없음)', async ({ authenticatedPage: page }) => {
  await mockHome(page);
  await mockSessions(page, {
    items: [{ id: 's9', title: 'HIGH 이슈 보기', lastMessageAt: '2026-05-31T00:00:00Z', widgetCount: 1 }],
    nextCursor: null,
  });
  const messages: HomeMessage[] = [
    { id: 1, role: 'USER', content: 'HIGH 이슈', widgets: null, createdAt: '2026-05-31T00:00:00Z' },
    {
      id: 2,
      role: 'ASSISTANT',
      content: '여기 있어요',
      widgets: [{ type: 'issue_list', params: { priority: 'HIGH' }, layout: { page: 'current' } }],
      createdAt: '2026-05-31T00:00:01Z',
    },
  ];
  await mockApi(page, 'GET', '/api/v1/home/sessions/s9/messages', messages);
  await page.goto('/');

  await page.getByTestId('session-switcher').click();
  await page.getByTestId('session-select').click();

  // 캔버스: 복원된 위젯 1개(page:current 가 기본 페이지 replace)
  await expect(page.getByTestId('home-widget')).toHaveCount(1);
  // 대화: ⌘K 로 패널 열어 transcript 확인
  await page.getByTestId('chat-input').click();
  await expect(page.getByTestId('chat-panel')).toContainText('HIGH 이슈');
  await expect(page.getByTestId('chat-panel')).toContainText('여기 있어요');
  // 스위처 트리거가 복원된 세션 제목 표시
  await expect(page.getByTestId('session-switcher')).toContainText('HIGH 이슈 보기');
});

test('삭제 — 휴지통 클릭 시 DELETE 호출 + 목록에서 제거', async ({ authenticatedPage: page }) => {
  await mockHome(page);
  await mockSessions(page, {
    items: [{ id: 's3', title: '삭제할 세션', lastMessageAt: '2026-05-31T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  });
  const del = await mockApi(page, 'DELETE', '/api/v1/home/sessions/s3', null, { status: 204, capture: true });
  await page.goto('/');

  await page.getByTestId('session-switcher').click();
  await expect(page.getByTestId('session-item')).toHaveCount(1);
  // 삭제 후 재페치는 빈 목록을 반환하도록 교체
  await mockSessions(page);
  await page.getByTestId('session-delete').click();
  await del.waitForRequest(); // DELETE /home/sessions/s3 호출됨
  await expect(page.getByTestId('session-item')).toHaveCount(0);
});
```

> 참고: 기존 7c 의 compose 테스트(`req.payload` `{sessionId:null, query}` 검증)는 controlled 전환 후에도 유효해야 한다 — 첫 compose 의 sessionId 는 여전히 null. 실패 시 그 테스트의 셀렉터(자동 접힘/펜딩)를 controlled 동작에 맞춰 갱신.

- [ ] **Step 3: 실패 확인** — Run: `cd apps/workplace-web && pnpm exec playwright test home.spec.ts`. Expected: 새 3종 FAIL(스위처 미배선 전이라면)/PASS(배선 후). Task 6 까지 끝났으면 통과해야 함.

- [ ] **Step 4: 전체 E2E + 단위 테스트** — Run: `cd apps/workplace-web && pnpm test && pnpm exec playwright test`. Expected: 전부 PASS. (기존 60 + 신규 ≈ 63 E2E, 단위 8건.) ECONNREFUSED 플레이크 시 재시도(메모리 기록).

- [ ] **Step 5: 타입체크(E2E tsconfig 포함)** — Run: `cd apps/workplace-web && pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit`. Expected: 신규 코드 에러 없음(admin.factory.ts 의 기존 2건은 무시).

- [ ] **Step 6: Commit**

```bash
git add apps/workplace-web/e2e/fixtures/auth.fixture.ts apps/workplace-web/e2e/pages/home.spec.ts
git commit -m "test(web): 홈 세션 UI E2E(새세션·복원·삭제) + auth fixture 세션 스텁 — #49"
```

---

## 최종 검토 (전 태스크 후)

- [ ] 전체 단위+E2E 그린: `cd apps/workplace-web && pnpm test && pnpm exec playwright test`
- [ ] 최종 코드 리뷰 서브에이전트 디스패치(전체 7d diff)
- [ ] 푸시/PR/#49 클로즈는 **사용자 명시 승인 후** (CLAUDE.md: 커밋/배포 금지 — 승인 후에만)

## Self-Review 체크

- **Spec 커버리지:** 스위처(Task 5)·복원 대화+캔버스(Task 2/3/4/7)·새세션(Task 4/7)·삭제(Task 1/4/5/7)·새로고침=기본구성(Task 4, 문서화) ✅. 제목 자동생성=백엔드(표시만) ✅.
- **타입 일관성:** `restoreState(defaultSpecs, batches)` / `parseRestoredSession`→`{turns,widgetBatches}` / `useHomeSession` 반환 키 / `SessionSwitcher` props 전 태스크 일치 확인.
- **확인 후 맞춤(load-bearing seams):** ① `lucide-react` 아이콘(ChevronDown/Plus/Trash2) 존재 ② `dropdown-menu` export 이름 ③ `mockApi` 시그니처/`waitForRequest` ④ auth fixture 기존 스텁 스타일 ⑤ 기존 home.spec 의 compose 테스트가 controlled 전환 후에도 통과 — 다르면 그에 맞춰 조정.
