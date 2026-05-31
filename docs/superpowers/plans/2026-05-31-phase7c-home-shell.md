# Phase 7c — 홈 셸 + 캔버스 2-레이어 + 위젯 레지스트리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "/" 홈을 AI Native 캔버스로 만든다 — 좌측 모듈 셸 + 항상 보이는 캔버스(위젯) + 하단 떠있는 챗(⌘K). 기본 구성은 AI 호출 없이 즉시 렌더, 챗 명령은 `/home/compose`(7b) 로 캔버스를 재구성한다.

**Architecture:** 프론트 = "구조화 표현" 레이어. compose 응답 `{message, widgets:[{type,params,layout}]}` → `useCanvasState` 멀티페이지 reducer → 위젯 레지스트리(lazy 4종)가 기존 이슈/활동 API 로 데이터 fetch. 단일 응답(스트리밍 X). 세션 스위처/복원 UI 는 7d 범위 — 7c 는 compose 가 돌려준 `sessionId` 만 in-memory 로 추적(follow-up 연속성).

**Tech Stack:** Vite 7 + React 19 + TS + TanStack Query + React Router v7 + Tailwind 4 + shadcn/ui. 백엔드 1건: Spring Boot + jOOQ. 테스트: Playwright E2E(web), JUnit 통합(api).

**Scope guard (설계 §8·§10 기준):**
- **포함**: 모듈 사이드바 + 팀 섹션(최소) · 캔버스 2-레이어 · 멀티페이지(프론트) · 위젯 4종 · 기본 구성 자동 로드 · 챗 명령→compose→재구성(단일 응답) · `--ai-accent` 토큰(이미 존재) · 신규 `GET /me/issues`.
- **제외(7d/후속)**: 세션 스위처·복원·새 세션·삭제 UI · 토큰 스트리밍 · 위젯 핀/드래그 · my_tasks 의 "나를 멘션" 카운트(데이터 소스 없음 → v1 제외, 내 담당+워치만) · 동적 팀 로스터 조회(전 사용자 목록 엔드포인트 부재 → 본인+AI 최소 렌더).

---

## 발견된 갭과 결정 (구현 전 필독)

설계 §4 는 `issue_list` 데이터 출처를 per-project `GET /projects/{key}/issues` 로 적었으나, compose params 에는 projectKey 가 없다(예: `{assignee:"me", status:"IN_PROGRESS"}`). 백엔드엔 **프로젝트 횡단 + 필터** 이슈 검색이 없다(per-project 필터 검색 또는 워처-횡단·무필터만). 기본 구성·issue_list·my_tasks 셋 다 이게 필요하므로 **신규 `GET /api/v1/me/issues`** 를 7c 첫 태스크로 추가한다(사용자 승인 완료, #48 에 폴드). 기존 `IssueSearchService.search()` 의 필터 빌드를 재사용하고 프로젝트 스코프만 member EXISTS 로 교체한다.

---

## 파일 구조

**백엔드 (apps/workplace-api):**
- Modify: `src/main/java/com/workplace/issue/repository/IssueRepository.java` — `searchMemberOf(memberUserId, query)` 추가
- Modify: `src/main/java/com/workplace/issue/service/IssueSearchService.java` — `searchMine(callerId, params)` + 응답조립 `assemble(...)` 추출 + `ProjectRepository` 주입
- Create: `src/main/java/com/workplace/issue/controller/MeIssuesController.java` — `GET /api/v1/me/issues`
- Test: `src/test/java/com/workplace/issue/MeIssuesSearchTest.java`

**프론트 (apps/workplace-web/src):**
- Create: `types/home.ts` — WidgetSpec/WidgetLayout/Compose*/Activity*
- Create: `api/home.ts` — compose · activity · myIssues · watchedCount
- Create: `hooks/queries/useHomeQueries.ts` — useMyIssues · useWatchedIssues · useActivity · useHomeCompose
- Create: `hooks/useCanvasState.ts` — 멀티페이지 reducer
- Create: `components/home/widgets/WidgetFrame.tsx`
- Create: `components/home/widgets/registry.ts`
- Create: `components/home/widgets/MyTasksWidget.tsx`
- Create: `components/home/widgets/IssueListWidget.tsx`
- Create: `components/home/widgets/IssueDetailWidget.tsx`
- Create: `components/home/widgets/ActivityWidget.tsx`
- Create: `components/home/HomeCanvas.tsx` — 페이지 렌더 + PageIndicator + 위젯 슬롯
- Create: `components/home/FloatingChat.tsx` — 입력 + 메시지 + ⌘K
- Create: `components/home/ModuleSidebar.tsx` — 모듈 nav + 팀 섹션
- Create: `components/home/HomeShell.tsx` — 셸 조립 + 기본구성 로드
- Modify: `pages/HomePage.tsx` — `<HomeShell/>` 렌더로 교체
- Test: `e2e/pages/home.spec.ts`

---

## Task 1: 백엔드 — `GET /api/v1/me/issues` (프로젝트 횡단 필터 검색)

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueRepository.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueSearchService.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/controller/MeIssuesController.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/MeIssuesSearchTest.java`

> 작업 디렉토리 주의: workplace-api 는 **독립 gradle 프로젝트**다. `cd apps/workplace-api && ./gradlew ...` 로 실행(루트 `:apps:workplace-api:test` 안 됨). DB 는 떠 있어야 함(`pnpm db:up`).

- [ ] **Step 1: 실패하는 통합 테스트 작성**

기존 `assignee=me` 테스트(`IssueSearchAssigneeMeTest`)와 `ChatFixtures` 패턴을 참고하되, **두 프로젝트** 시드가 필요하므로 이 테스트는 자체적으로 두 프로젝트·이슈를 만든다. 기존 통합 테스트의 픽스처 헬퍼(프로젝트/이슈/멤버 생성)를 재사용한다. 핵심 검증 3가지: (a) `assignee=me` 가 **여러 프로젝트** 이슈를 한 번에 반환, (b) 호출자가 **멤버가 아닌** 프로젝트 이슈는 누락, (c) `status` 필터가 횡단 결과에 적용.

`apps/workplace-api/src/test/java/com/workplace/issue/MeIssuesSearchTest.java`:

```java
package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.IntegrationTestBase;
import com.workplace.issue.service.IssueSearchService;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 7c: /me/issues 프로젝트 횡단 필터 검색 — assignee=me 가 여러 프로젝트를 한 번에, 비멤버 프로젝트는 누락. */
class MeIssuesSearchTest extends IntegrationTestBase {

  @Autowired IssueSearchService searchService;
  @Autowired MeIssuesTestFixtures fx; // 아래 Step 1b 에서 생성

  @Test
  void assigneeMe_crossesProjects_andRespectsMembership() {
    var s = fx.twoProjectsOneForeign();
    // s.callerId 는 projectA, projectB 의 멤버이며 각 프로젝트의 이슈 1건씩 담당.
    // s.foreignIssue 는 caller 가 멤버가 아닌 projectC 의 이슈(담당자는 caller 라도 누락돼야 함).

    var res = searchService.searchMine(s.callerId(), Map.of("assignee", "me"));

    assertThat(res.items()).hasSize(2);
    assertThat(res.items()).extracting(i -> i.projectKey())
        .containsExactlyInAnyOrder(s.projectAKey(), s.projectBKey());
    assertThat(res.items()).noneMatch(i -> i.projectKey().equals(s.projectCKey()));
  }

  @Test
  void statusFilter_appliesAcrossProjects() {
    var s = fx.twoProjectsOneForeign();
    // projectA 이슈만 IN_PROGRESS 로 시드되어 있다고 가정(fixture).
    var res = searchService.searchMine(s.callerId(), Map.of("assignee", "me", "status", "IN_PROGRESS"));

    assertThat(res.items()).hasSize(1);
    assertThat(res.items().get(0).projectKey()).isEqualTo(s.projectAKey());
  }
}
```

- [ ] **Step 1b: 테스트 픽스처 헬퍼 작성**

기존 통합 테스트들이 프로젝트·이슈·멤버를 어떻게 시드하는지 확인하고(예: `ChatFixtures`, `IssueSearchAssigneeMeTest` 가 쓰는 셋업), 동일 리포지토리/서비스로 다음을 만드는 `@Component @ActiveProfiles("test")` 픽스처를 `src/test/java/com/workplace/issue/MeIssuesTestFixtures.java` 에 작성한다:
- caller(USER) 1명.
- projectA, projectB: caller 가 멤버. 각각 caller 담당 이슈 1건. projectA 이슈는 `status=IN_PROGRESS`, projectB 이슈는 `status=TODO`.
- projectC: caller 가 **비멤버**. caller 담당으로 보이는 이슈 1건(멤버십 필터 검증용).

반환 record:
```java
public record Setup(
    long callerId,
    String projectAKey, String projectBKey, String projectCKey,
    long foreignIssueId) {}
```
메서드 `Setup twoProjectsOneForeign()`. 기존 픽스처(프로젝트 생성 시 reporter 를 멤버로 자동 등록하는지 등)를 그대로 활용하고, projectC 는 **다른 사용자**가 만들어 caller 를 멤버로 넣지 않는다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.issue.MeIssuesSearchTest"`
Expected: 컴파일 에러(`searchMine` 없음) 또는 FAIL.

- [ ] **Step 3: 리포지토리 `searchMemberOf` 추가**

`IssueRepository.search(Long projectId, IssueSearchQuery query)` 를 그대로 복제해 `searchMemberOf(Long memberUserId, IssueSearchQuery query)` 를 만든다. **유일한 차이**: 베이스 조건의 `ISSUE.PROJECT_ID.eq(projectId)` 를 아래 멤버십 EXISTS 로 교체. 나머지 필터(status/priority/assignee/due/label/type/blocked/cursor/정렬 `ORDER BY ISSUE.UPDATED_AT.desc(), ISSUE.ID.desc()` `limit`) 는 **동일하게 유지**.

교체할 베이스 조건(기존 `findByIdsActiveMemberOf` 의 패턴 미러):
```java
org.jooq.Condition where =
    ISSUE.DELETED_AT.isNull()
        .and(
            org.jooq.impl.DSL.exists(
                dsl.selectOne()
                    .from(com.workplace.jooq.Tables.PROJECT_MEMBER)
                    .where(
                        com.workplace.jooq.Tables.PROJECT_MEMBER
                            .PROJECT_ID
                            .eq(ISSUE.PROJECT_ID)
                            .and(
                                com.workplace.jooq.Tables.PROJECT_MEMBER.USER_ID.eq(
                                    memberUserId)))));
```
한국어 Javadoc 필수: "프로젝트 횡단 검색 — 호출자가 멤버인 모든 프로젝트의 이슈를 필터/커서로 조회(홈 /me/issues)."

- [ ] **Step 4: 서비스 `searchMine` + 응답조립 `assemble` 추출**

`IssueSearchService` 에서 `search()` 의 **응답조립 블록**(rows 수신 이후 labels/attachments/assignees/types/parent/children/deps/fields batch fetch → `items` 매핑 → cursor 계산 → `new IssueSearchResponse(...)`)을 private 메서드로 추출:

```java
/** rows → IssueSearchResponse 조립. projectKey 는 row 마다 keyResolver 로 해석(횡단 검색 대응). */
private IssueSearchResponse assemble(
    List<IssueRow> rows, IssueSearchQuery query, java.util.function.LongFunction<String> keyResolver) {
  List<Long> issueIds = rows.stream().map(IssueRow::id).toList();
  // ... 기존 search() 의 batch fetch 들 동일 ...
  var items =
      rows.stream()
          .map(
              r ->
                  IssueResponse.fromWithCustomFields(
                      keyResolver.apply(r.projectId()), // ← project.key() 대신 row 별 해석
                      r,
                      /* ... 나머지 인자 동일 ... */))
          .toList();
  String nextCursor = null;
  boolean hasMore = false;
  if (!rows.isEmpty() && rows.size() >= query.size()) {
    var last = rows.get(rows.size() - 1);
    nextCursor = IssueCursor.encode(last.updatedAt(), last.id());
    hasMore = true;
  }
  return new IssueSearchResponse(items, nextCursor, hasMore);
}
```

> `IssueRow` 에 `projectId()` 접근자가 있는지 확인. 없으면(현재 per-project 검색은 projectId 를 안 실었을 수 있음) `searchMemberOf` 의 select 에 `ISSUE.PROJECT_ID` 를 포함시키고 `IssueRow` 에 필드를 추가하거나, row→projectId 매핑을 별도로 fetch. **가장 단순**: `searchMemberOf` 가 `(IssueRow, projectId)` 를 담는 내부 레코드 리스트를 반환하도록 하거나, row 에 이미 projectId 가 있으면 그대로 사용. 구현자는 `IssueRow` 정의를 확인하고 최소 변경 경로를 택한다.

기존 `search()` 는 `return assemble(rows, query, pid -> project.key());` 로 축약(단일 프로젝트라 pid 무시하고 상수 key).

신규 메서드:
```java
/** 7c: 프로젝트 횡단 "내 이슈" 검색. 홈 위젯(issue_list/my_tasks)·기본구성용. assignee=me 는 parse 에서 callerId 로 해석. */
public IssueSearchResponse searchMine(Long callerId, Map<String, String> params) {
  IssueSearchQuery query = parse(callerId, params);
  var rows = issueRepository.searchMemberOf(callerId, query);
  // projectId → key 일괄 해석(횡단이므로 여러 프로젝트). distinct 후 한 번에.
  var keyById = projectRepository.keysByIds(
      rows.stream().map(IssueRow::projectId).distinct().toList());
  return assemble(rows, query, pid -> keyById.getOrDefault(pid, ""));
}
```

`ProjectRepository` 를 생성자 주입에 추가(`private final ProjectRepository projectRepository;`). `keysByIds(List<Long>) -> Map<Long,String>` 가 없으면 추가(jOOQ `select(PROJECT.ID, PROJECT.KEY).from(PROJECT).where(PROJECT.ID.in(ids)).fetchMap(...)`). 한국어 주석 필수.

- [ ] **Step 5: 컨트롤러 작성**

`MeIssuesController.java`:
```java
package com.workplace.issue.controller;

import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.service.IssueSearchService;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 7c: 홈 위젯용 프로젝트 횡단 "내 이슈" 검색. 호출자가 멤버인 모든 프로젝트를 필터/커서로 조회. */
@RestController
@RequiredArgsConstructor
public class MeIssuesController {

  private final IssueSearchService issueSearchService;

  /** GET /api/v1/me/issues — params 는 per-project 검색과 동일(assignee=me 권장). 인증 필요, 추가 권한 없음(멤버십으로 스코프). */
  @GetMapping("/api/v1/me/issues")
  public ResponseEntity<IssueSearchResponse> mine(
      Authentication auth, @RequestParam Map<String, String> params) {
    return ResponseEntity.ok(
        issueSearchService.searchMine((Long) auth.getPrincipal(), params));
  }
}
```
> `@RequirePermission` 없음에 주의: per-project 는 `project:read` 를 썼지만 횡단 검색은 결과 자체를 멤버십 EXISTS 로 스코프하므로 별도 권한 불요(비멤버 프로젝트는 애초에 안 나옴). 공개 엔드포인트가 아니므로 `SecurityConfig` 기본(인증 필요)에 그대로 걸린다 — `/api/v1/auth/**`, `/api/v1/health` 외엔 인증 필수.

- [ ] **Step 6: 테스트 통과 확인 + 전체 회귀**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.issue.MeIssuesSearchTest"`
Expected: PASS.
Run: `cd apps/workplace-api && ./gradlew test`
Expected: BUILD SUCCESSFUL (기존 전부 green).

> Spotless: 무관한 사전 비준수 파일(`ChatMentionParser.java`, `ChatSseFanOutTest.java`)은 건드리지 말 것. 본인이 만든/수정한 파일이 reformat 됐으면 `./gradlew spotlessApply` 후 **본인 파일만** 커밋. 무관 파일이 staged 되면 `git checkout -- <file>` 로 되돌린다.

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueRepository.java \
        apps/workplace-api/src/main/java/com/workplace/issue/service/IssueSearchService.java \
        apps/workplace-api/src/main/java/com/workplace/issue/controller/MeIssuesController.java \
        apps/workplace-api/src/test/java/com/workplace/issue/MeIssuesSearchTest.java \
        apps/workplace-api/src/test/java/com/workplace/issue/MeIssuesTestFixtures.java
# ProjectRepository.java 도 keysByIds 추가했다면 포함
git commit -m "feat(api): GET /api/v1/me/issues 프로젝트 횡단 내 이슈 검색 — #48"
```

---

## Task 2: 프론트 데이터 레이어 — types · api · hooks

**Files:**
- Create: `apps/workplace-web/src/types/home.ts`
- Create: `apps/workplace-web/src/api/home.ts`
- Create: `apps/workplace-web/src/hooks/queries/useHomeQueries.ts`

> 이 태스크는 순수 데이터 레이어 — E2E 는 위젯/셸 태스크에서. 검증은 `pnpm typecheck`.

- [ ] **Step 1: 타입 정의**

`src/types/home.ts`:
```ts
// 7c: 홈 compose/위젯 계약. 백엔드 HomeComposeResponse·ActivityEntryResponse 와 1:1.

/** 위젯 캔버스 배치 힌트 (compose 응답). fire-hub canvas 스키마 미러. */
export interface WidgetLayout {
  page?: 'new' | 'current';
  replace?: string; // 교체 대상 위젯 id
  pageLabel?: string; // page='new' 일 때 새 페이지 라벨
}

export type WidgetType = 'my_tasks' | 'issue_list' | 'issue_detail' | 'activity';

/** compose 가 돌려주는 위젯 스펙. params 는 위젯별 자유 형태(이슈 검색 필터 등). */
export interface WidgetSpec {
  type: WidgetType;
  params?: Record<string, unknown>;
  layout?: WidgetLayout;
}

export interface ComposeRequest {
  sessionId: string | null;
  query: string;
}

export interface ComposeResponse {
  sessionId: string;
  message: string;
  widgets: WidgetSpec[];
}

export type ActorKind = 'HUMAN' | 'AGENT';

/** GET /api/v1/me/activity 항목. */
export interface ActivityEntry {
  id: number;
  issueId: number;
  projectKey: string;
  issueNumber: number;
  issueTitle: string;
  actorId: number;
  actorName: string;
  actorKind: ActorKind;
  eventType: string;
  createdAt: string;
}

export interface ActivityPage {
  items: ActivityEntry[];
  nextCursor: string | null;
}
```

- [ ] **Step 2: api 클라이언트**

`src/api/home.ts`:
```ts
import { client } from './client';
import type { ActivityPage, ComposeRequest, ComposeResponse } from '@/types/home';
import type { IssueSearchResponse } from '@/types/issue';

/** 위젯 params(자유 형태)를 axios 쿼리스트링용 string map 으로 정규화. 배열은 CSV, undefined/null 은 제거. */
export function toQueryParams(params: Record<string, unknown> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  return out;
}

export const homeApi = {
  /** 챗 명령 → AI compose(단일 응답). sessionId null 이면 백엔드가 새 세션 생성. */
  compose: (body: ComposeRequest) => client.post<ComposeResponse>('/home/compose', body),

  /** 프로젝트 횡단 내 이슈 검색 (issue_list/my_tasks 위젯). */
  myIssues: (params: Record<string, unknown>) =>
    client.get<IssueSearchResponse>('/me/issues', { params: toQueryParams(params) }),

  /** 워치 이슈(my_tasks 워치 카운트). */
  watchedIssues: (size = 50) =>
    client.get<IssueSearchResponse>('/me/watched-issues', { params: { size } }),

  /** 최근 활동(activity 위젯). actorKind=AGENT 면 AI 가 한 일만. */
  activity: (params: { actorKind?: string; size?: number } = {}) =>
    client.get<ActivityPage>('/me/activity', { params }),
};
```

- [ ] **Step 3: TanStack Query 훅**

`src/hooks/queries/useHomeQueries.ts` — 기존 `issueKeys`/훅 스타일 미러:
```ts
import { useMutation, useQuery } from '@tanstack/react-query';
import { homeApi } from '@/api/home';
import { handleApiError } from '@/lib/api-error';
import type { ComposeRequest } from '@/types/home';

export const homeKeys = {
  all: ['home'] as const,
  myIssues: (params: Record<string, unknown>) => [...homeKeys.all, 'myIssues', params] as const,
  watched: () => [...homeKeys.all, 'watched'] as const,
  activity: (actorKind?: string) => [...homeKeys.all, 'activity', actorKind ?? 'all'] as const,
};

/** 프로젝트 횡단 내 이슈 — issue_list 위젯/my_tasks 담당 카운트. */
export function useMyIssues(params: Record<string, unknown>) {
  return useQuery({
    queryKey: homeKeys.myIssues(params),
    queryFn: () => homeApi.myIssues(params).then((r) => r.data),
  });
}

/** 워치 이슈 — my_tasks 워치 카운트. */
export function useWatchedIssues() {
  return useQuery({
    queryKey: homeKeys.watched(),
    queryFn: () => homeApi.watchedIssues().then((r) => r.data),
  });
}

/** 최근 활동 — activity 위젯. */
export function useActivity(actorKind?: string) {
  return useQuery({
    queryKey: homeKeys.activity(actorKind),
    queryFn: () => homeApi.activity({ actorKind, size: 20 }).then((r) => r.data),
  });
}

/** 챗 명령 compose. 성공 시 호출부가 sessionId 추적 + 캔버스 재구성. 에러는 토스트. */
export function useHomeCompose() {
  return useMutation({
    mutationFn: (body: ComposeRequest) => homeApi.compose(body).then((r) => r.data),
    onError: (err) => handleApiError(err, 'AI 구성에 실패했어요'),
  });
}
```

- [ ] **Step 4: 타입 체크 + 커밋**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: 통과.
```bash
git add apps/workplace-web/src/types/home.ts apps/workplace-web/src/api/home.ts apps/workplace-web/src/hooks/queries/useHomeQueries.ts
git commit -m "feat(web): 홈 데이터 레이어 — home types/api/queries (compose·myIssues·activity) — #48"
```

---

## Task 3: 캔버스 상태 — `useCanvasState` 멀티페이지 reducer

**Files:**
- Create: `apps/workplace-web/src/hooks/useCanvasState.ts`

> 순수 로직. 검증은 `pnpm typecheck` + 후속 위젯/셸 태스크의 E2E. (workplace-web 엔 단위 테스트 러너 없음 — 프로젝트 규칙상 프론트 테스트는 Playwright E2E.)

- [ ] **Step 1: reducer 작성**

`src/hooks/useCanvasState.ts`:
```ts
import { useCallback, useReducer } from 'react';
import type { WidgetSpec } from '@/types/home';

/** 캔버스에 놓인 위젯 인스턴스(안정적 id 부여). */
export interface CanvasWidget {
  id: string;
  spec: WidgetSpec;
}

/** 캔버스 페이지 — 위젯 묶음 1개 화면. */
export interface CanvasPage {
  id: string;
  label: string;
  widgets: CanvasWidget[];
}

export interface CanvasState {
  pages: CanvasPage[];
  activeIndex: number;
}

type Action =
  | { type: 'loadDefault'; specs: WidgetSpec[] }
  | { type: 'apply'; specs: WidgetSpec[] }
  | { type: 'setActive'; index: number };

let seq = 0;
// 위젯/페이지 id 생성 — 렌더 안정성용(랜덤 X, 단조 증가).
const nextId = (prefix: string) => `${prefix}-${++seq}`;

function toWidgets(specs: WidgetSpec[]): CanvasWidget[] {
  return specs.map((spec) => ({ id: nextId('w'), spec }));
}

function reducer(state: CanvasState, action: Action): CanvasState {
  switch (action.type) {
    case 'loadDefault': {
      // 기본 구성 — 단일 페이지로 초기화(AI 호출 없음).
      const page: CanvasPage = { id: nextId('p'), label: '홈', widgets: toWidgets(action.specs) };
      return { pages: [page], activeIndex: 0 };
    }
    case 'apply': {
      const specs = action.specs;
      if (specs.length === 0) return state;
      const first = specs[0].layout;
      // page='new' → 새 페이지 생성 + 이동, 이번 배치 전체를 거기에.
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
      // layout.replace 가 있으면 해당 위젯만 교체(나머지 유지).
      const replaceIds = specs.map((s) => s.layout?.replace).filter(Boolean) as string[];
      if (replaceIds.length > 0) {
        let widgets = active.widgets;
        for (const spec of specs) {
          const rid = spec.layout?.replace;
          if (rid) {
            widgets = widgets.map((w) => (w.id === rid ? { id: rid, spec } : w));
          } else {
            widgets = [...widgets, { id: nextId('w'), spec }];
          }
        }
        pages[idx] = { ...active, widgets };
        return { ...state, pages };
      }
      // 기본(page='current'/미지정): 현재 페이지를 이번 배치로 재구성(replace-all).
      pages[idx] = { ...active, widgets: toWidgets(specs) };
      return { ...state, pages };
    }
    case 'setActive':
      return { ...state, activeIndex: action.index };
    default:
      return state;
  }
}

/** 홈 캔버스 멀티페이지 상태(프론트 전용, 백엔드 0). fire-hub useCanvasState 패턴 미러. */
export function useCanvasState() {
  const [state, dispatch] = useReducer(reducer, { pages: [], activeIndex: 0 });
  const loadDefault = useCallback((specs: WidgetSpec[]) => dispatch({ type: 'loadDefault', specs }), []);
  const apply = useCallback((specs: WidgetSpec[]) => dispatch({ type: 'apply', specs }), []);
  const setActive = useCallback((index: number) => dispatch({ type: 'setActive', index }), []);
  return { ...state, loadDefault, apply, setActive };
}
```

- [ ] **Step 2: 타입 체크 + 커밋**

Run: `cd apps/workplace-web && pnpm typecheck` → 통과.
```bash
git add apps/workplace-web/src/hooks/useCanvasState.ts
git commit -m "feat(web): useCanvasState 멀티페이지 캔버스 reducer — #48"
```

---

## Task 4: 위젯 레지스트리 + 4종 위젯

**Files:**
- Create: `apps/workplace-web/src/components/home/widgets/WidgetFrame.tsx`
- Create: `apps/workplace-web/src/components/home/widgets/registry.ts`
- Create: `apps/workplace-web/src/components/home/widgets/MyTasksWidget.tsx`
- Create: `apps/workplace-web/src/components/home/widgets/IssueListWidget.tsx`
- Create: `apps/workplace-web/src/components/home/widgets/IssueDetailWidget.tsx`
- Create: `apps/workplace-web/src/components/home/widgets/ActivityWidget.tsx`

> 기존 `src/components/ui/` 의 card·badge·skeleton·status-badge 를 사용. AGENT 시각 구분은 `--ai-accent`(`bg-ai-accent`/`text-ai-accent`/`border-ai-accent`). 한국어 주석 필수.

- [ ] **Step 1: 공통 프레임**

`WidgetFrame.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** 모든 홈 위젯 공통 프레임 — 제목 + ai-accent 좌측 보더 + 본문. */
export function WidgetFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="border-l-2 border-l-ai-accent" data-testid="home-widget">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: my_tasks 위젯**

`MyTasksWidget.tsx` — 내 담당 + 워치 카운트(멘션은 v1 제외). 카운트는 size=50 페이지 기준, `hasMore` 면 "N+":
```tsx
import { Link } from 'react-router-dom';
import { WidgetFrame } from './WidgetFrame';
import { useMyIssues, useWatchedIssues } from '@/hooks/queries/useHomeQueries';
import { Skeleton } from '@/components/ui/skeleton';
import type { IssueSearchResponse } from '@/types/issue';

function count(data?: IssueSearchResponse): string {
  if (!data) return '–';
  return data.hasMore ? `${data.items.length}+` : String(data.items.length);
}

/** 내 할 일 요약 — 내 담당(IN_PROGRESS+TODO)·워치 카운트. params 무시(고정 요약). */
export default function MyTasksWidget() {
  const assigned = useMyIssues({ assignee: 'me', size: 50 });
  const watched = useWatchedIssues();
  const loading = assigned.isLoading || watched.isLoading;
  return (
    <WidgetFrame title="내 할 일">
      {loading ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <div className="flex gap-6">
          <Link to="/me/watched" className="text-center" data-testid="mytasks-assigned">
            <div className="text-2xl font-semibold text-ai-accent">{count(assigned.data)}</div>
            <div className="text-xs text-muted-foreground">내 담당</div>
          </Link>
          <Link to="/me/watched" className="text-center" data-testid="mytasks-watched">
            <div className="text-2xl font-semibold">{count(watched.data)}</div>
            <div className="text-xs text-muted-foreground">워치</div>
          </Link>
        </div>
      )}
    </WidgetFrame>
  );
}
```

- [ ] **Step 3: issue_list 위젯**

`IssueListWidget.tsx` — params 로 `/me/issues` 조회, 각 행은 이슈 상세로 링크:
```tsx
import { Link } from 'react-router-dom';
import { WidgetFrame } from './WidgetFrame';
import { useMyIssues } from '@/hooks/queries/useHomeQueries';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';

/** params(assignee/status/priority/due 등)로 프로젝트 횡단 이슈 목록. */
export default function IssueListWidget({ params }: { params?: Record<string, unknown> }) {
  const { data, isLoading } = useMyIssues(params ?? { assignee: 'me' });
  return (
    <WidgetFrame title="이슈">
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : data && data.items.length > 0 ? (
        <ul className="divide-y" data-testid="issuelist-items">
          {data.items.map((it) => (
            <li key={`${it.projectKey}-${it.number}`} className="py-2">
              <Link
                to={`/projects/${it.projectKey}/issues/${it.number}`}
                className="flex items-center justify-between gap-2 hover:text-ai-accent"
              >
                <span className="truncate text-sm">
                  <span className="text-muted-foreground">{it.projectKey}-{it.number}</span> {it.title}
                </span>
                <StatusBadge status={it.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="issuelist-empty">
          해당 조건의 이슈가 없어요.
        </p>
      )}
    </WidgetFrame>
  );
}
```
> `StatusBadge` 의 정확한 prop 명(`status`)·허용 값은 `src/components/ui/status-badge.tsx` 확인 후 맞춘다. 시그니처가 다르면 거기에 맞춰 호출.

- [ ] **Step 4: issue_detail 위젯**

`IssueDetailWidget.tsx` — params `{number, projectKey}` 필요. 기존 `useIssue(projectKey, number)` 훅 재사용. projectKey 없으면 안내:
```tsx
import { WidgetFrame } from './WidgetFrame';
import { useIssue } from '@/hooks/queries/useIssues'; // 기존 detail 훅 — 실제 export 명 확인
import { Skeleton } from '@/components/ui/skeleton';

/** 단일 이슈 상세 요약. params: { number, projectKey }. */
export default function IssueDetailWidget({ params }: { params?: Record<string, unknown> }) {
  const projectKey = params?.projectKey as string | undefined;
  const number = params?.number != null ? Number(params.number) : undefined;
  if (!projectKey || !number) {
    return (
      <WidgetFrame title="이슈 상세">
        <p className="text-sm text-muted-foreground">표시할 이슈를 특정하지 못했어요.</p>
      </WidgetFrame>
    );
  }
  return <IssueDetailInner projectKey={projectKey} number={number} />;
}

function IssueDetailInner({ projectKey, number }: { projectKey: string; number: number }) {
  const { data, isLoading } = useIssue(projectKey, number);
  return (
    <WidgetFrame title={`${projectKey}-${number}`}>
      {isLoading || !data ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="space-y-1" data-testid="issuedetail">
          <div className="text-sm font-medium">{data.summary.title}</div>
          <div className="text-xs text-muted-foreground">{data.summary.status} · {data.summary.priority}</div>
        </div>
      )}
    </WidgetFrame>
  );
}
```
> `useIssue` 의 정확한 이름·시그니처·반환 형태(`IssueDetailResponse` 의 `summary`)는 `src/hooks/queries/` 와 `types/issue.ts` 로 확인해 맞춘다. 훅이 enabled 옵션을 요구하면 inner 컴포넌트 분리(위처럼)로 조건부 호출 회피.

- [ ] **Step 5: activity 위젯**

`ActivityWidget.tsx`:
```tsx
import { Link } from 'react-router-dom';
import { WidgetFrame } from './WidgetFrame';
import { useActivity } from '@/hooks/queries/useHomeQueries';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

/** 최근 활동. params.actorKind='AGENT' 면 AI 가 한 일만. */
export default function ActivityWidget({ params }: { params?: Record<string, unknown> }) {
  const actorKind = params?.actorKind as string | undefined;
  const { data, isLoading } = useActivity(actorKind);
  return (
    <WidgetFrame title={actorKind === 'AGENT' ? 'AI 활동' : '최근 활동'}>
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : data && data.items.length > 0 ? (
        <ul className="space-y-2" data-testid="activity-items">
          {data.items.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              {a.actorKind === 'AGENT' && (
                <Badge className="bg-ai-accent text-ai-accent-foreground">AI</Badge>
              )}
              <span className="text-muted-foreground">{a.actorName}</span>
              <Link to={`/projects/${a.projectKey}/issues/${a.issueNumber}`} className="truncate hover:text-ai-accent">
                {a.issueTitle}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="activity-empty">최근 활동이 없어요.</p>
      )}
    </WidgetFrame>
  );
}
```

- [ ] **Step 6: 레지스트리**

`registry.ts`:
```ts
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { WidgetType } from '@/types/home';

/** 위젯 컴포넌트 공통 props — 캔버스가 spec.params 를 그대로 전달. */
export interface WidgetProps {
  params?: Record<string, unknown>;
}

// type → lazy 컴포넌트. 번들 분리. 새 위젯 추가 = import 한 줄.
const registry: Record<WidgetType, LazyExoticComponent<ComponentType<WidgetProps>>> = {
  my_tasks: lazy(() => import('./MyTasksWidget')),
  issue_list: lazy(() => import('./IssueListWidget')),
  issue_detail: lazy(() => import('./IssueDetailWidget')),
  activity: lazy(() => import('./ActivityWidget')),
};

/** 알 수 없는 type 은 null — 캔버스가 무시. */
export function getWidget(type: string): LazyExoticComponent<ComponentType<WidgetProps>> | null {
  return registry[type as WidgetType] ?? null;
}
```

- [ ] **Step 7: 타입 체크 + 커밋**

Run: `cd apps/workplace-web && pnpm typecheck` → 통과(필요시 위 "확인" 메모대로 기존 훅/배지 시그니처에 맞춤).
```bash
git add apps/workplace-web/src/components/home/widgets/
git commit -m "feat(web): 홈 위젯 레지스트리 + 4종(my_tasks·issue_list·issue_detail·activity) — #48"
```

---

## Task 5: 캔버스 레이어 — `HomeCanvas` + PageIndicator

**Files:**
- Create: `apps/workplace-web/src/components/home/HomeCanvas.tsx`

- [ ] **Step 1: 캔버스 컴포넌트**

```tsx
import { Suspense } from 'react';
import type { CanvasPage } from '@/hooks/useCanvasState';
import { getWidget } from './widgets/registry';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface Props {
  pages: CanvasPage[];
  activeIndex: number;
  onSelectPage: (index: number) => void;
}

/** 캔버스 레이어 — 활성 페이지의 위젯 그리드 + 하단 PageIndicator(멀티페이지). */
export function HomeCanvas({ pages, activeIndex, onSelectPage }: Props) {
  const active = pages[activeIndex];
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-6" data-testid="home-canvas">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {active?.widgets.map((w) => {
            const Widget = getWidget(w.spec.type);
            if (!Widget) return null;
            return (
              <Suspense key={w.id} fallback={<Skeleton className="h-32 w-full" />}>
                <Widget params={w.spec.params} />
              </Suspense>
            );
          })}
        </div>
      </div>
      {pages.length > 1 && (
        <div className="flex justify-center gap-2 py-2" data-testid="page-indicator">
          {pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectPage(i)}
              aria-label={p.label}
              aria-current={i === activeIndex}
              className={cn(
                'h-2 w-2 rounded-full transition-colors',
                i === activeIndex ? 'bg-ai-accent' : 'bg-muted-foreground/30',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```
> `cn` 유틸 경로(`@/lib/utils`)·`Skeleton` import 경로 확인.

- [ ] **Step 2: 타입 체크 + 커밋**

Run: `cd apps/workplace-web && pnpm typecheck` → 통과.
```bash
git add apps/workplace-web/src/components/home/HomeCanvas.tsx
git commit -m "feat(web): HomeCanvas 캔버스 레이어 + PageIndicator — #48"
```

---

## Task 6: 떠있는 챗 — `FloatingChat` (⌘K + compose 재구성)

**Files:**
- Create: `apps/workplace-web/src/components/home/FloatingChat.tsx`

- [ ] **Step 1: 챗 컴포넌트**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHomeCompose } from '@/hooks/queries/useHomeQueries';
import type { WidgetSpec } from '@/types/home';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  /** compose 결과 위젯을 캔버스에 적용. */
  onCompose: (specs: WidgetSpec[]) => void;
}

/** 떠있는 챗 레이어 — 평소 입력창만, ⌘K/포커스 시 메시지 패널 펼침, 응답 완료 시 자동 접힘. */
export function FloatingChat({ onCompose }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const compose = useHomeCompose();

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

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const query = input.trim();
      if (!query || compose.isPending) return;
      setTurns((t) => [...t, { role: 'user', content: query }]);
      setInput('');
      compose.mutate(
        { sessionId, query },
        {
          onSuccess: (res) => {
            setSessionId(res.sessionId); // follow-up 연속성(7c 는 in-memory 추적만)
            setTurns((t) => [...t, { role: 'assistant', content: res.message }]);
            onCompose(res.widgets);
            setOpen(false); // 응답 완료 → 자동 접힘(결과 전면)
          },
        },
      );
    },
    [input, compose, sessionId, onCompose],
  );

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
                {compose.isPending && <li className="text-sm text-muted-foreground" data-testid="chat-pending">구성 중…</li>}
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
            <Button type="submit" disabled={compose.isPending} className="bg-ai-accent text-ai-accent-foreground">
              보내기
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
```
> `Input` 이 `ref` 를 forward 하는지 확인(shadcn 기본은 forward). 안 하면 `inputRef` 대신 `document.querySelector` 회피 말고 Input 의 ref 지원 확인.

- [ ] **Step 2: 타입 체크 + 커밋**

Run: `cd apps/workplace-web && pnpm typecheck` → 통과.
```bash
git add apps/workplace-web/src/components/home/FloatingChat.tsx
git commit -m "feat(web): FloatingChat 떠있는 챗(⌘K + compose 재구성) — #48"
```

---

## Task 7: 셸 조립 — `ModuleSidebar` + `HomeShell` + HomePage 교체

**Files:**
- Create: `apps/workplace-web/src/components/home/ModuleSidebar.tsx`
- Create: `apps/workplace-web/src/components/home/HomeShell.tsx`
- Modify: `apps/workplace-web/src/pages/HomePage.tsx`

- [ ] **Step 1: 모듈 사이드바 + 팀 섹션(최소)**

```tsx
import { useAuth } from '@/hooks/useAuth'; // 실제 export 확인
import { cn } from '@/lib/utils';

const MODULES = [
  { key: 'home', label: '홈', active: true },
  { key: 'issues', label: '이슈', to: '/projects' },
];
const SOON = ['Chat', 'Wiki', 'Drive'];

/** 좌측 모듈 사이드바 + 팀 섹션(본인 + AI 동료, 상태 점). 동적 로스터는 7c 범위 외. */
export function ModuleSidebar() {
  const { user } = useAuth();
  return (
    <aside className="flex w-56 flex-col border-r bg-card/40 p-3" data-testid="module-sidebar">
      <nav className="space-y-1">
        {MODULES.map((m) => (
          <div
            key={m.key}
            className={cn(
              'rounded px-3 py-2 text-sm',
              m.active ? 'bg-ai-accent-subtle font-medium text-ai-accent' : 'text-foreground',
            )}
          >
            {m.label}
          </div>
        ))}
        {SOON.map((s) => (
          <div key={s} className="px-3 py-2 text-sm text-muted-foreground/50">
            {s} <span className="text-xs">(예정)</span>
          </div>
        ))}
      </nav>
      <div className="mt-6">
        <div className="px-3 text-xs uppercase text-muted-foreground">팀</div>
        <ul className="mt-2 space-y-1">
          <li className="flex items-center gap-2 px-3 py-1 text-sm">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {user?.name ?? '나'}
          </li>
          <li className="flex items-center gap-2 px-3 py-1 text-sm">
            <span className="h-2 w-2 rounded-full bg-ai-accent" />
            <span className="text-ai-accent">AI 동료</span>
          </li>
        </ul>
      </div>
    </aside>
  );
}
```
> `useAuth` 의 import 경로·`user` 형태(`name`)는 `src/hooks/AuthContext.tsx`/`useAuth` 로 확인.

- [ ] **Step 2: 셸 조립 + 기본 구성 로드**

`HomeShell.tsx`:
```tsx
import { useEffect } from 'react';
import { ModuleSidebar } from './ModuleSidebar';
import { HomeCanvas } from './HomeCanvas';
import { FloatingChat } from './FloatingChat';
import { useCanvasState } from '@/hooks/useCanvasState';
import type { WidgetSpec } from '@/types/home';

// 기본 구성(AI 호출 없이 즉시 렌더) — 설계 §6.
const DEFAULT_SPECS: WidgetSpec[] = [
  { type: 'my_tasks' },
  { type: 'issue_list', params: { assignee: 'me', status: 'IN_PROGRESS' } },
  { type: 'activity' },
];

/** 홈 셸 — 좌측 모듈 사이드바 + 캔버스(항상 보임) + 떠있는 챗. 마운트 시 기본 구성 자동 로드. */
export function HomeShell() {
  const canvas = useCanvasState();
  const { loadDefault } = canvas;
  useEffect(() => {
    loadDefault(DEFAULT_SPECS);
  }, [loadDefault]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <ModuleSidebar />
      <main className="relative flex-1 overflow-hidden">
        <HomeCanvas pages={canvas.pages} activeIndex={canvas.activeIndex} onSelectPage={canvas.setActive} />
        <FloatingChat onCompose={canvas.apply} />
      </main>
    </div>
  );
}
```
> 높이 `calc(100vh-3.5rem)` 는 AppLayout 헤더(14 = 3.5rem) 가정 — 실제 헤더 높이 확인 후 맞춤.

- [ ] **Step 3: HomePage 교체**

`src/pages/HomePage.tsx` 의 기존 데모 내용을 제거하고:
```tsx
import { HomeShell } from '@/components/home/HomeShell';

/** "/" — AI Native 홈. 셸 + 캔버스 + 떠있는 챗. */
export default function HomePage() {
  return <HomeShell />;
}
```
> 기존 export 형태(default vs named)를 `App.tsx` 의 lazy import 와 일치시킨다.

- [ ] **Step 4: 타입 체크 + 빌드 + 커밋**

Run: `cd apps/workplace-web && pnpm typecheck && pnpm build`
Expected: 통과.
```bash
git add apps/workplace-web/src/components/home/ModuleSidebar.tsx apps/workplace-web/src/components/home/HomeShell.tsx apps/workplace-web/src/pages/HomePage.tsx
git commit -m "feat(web): 홈 셸 조립(ModuleSidebar+HomeShell) + HomePage 교체 — #48"
```

---

## Task 8: E2E — 기본 구성 로드 · ⌘K 명령→재구성 · 멀티페이지

**Files:**
- Create: `apps/workplace-web/e2e/pages/home.spec.ts`

> `e2e/fixtures/auth.fixture.ts` 의 `authenticatedPage` + `e2e/fixtures/api-mock.ts` 의 `mockApi` 사용. 모든 홈 API 를 모킹(`/me/issues`, `/me/watched-issues`, `/me/activity`, `/home/compose`). 타입은 `src/types/` 적용(스펙 변경 시 컴파일 에러).

- [ ] **Step 1: 모킹 헬퍼 + 기본 구성 로드 테스트**

```ts
import { expect, test } from '../fixtures/auth.fixture';
import { mockApi } from '../fixtures/api-mock';
import type { Page } from '@playwright/test';
import type { IssueSearchResponse } from '../../src/types/issue';
import type { ActivityPage } from '../../src/types/home';

// 최소 이슈 1건(타입 적용). 기존 issue factory 가 있으면 재사용.
function issueList(): IssueSearchResponse {
  return {
    items: [
      {
        id: 1, projectKey: 'WP', number: 7, title: '로그인 버그', status: 'IN_PROGRESS', priority: 'HIGH',
        dueDate: null, reporterId: 1, createdAt: '2026-05-30T00:00:00Z', updatedAt: '2026-05-30T00:00:00Z',
        labels: [], attachmentCount: 0, type: null, assignees: [], parent: null, childCount: 0, childDoneCount: 0,
        blockedBy: [], blocks: [], blocked: false, customFields: [],
      },
    ],
    nextCursor: null, hasMore: false,
  };
}
function activity(): ActivityPage {
  return {
    items: [
      { id: 1, issueId: 1, projectKey: 'WP', issueNumber: 7, issueTitle: '로그인 버그',
        actorId: 9, actorName: 'Claude', actorKind: 'AGENT', eventType: 'STATUS_CHANGE', createdAt: '2026-05-30T01:00:00Z' },
    ],
    nextCursor: null,
  };
}

async function mockHome(page: Page) {
  await mockApi(page, 'GET', '/api/v1/me/issues', issueList());
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', issueList());
  await mockApi(page, 'GET', '/api/v1/me/activity', activity());
}

test('홈 기본 구성이 AI 호출 없이 로드된다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await mockHome(page);
  await page.goto('/');

  // 위젯 3종이 렌더(기본 구성: my_tasks + issue_list + activity)
  await expect(page.getByTestId('home-widget')).toHaveCount(3);
  await expect(page.getByTestId('issuelist-items')).toContainText('로그인 버그');
  await expect(page.getByTestId('activity-items')).toContainText('Claude');
  // 떠있는 챗 입력창은 평소 보임, 메시지 패널은 접힘
  await expect(page.getByTestId('chat-input')).toBeVisible();
  await expect(page.getByTestId('chat-panel')).toHaveCount(0);
});
```

> `mockApi` 의 GET path 매칭이 쿼리스트링을 무시하는지 확인(헬퍼가 `**/path*` 패턴이면 `/me/issues?...` 도 매칭). 모킹이 쿼리별로 갈려야 하면 동일 path 에 한 번만 등록하고 모든 호출에 같은 응답을 준다.

- [ ] **Step 2: ⌘K 펼침 + 명령 → 재구성 테스트**

```ts
test('⌘K 로 챗을 열고 명령하면 캔버스가 재구성된다', async ({ authenticatedPage: page }) => {
  await mockHome(page);
  const composeCapture = await mockApi(
    page, 'POST', '/api/v1/home/compose',
    {
      sessionId: 's1',
      message: 'HIGH 이슈만 보여드려요',
      widgets: [{ type: 'issue_list', params: { assignee: 'me', priority: ['HIGH'] }, layout: { page: 'current' } }],
    },
    { capture: true },
  );

  await page.goto('/');
  await expect(page.getByTestId('home-widget')).toHaveCount(3);

  // ⌘K → 패널 펼침
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('chat-panel')).toBeVisible();

  // 명령 입력 → 전송
  await page.getByTestId('chat-input').fill('내 HIGH 이슈');
  await page.getByRole('button', { name: '보내기' }).click();

  // 요청 페이로드 검증(sessionId null, query)
  const req = await composeCapture.waitForRequest();
  expect(req.postDataJSON()).toMatchObject({ sessionId: null, query: '내 HIGH 이슈' });

  // 재구성: 현재 페이지가 issue_list 1개로 교체(replace-all)
  await expect(page.getByTestId('home-widget')).toHaveCount(1);
  // 응답 완료 → 자동 접힘
  await expect(page.getByTestId('chat-panel')).toHaveCount(0);
});
```

- [ ] **Step 3: 멀티페이지 전환 테스트**

```ts
test('compose 가 page=new 면 새 페이지가 생기고 전환된다', async ({ authenticatedPage: page }) => {
  await mockHome(page);
  await mockApi(
    page, 'POST', '/api/v1/home/compose',
    {
      sessionId: 's1',
      message: '새 페이지에 마감 이슈를 띄웠어요',
      widgets: [{ type: 'issue_list', params: { assignee: 'me', dueTo: '2026-06-05' }, layout: { page: 'new', pageLabel: '이번 주 마감' } }],
    },
  );

  await page.goto('/');
  await page.keyboard.press('Meta+k');
  await page.getByTestId('chat-input').fill('이번 주 마감');
  await page.getByRole('button', { name: '보내기' }).click();

  // 페이지 인디케이터가 2개 점을 보인다(기본 페이지 + 새 페이지)
  const indicator = page.getByTestId('page-indicator');
  await expect(indicator).toBeVisible();
  await expect(indicator.getByRole('button')).toHaveCount(2);
});
```

- [ ] **Step 4: E2E 타입 체크 + 실행**

Run: `cd apps/workplace-web && npx tsc -p tsconfig.e2e.json --noEmit`
Expected: 통과.
Run: `cd apps/workplace-web && pnpm test:e2e --grep "홈|⌘K|page=new"`
Expected: 3 PASS.

> pre-commit 이 전체 E2E 를 돌려 ECONNREFUSED flake 가 나면 진단 말고 재시도(메모리 기록된 알려진 flake).

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-web/e2e/pages/home.spec.ts
git commit -m "test(web): 홈 E2E — 기본구성 로드·⌘K 명령 재구성·멀티페이지 — #48"
```

---

## 최종 검증 (모든 태스크 후)

- [ ] 백엔드 전체: `cd apps/workplace-api && ./gradlew test` → BUILD SUCCESSFUL
- [ ] 프론트: `cd apps/workplace-web && pnpm typecheck && pnpm lint && pnpm build` → 통과
- [ ] 프론트 E2E 전체: `cd apps/workplace-web && pnpm test:e2e` → green (flake 시 재시도)
- [ ] 최종 홀리스틱 리뷰: compose 계약(api `{sessionId,message,widgets}` ↔ web `ComposeResponse`) · `/me/issues` params 정렬 · 위젯 레지스트리 1:1 · 기본구성 AI 미호출 · ⌘K/자동접힘 · 멀티페이지 seam 점검.

## 스코프 경계 재확인 (7d 로 이월)

세션 스위처(▾)·복원(transcript+캔버스 재구성)·새 세션·삭제 UI 는 **7d(#49)**. 7c 는 compose 가 돌려준 `sessionId` 만 in-memory 추적(follow-up 연속성)하고 새로고침하면 기본 구성으로 리셋된다 — 정상.
