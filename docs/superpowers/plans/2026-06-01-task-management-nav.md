# 작업 관리 사이드바 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "작업 관리" 사이드바를 개인 영역(내 작업 3탭 + AI 위임 작업) + 프로젝트(컬러 식별자)로 개편해 "휑함/어색함"을 해소한다.

**Architecture:** 프론트엔드 중심. 이슈 검색에 `reporter` 필터 1개만 백엔드에 추가하고, 나머지(할당/구독)는 기존 API 재사용. AI 위임 작업은 `reporter=me` 결과를 클라이언트에서 `assignee.kind==='AGENT'`로 필터링. 프로젝트 컬러는 key 해시로 프론트 생성.

**Tech Stack:** Spring Boot + jOOQ(백엔드) / Vite + React 19 + TS + TanStack Query + shadcn(프론트) / JUnit 통합테스트 + vitest 단위 + Playwright E2E

**근거 스펙:** [docs/superpowers/specs/2026-06-01-task-management-nav-design.md](../specs/2026-06-01-task-management-nav-design.md)

---

## File Structure

**백엔드 (apps/workplace-api)**
- Modify: `src/main/java/com/workplace/issue/dto/IssueSearchQuery.java` — `reporterIds` 필드 추가(맨 끝)
- Modify: `src/main/java/com/workplace/issue/service/IssueSearchService.java` — `reporter` 파라미터 파싱
- Modify: `src/main/java/com/workplace/issue/repository/IssueRepository.java` — reporter 조건
- Modify: `src/test/java/com/workplace/issue/repository/IssueRepositorySearchTest.java` — 8개 생성자 호출에 trailing 인자
- Create: `src/test/java/com/workplace/issue/service/IssueSearchServiceReporterTest.java` — reporter 통합 테스트

**프론트 (apps/workplace-web)**
- Create: `src/lib/project-color.ts` + `src/lib/project-color.test.ts` — 프로젝트 컬러 유틸
- Create: `src/components/issue/IssueListTable.tsx` — 이슈 목록 테이블(공유)
- Create: `src/components/issue/InfiniteIssueList.tsx` — 무한스크롤 래퍼(공유)
- Create: `src/api/meIssues.ts` + `src/hooks/queries/useMeIssues.ts` — /me/issues 조회
- Create: `src/pages/me/MyTasksPage.tsx` — 내 작업 3탭
- Create: `src/pages/me/AiDelegatedTasksPage.tsx` — AI 위임 작업
- Modify: `src/pages/me/WatchedIssuesPage.tsx` — 공유 컴포넌트로 리팩터
- Modify: `src/components/issue/IssueSidebar.tsx` — 메뉴 개편 + 프로젝트 컬러
- Modify: `src/App.tsx` — 라우트 추가/리다이렉트
- Modify: `e2e/pages/issue-sidebar.spec.ts`, `e2e/pages/me/watched.spec.ts` — 사이드바/리다이렉트 검증
- Create: `e2e/pages/me/my-tasks.spec.ts`, `e2e/pages/me/ai-tasks.spec.ts` — 신규 E2E

---

## Task 1: 백엔드 — 이슈 검색 reporter 필터

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueSearchQuery.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueSearchService.java:225`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueRepository.java`
- Modify: `apps/workplace-api/src/test/java/com/workplace/issue/repository/IssueRepositorySearchTest.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/service/IssueSearchServiceReporterTest.java`

- [ ] **Step 1: 실패 테스트 작성** — `IssueSearchServiceReporterTest.java` 신규 생성. 기존 `IssueSearchServiceAssigneesTest`의 헬퍼(createUser/uniqueKey/newProject) 패턴을 그대로 미러링한다. `issueRepository.insert(projectId, number, title, body, priority, dueDate, reporterId)`의 마지막 인자가 reporter다.

```java
package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueSearchService 의 reporter 필터(= 이슈를 만든 사람) 검증. */
@Transactional
class IssueSearchServiceReporterTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueSearchService searchService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;

  private Long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return (prefix + suffix).substring(0, Math.min(10, (prefix + suffix).length()));
  }

  private ProjectResponse newProject(Long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  @Test
  void filter_reporter_matches_only_issues_reported_by_that_user() {
    Long owner = createUser("r");
    Long u1 = createUser("r1");
    ProjectResponse p = newProject(owner, "SR1");
    projectService.addMember(owner, p.key(), new AddMemberRequest(u1, "MEMBER"));
    issueRepository.insert(p.id(), 1, "by-owner", null, "MID", null, owner);
    issueRepository.insert(p.id(), 2, "by-u1", null, "MID", null, u1);

    var resp = searchService.search(owner, p.key(), Map.of("reporter", String.valueOf(u1)));

    assertThat(resp.items()).extracting(IssueResponse::title).containsExactly("by-u1");
  }

  @Test
  void filter_reporter_me_literal_resolves_to_caller() {
    Long owner = createUser("rm");
    Long other = createUser("rm2");
    ProjectResponse p = newProject(owner, "SR2");
    projectService.addMember(owner, p.key(), new AddMemberRequest(other, "MEMBER"));
    issueRepository.insert(p.id(), 1, "mine", null, "MID", null, owner);
    issueRepository.insert(p.id(), 2, "theirs", null, "MID", null, other);

    var resp = searchService.search(owner, p.key(), Map.of("reporter", "me"));

    assertThat(resp.items()).extracting(IssueResponse::title).containsExactly("mine");
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests 'com.workplace.issue.service.IssueSearchServiceReporterTest'`
Expected: 컴파일 에러 또는 FAIL (reporter 필터 미구현 → 두 이슈 모두 반환되어 containsExactly 실패)

- [ ] **Step 3: IssueSearchQuery 에 reporterIds 필드 추가(맨 끝)** — 끝에 추가해 위치 인자 이동을 최소화한다.

```java
public record IssueSearchQuery(
    String q,
    List<String> statuses,
    List<Long> assigneeIds,
    boolean includeUnassigned,
    List<String> priorities,
    LocalDate dueFrom,
    LocalDate dueTo,
    IssueCursor cursor,
    int size,
    List<Long> labelIds,
    List<Long> typeIds,
    Integer parentNumber,
    Boolean topLevel,
    Boolean blocked,
    Long fieldId,
    String fieldValue,
    // 7-nav: reporter(이슈를 만든 사람) 필터. "me" 는 호출자로 치환. 비어 있으면 미적용.
    List<Long> reporterIds) {}
```

- [ ] **Step 4: IssueSearchService.parse() — reporter 토큰 파싱 + 생성자 인자 추가** — assignee 파싱 블록(라인 ~145-158) 바로 아래에 reporter 파싱을 추가한다. assignee 와 달리 "null"(미지정) 개념은 없다(reporter_id 는 NOT NULL).

assignee 파싱 블록 다음에 삽입:
```java
    // 7-nav: reporter 필터. "me" → 호출자 본인("내가 만든" 조회). 숫자 외 토큰은 무시.
    var reporterTokens = csv(p.get("reporter"));
    List<Long> reporterIds = new ArrayList<>();
    for (String tok : reporterTokens) {
      if ("me".equalsIgnoreCase(tok)) {
        reporterIds.add(callerId);
      } else {
        try {
          reporterIds.add(Long.parseLong(tok));
        } catch (NumberFormatException e) {
          // 알 수 없는 토큰 무시
        }
      }
    }
```

`return new IssueSearchQuery(...)` (라인 225~) 의 마지막 인자 `fieldValue` 뒤에 `reporterIds` 추가:
```java
    return new IssueSearchQuery(
        q,
        statuses,
        assigneeIds,
        includeUnassigned,
        priorities,
        dueFrom,
        dueTo,
        cursor,
        size,
        labelIds,
        typeIds,
        parentNumber,
        topLevel,
        blocked,
        fieldId,
        fieldValue,
        reporterIds);
```

- [ ] **Step 5: IssueRepository.search() — reporter 조건 추가** — priorities 조건(라인 ~282) 바로 다음에 삽입한다. assignee 와 달리 매핑 테이블 없이 ISSUE.REPORTER_ID 직접 비교.

```java
    if (query.reporterIds() != null && !query.reporterIds().isEmpty()) {
      // reporter(이슈 생성자) 직접 컬럼 비교 — issue_assignee 매핑과 무관.
      where = where.and(ISSUE.REPORTER_ID.in(query.reporterIds()));
    }
```

- [ ] **Step 6: 기존 IssueRepositorySearchTest 의 생성자 호출 8곳 보정** — `IssueSearchQuery` 에 필드를 추가했으므로 직접 생성하는 테스트가 컴파일 에러난다. 8개 `new IssueSearchQuery(...)` (라인 73,91,110,143,164,199,231,241) 각각의 마지막 인자 뒤에 `, null` (reporter 미적용)을 추가한다. 컴파일러가 모든 위치를 짚어준다.

Run(위치 확인): `cd apps/workplace-api && grep -n "new IssueSearchQuery" src/test/java/com/workplace/issue/repository/IssueRepositorySearchTest.java`

- [ ] **Step 7: 전체 백엔드 테스트 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests 'com.workplace.issue.service.IssueSearchServiceReporterTest' --tests 'com.workplace.issue.repository.IssueRepositorySearchTest' --tests 'com.workplace.issue.service.IssueSearchServiceAssigneesTest'`
Expected: PASS (전부)

- [ ] **Step 8: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueSearchQuery.java \
        apps/workplace-api/src/main/java/com/workplace/issue/service/IssueSearchService.java \
        apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueRepository.java \
        apps/workplace-api/src/test/java/com/workplace/issue/repository/IssueRepositorySearchTest.java \
        apps/workplace-api/src/test/java/com/workplace/issue/service/IssueSearchServiceReporterTest.java
git commit -m "feat(api): 이슈 검색 reporter 필터 추가 — \"내가 만든\" 조회(reporter=me)"
```

---

## Task 2: 프론트 — 프로젝트 컬러 유틸

**Files:**
- Create: `apps/workplace-web/src/lib/project-color.ts`
- Test: `apps/workplace-web/src/lib/project-color.test.ts`

- [ ] **Step 1: 실패 테스트 작성** (vitest, node env, 순수 함수)

```ts
import { describe, expect, it } from 'vitest'

import { projectColor, projectInitial } from './project-color'

describe('projectColor', () => {
  it('같은 key 는 항상 같은 색(결정적)', () => {
    expect(projectColor('WP')).toEqual(projectColor('WP'))
  })

  it('다른 key 는 다른 hue', () => {
    expect(projectColor('WP').bg).not.toEqual(projectColor('AI').bg)
  })
})

describe('projectInitial', () => {
  it('앞 2자 대문자', () => {
    expect(projectInitial('wp')).toBe('WP')
    expect(projectInitial('Engineering')).toBe('EN')
  })

  it('1자 key 는 1자', () => {
    expect(projectInitial('x')).toBe('X')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/workplace-web && npx vitest run src/lib/project-color.test.ts`
Expected: FAIL ("Cannot find module './project-color'")

- [ ] **Step 3: 구현**

```ts
// 프로젝트 시각 식별자 — 백엔드에 색상 필드가 없어 key 해시로 결정적 색을 생성한다.
// 같은 key 는 항상 같은 색(hue). 사이드바 프로젝트 항목의 컬러 사각형에 사용.

/** key 문자열 → 결정적 HSL 배경/전경색. */
export function projectColor(key: string): { bg: string; fg: string } {
  let h = 0
  for (let i = 0; i < key.length; i++) {
    // 32bit unsigned 해시 — 같은 입력은 항상 같은 출력.
    h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0
  }
  const hue = h % 360
  // 채도/명도 고정 — 다크/라이트 모두에서 흰 텍스트가 읽히도록 명도 45%.
  return { bg: `hsl(${hue} 60% 45%)`, fg: 'hsl(0 0% 100%)' }
}

/** key 앞 1–2자 대문자 — 컬러 사각형 안에 표시. */
export function projectInitial(key: string): string {
  return key.slice(0, 2).toUpperCase()
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/workplace-web && npx vitest run src/lib/project-color.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-web/src/lib/project-color.ts apps/workplace-web/src/lib/project-color.test.ts
git commit -m "feat(web): 프로젝트 컬러 유틸(projectColor/projectInitial) — key 해시 결정적 색"
```

---

## Task 3: 프론트 — 공유 이슈 목록 컴포넌트 추출

WatchedIssuesPage 의 테이블 + 무한스크롤을 재사용 컴포넌트로 추출한다. 내 작업 3탭·AI 위임이 모두 공유한다(DRY). 동작 변경 없음 → 기존 watched E2E 가 회귀 게이트.

**Files:**
- Create: `apps/workplace-web/src/components/issue/IssueListTable.tsx`
- Create: `apps/workplace-web/src/components/issue/InfiniteIssueList.tsx`
- Modify: `apps/workplace-web/src/pages/me/WatchedIssuesPage.tsx`
- Test(회귀): `apps/workplace-web/e2e/pages/me/watched.spec.ts` (기존)

- [ ] **Step 1: IssueListTable 생성** — WatchedIssuesPage 테이블 마크업을 그대로 옮기되 `rowTestIdPrefix` 로 테스트 id 를 파라미터화한다(기존은 `watched-row`).

```tsx
// 이슈 목록 테이블 — ID/제목/상태/우선순위. 내 작업·AI 위임 등 여러 뷰에서 공유.
import { Link } from 'react-router-dom'

import { IssueTypeBadge } from '../issueTypes/IssueTypeBadge'
import { LabelChip } from '../labels/LabelChip'
import type { IssueResponse } from '../../types/issue'
import { IssuePriorityBadge } from '../../pages/projects/components/IssuePriorityBadge'
import { IssueStatusBadge } from '../../pages/projects/components/IssueStatusBadge'

export function IssueListTable({
  items,
  rowTestIdPrefix,
}: {
  items: IssueResponse[]
  /** 행 testid 접두어 — 예: "watched-row" → "watched-row-12". */
  rowTestIdPrefix: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground border-b">
            <th className="py-2 w-32">ID</th>
            <th>제목</th>
            <th className="w-28">상태</th>
            <th className="w-24">우선순위</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr
              key={it.id}
              className="border-b hover:bg-accent"
              data-testid={`${rowTestIdPrefix}-${it.id}`}
            >
              <td className="py-2 font-mono text-muted-foreground">
                {it.projectKey}-{it.number}
              </td>
              <td>
                <div className="flex items-center gap-2">
                  {it.type && <IssueTypeBadge type={it.type} size="sm" />}
                  <Link
                    to={`/projects/${it.projectKey}/issues/${it.number}`}
                    className="hover:underline font-medium"
                  >
                    {it.title}
                  </Link>
                </div>
                {it.labels.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {it.labels.map((l) => (
                      <LabelChip key={l.id} label={l} size="sm" />
                    ))}
                  </div>
                )}
              </td>
              <td>
                <IssueStatusBadge status={it.status} />
              </td>
              <td>
                <IssuePriorityBadge priority={it.priority} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: InfiniteIssueList 생성** — useInfiniteQuery 결과를 받아 flatten + sentinel + 빈/로딩 상태 + (선택)클라이언트 필터를 처리한다. AI 위임은 `filter` 로 `kind==='AGENT'` 적용.

```tsx
// 무한스크롤 이슈 목록 — useInfiniteQuery 결과를 받아 테이블 + sentinel 렌더.
// filter 를 주면 페이지 합본에 클라이언트 필터 적용(AI 위임 작업: assignee.kind==='AGENT').
import { useEffect, useRef } from 'react'
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'

import { IssueListTable } from './IssueListTable'
import type { IssueResponse, IssueSearchResponse } from '../../types/issue'

export function InfiniteIssueList({
  query,
  rowTestIdPrefix,
  emptyText,
  filter,
}: {
  query: UseInfiniteQueryResult<InfiniteData<IssueSearchResponse>, Error>
  rowTestIdPrefix: string
  emptyText: string
  filter?: (it: IssueResponse) => boolean
}) {
  const { data, fetchNextPage, hasNextPage, isFetching, isLoading } = query
  const sentinel = useRef<HTMLDivElement | null>(null)

  // sentinel 진입 → 다음 페이지 자동 fetch.
  useEffect(() => {
    const node = sentinel.current
    if (!node) return
    const io = new IntersectionObserver(
      (es) => {
        if (es[0]?.isIntersecting && hasNextPage && !isFetching) void fetchNextPage()
      },
      { rootMargin: '200px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [hasNextPage, isFetching, fetchNextPage])

  let items = data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? []
  if (filter) items = items.filter(filter)

  return (
    <div className="space-y-4">
      {isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">{emptyText}</p>
      ) : (
        <IssueListTable items={items} rowTestIdPrefix={rowTestIdPrefix} />
      )}
      <div ref={sentinel} aria-hidden="true" className="h-1" />
      {isFetching && !isLoading && <p className="text-muted-foreground py-2">불러오는 중…</p>}
    </div>
  )
}
```

- [ ] **Step 3: WatchedIssuesPage 를 공유 컴포넌트로 리팩터**

```tsx
// 내 태스크(구독) — 공유 InfiniteIssueList 사용. /me/tasks/watched 탭과 동일 렌더.
import { InfiniteIssueList } from '../../components/issue/InfiniteIssueList'
import { useWatchedIssues } from '../../hooks/queries/useWatchedIssues'

export default function WatchedIssuesPage() {
  const query = useWatchedIssues()
  return (
    <div className="container mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">내 태스크</h1>
      <InfiniteIssueList
        query={query}
        rowTestIdPrefix="watched-row"
        emptyText="구독 중인 태스크가 없습니다."
      />
    </div>
  )
}
```

- [ ] **Step 4: 타입체크 + 기존 watched E2E 회귀 통과 확인**

Run: `cd apps/workplace-web && npx tsc -b --noEmit && npx playwright test e2e/pages/me/watched.spec.ts`
Expected: PASS (testid `watched-row-*` 유지로 기존 spec 그대로 통과)

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-web/src/components/issue/IssueListTable.tsx \
        apps/workplace-web/src/components/issue/InfiniteIssueList.tsx \
        apps/workplace-web/src/pages/me/WatchedIssuesPage.tsx
git commit -m "refactor(web): 이슈 목록 테이블·무한스크롤을 공유 컴포넌트로 추출"
```

---

## Task 4: 프론트 — 내 작업 페이지(3탭) + /me/issues 훅

**Files:**
- Create: `apps/workplace-web/src/api/meIssues.ts`
- Create: `apps/workplace-web/src/hooks/queries/useMeIssues.ts`
- Create: `apps/workplace-web/src/pages/me/MyTasksPage.tsx`
- Modify: `apps/workplace-web/src/App.tsx`
- Test: `apps/workplace-web/e2e/pages/me/my-tasks.spec.ts`

- [ ] **Step 1: 실패 E2E 작성** — 탭별 API query param 검증 + 결과 렌더.

```ts
import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'

test('내 작업 — 할당 탭은 assignee=me 로 조회하고 결과를 렌더한다', async ({
  authenticatedPage: page,
}) => {
  const cap = await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([createIssue({ id: 11, title: '할당된 이슈' })]),
    { capture: true },
  )
  await page.goto('/me/tasks/assigned')

  const req = await cap.waitForRequest()
  expect(req.url).toContain('assignee=me')
  await expect(page.getByTestId('watched-row-11')).toContainText('할당된 이슈')
})

test('내 작업 — 내가 만든 탭은 reporter=me 로 조회한다', async ({ authenticatedPage: page }) => {
  const cap = await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([createIssue({ id: 22, title: '내가 만든 이슈' })]),
    { capture: true },
  )
  await page.goto('/me/tasks/reported')

  const req = await cap.waitForRequest()
  expect(req.url).toContain('reporter=me')
  await expect(page.getByTestId('watched-row-22')).toContainText('내가 만든 이슈')
})

test('내 작업 — 탭 클릭으로 경로가 바뀐다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse([]))
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', createIssueSearchResponse([]))
  await page.goto('/me/tasks/assigned')
  await page.getByTestId('tab-reported').click()
  await expect(page).toHaveURL(/\/me\/tasks\/reported$/)
})
```

> 참고: `mockApi(page, 'GET', '/api/v1/me/issues', ...)` 는 pathname 정확 매칭이라 `assignee=me`·`reporter=me` 둘 다 같은 스텁에 매칭된다. query 구분은 capture 의 `req.url` 로 검증한다. `waitForRequest`/`req.url` 헬퍼 시그니처는 `e2e/fixtures/api-mock.ts` 의 capture 구현을 따른다(`home.spec.ts` 의 `composeCapture.waitForRequest()` 사용례 참조).

- [ ] **Step 2: E2E 실패 확인**

Run: `cd apps/workplace-web && npx playwright test e2e/pages/me/my-tasks.spec.ts`
Expected: FAIL (라우트/페이지 없음 → 404 또는 testid 없음)

- [ ] **Step 3: meIssues API 작성**

```ts
// 프로젝트 횡단 "내 이슈" 검색 — /me/issues. assignee/reporter 등 필터를 쿼리스트링으로 전달.
import { client } from './client'
import type { IssueSearchResponse } from '../types/issue'

export async function fetchMeIssues(
  params: Record<string, string>,
  cursor: string | null,
  size = 30,
): Promise<IssueSearchResponse> {
  const sp = new URLSearchParams(params)
  if (cursor) sp.set('cursor', cursor)
  sp.set('size', String(size))
  const { data } = await client.get<IssueSearchResponse>(`/me/issues?${sp.toString()}`)
  return data
}
```

- [ ] **Step 4: useMeIssues 훅 작성**

```ts
// 프로젝트 횡단 "내 이슈"(할당/내가 만든 등) — params 필터, cursor 무한 스크롤.
import { useInfiniteQuery } from '@tanstack/react-query'

import { fetchMeIssues } from '../../api/meIssues'
import type { IssueSearchResponse } from '../../types/issue'

export function useMeIssues(params: Record<string, string>, size = 30) {
  return useInfiniteQuery<IssueSearchResponse, Error>({
    // params 를 key 에 포함 — 탭(assignee/reporter)마다 캐시 분리.
    queryKey: ['me-issues', params, size],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchMeIssues(params, pageParam as string | null, size),
    getNextPageParam: (last) => last.nextCursor,
  })
}
```

- [ ] **Step 5: MyTasksPage 작성** — 탭 3개. 각 탭은 별도 컴포넌트(훅 규칙 준수: 활성 탭만 마운트). 잘못된 `:tab` → assigned.

```tsx
// 내 작업 — 할당/내가 만든/구독 3탭. 경로 기반(/me/tasks/:tab)으로 공유 가능한 URL.
import { useNavigate, useParams } from 'react-router-dom'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { InfiniteIssueList } from '@/components/issue/InfiniteIssueList'
import { useMeIssues } from '@/hooks/queries/useMeIssues'
import { useWatchedIssues } from '@/hooks/queries/useWatchedIssues'

const TABS = ['assigned', 'reported', 'watched'] as const
type Tab = (typeof TABS)[number]

function AssignedTab() {
  const query = useMeIssues({ assignee: 'me' })
  return (
    <InfiniteIssueList query={query} rowTestIdPrefix="watched-row" emptyText="할당된 작업이 없습니다." />
  )
}

function ReportedTab() {
  const query = useMeIssues({ reporter: 'me' })
  return (
    <InfiniteIssueList query={query} rowTestIdPrefix="watched-row" emptyText="내가 만든 작업이 없습니다." />
  )
}

function WatchedTab() {
  const query = useWatchedIssues()
  return (
    <InfiniteIssueList query={query} rowTestIdPrefix="watched-row" emptyText="구독 중인 작업이 없습니다." />
  )
}

export default function MyTasksPage() {
  const navigate = useNavigate()
  const { tab } = useParams<{ tab: string }>()
  // 잘못된 탭은 할당으로 폴백(에러 아님).
  const active: Tab = (TABS as readonly string[]).includes(tab ?? '') ? (tab as Tab) : 'assigned'

  return (
    <div className="container mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">내 작업</h1>
      <Tabs value={active} onValueChange={(v) => navigate(`/me/tasks/${v}`)}>
        <TabsList>
          <TabsTrigger value="assigned" data-testid="tab-assigned">할당</TabsTrigger>
          <TabsTrigger value="reported" data-testid="tab-reported">내가 만든</TabsTrigger>
          <TabsTrigger value="watched" data-testid="tab-watched">구독</TabsTrigger>
        </TabsList>
      </Tabs>
      {active === 'assigned' && <AssignedTab />}
      {active === 'reported' && <ReportedTab />}
      {active === 'watched' && <WatchedTab />}
    </div>
  )
}
```

- [ ] **Step 6: App.tsx 라우트 추가** — lazy import + `/me/tasks/:tab` + `/me/tasks` 리다이렉트. `IssueModuleLayout` 중첩 블록(`me/watched` 옆)에 추가한다. 파일 상단에 `Navigate` import 확인(`react-router-dom`).

lazy import 추가(기존 `WatchedIssuesPage` import 근처):
```tsx
const MyTasksPage = lazy(() => import('./pages/me/MyTasksPage'))
```

`<Route element={<IssueModuleLayout />}>` 블록 내부에 추가:
```tsx
  {/* 내 작업 — 할당/내가 만든/구독 3탭 */}
  <Route path="me/tasks" element={<Navigate to="/me/tasks/assigned" replace />} />
  <Route path="me/tasks/:tab" element={<MyTasksPage />} />
```

`Navigate` 가 import 되어 있지 않으면 추가:
```tsx
import { Navigate, Route, Routes } from 'react-router-dom'
```

- [ ] **Step 7: E2E + 타입체크 통과 확인**

Run: `cd apps/workplace-web && npx tsc -b --noEmit && npx playwright test e2e/pages/me/my-tasks.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 8: 커밋**

```bash
git add apps/workplace-web/src/api/meIssues.ts \
        apps/workplace-web/src/hooks/queries/useMeIssues.ts \
        apps/workplace-web/src/pages/me/MyTasksPage.tsx \
        apps/workplace-web/src/App.tsx \
        apps/workplace-web/e2e/pages/me/my-tasks.spec.ts
git commit -m "feat(web): 내 작업 페이지(할당/내가 만든/구독 3탭) + /me/issues 훅"
```

---

## Task 5: 프론트 — AI 위임 작업 페이지

reporter=me 결과를 클라이언트에서 `assignee.kind==='AGENT'` 로 필터. 추가 백엔드 0.

**Files:**
- Create: `apps/workplace-web/src/pages/me/AiDelegatedTasksPage.tsx`
- Modify: `apps/workplace-web/src/App.tsx`
- Test: `apps/workplace-web/e2e/pages/me/ai-tasks.spec.ts`

- [ ] **Step 1: 실패 E2E 작성** — HUMAN/AGENT 담당 혼합 응답 → AGENT 담당만 표시.

```ts
import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import type { UserSummary } from '../../../src/types/user'

const human: UserSummary = { id: 1, username: 'kim', name: '김사람', kind: 'HUMAN' }
const agent: UserSummary = { id: 9, username: 'claude', name: 'Claude', kind: 'AGENT' }

test('AI 위임 작업 — reporter=me 중 담당이 AGENT 인 이슈만 표시', async ({
  authenticatedPage: page,
}) => {
  const cap = await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([
      createIssue({ id: 31, title: 'AI 가 담당', assignees: [agent] }),
      createIssue({ id: 32, title: '사람이 담당', assignees: [human] }),
      createIssue({ id: 33, title: '담당 없음', assignees: [] }),
    ]),
    { capture: true },
  )
  await page.goto('/me/ai-tasks')

  const req = await cap.waitForRequest()
  expect(req.url).toContain('reporter=me')
  await expect(page.getByTestId('ai-row-31')).toContainText('AI 가 담당')
  await expect(page.getByTestId('ai-row-32')).toHaveCount(0)
  await expect(page.getByTestId('ai-row-33')).toHaveCount(0)
})

test('AI 위임 작업 — 비어 있으면 안내 문구', async ({ authenticatedPage: page }) => {
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([createIssue({ id: 41, assignees: [human] })]),
  )
  await page.goto('/me/ai-tasks')
  await expect(page.getByText('AI에게 맡긴 작업이 아직 없어요')).toBeVisible()
})
```

- [ ] **Step 2: E2E 실패 확인**

Run: `cd apps/workplace-web && npx playwright test e2e/pages/me/ai-tasks.spec.ts`
Expected: FAIL (라우트/페이지 없음)

- [ ] **Step 3: AiDelegatedTasksPage 작성**

```tsx
// AI 위임 작업 — 내가 만든 이슈(reporter=me) 중 담당이 AI(AGENT)인 것.
// 추가 백엔드 없이 reporter=me 결과를 클라이언트에서 kind 필터.
import { InfiniteIssueList } from '@/components/issue/InfiniteIssueList'
import { useMeIssues } from '@/hooks/queries/useMeIssues'

export default function AiDelegatedTasksPage() {
  const query = useMeIssues({ reporter: 'me' })
  return (
    <div className="container mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">AI 위임 작업</h1>
      <InfiniteIssueList
        query={query}
        rowTestIdPrefix="ai-row"
        emptyText="AI에게 맡긴 작업이 아직 없어요"
        filter={(it) => it.assignees.some((a) => a.kind === 'AGENT')}
      />
    </div>
  )
}
```

- [ ] **Step 4: App.tsx 라우트 추가**

lazy import:
```tsx
const AiDelegatedTasksPage = lazy(() => import('./pages/me/AiDelegatedTasksPage'))
```

`<Route element={<IssueModuleLayout />}>` 블록 내부:
```tsx
  {/* AI 위임 작업 — 내가 만든 이슈 중 AI 담당 */}
  <Route path="me/ai-tasks" element={<AiDelegatedTasksPage />} />
```

- [ ] **Step 5: E2E + 타입체크 통과 확인**

Run: `cd apps/workplace-web && npx tsc -b --noEmit && npx playwright test e2e/pages/me/ai-tasks.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: 커밋**

```bash
git add apps/workplace-web/src/pages/me/AiDelegatedTasksPage.tsx \
        apps/workplace-web/src/App.tsx \
        apps/workplace-web/e2e/pages/me/ai-tasks.spec.ts
git commit -m "feat(web): AI 위임 작업 페이지 — reporter=me 중 AGENT 담당 필터"
```

---

## Task 6: 프론트 — 사이드바 개편(내 작업/AI 위임 + 프로젝트 컬러)

**Files:**
- Modify: `apps/workplace-web/src/components/issue/IssueSidebar.tsx`
- Modify: `apps/workplace-web/e2e/pages/issue-sidebar.spec.ts`

- [ ] **Step 1: 기존 사이드바 E2E 갱신(실패 상태로)** — `issue-sidebar.spec.ts` 의 `'내 태스크'` 링크 기대를 새 메뉴로 교체하고, 프로젝트 컬러 사각형 검증을 추가한다.

첫 번째 테스트의 링크 단언 교체:
```ts
  await expect(page.getByTestId('issue-sidebar').getByRole('link', { name: '내 작업' })).toBeVisible()
  await expect(page.getByTestId('issue-sidebar').getByRole('link', { name: 'AI 위임 작업' })).toBeVisible()
```

두 번째 테스트(프로젝트 렌더)에 컬러 사각형 단언 추가(`getByRole('link', { name: 'Engineering' })` 블록 뒤):
```ts
  // 프로젝트 항목은 컬러 식별자(이니셜 배지)를 갖는다 — 아이콘 일관성.
  await expect(page.getByTestId('project-badge-ENG')).toHaveText('EN')
```

- [ ] **Step 2: E2E 실패 확인**

Run: `cd apps/workplace-web && npx playwright test e2e/pages/issue-sidebar.spec.ts`
Expected: FAIL ('내 작업' 링크 없음, project-badge 없음)

- [ ] **Step 3: IssueSidebar 개편**

```tsx
// 이슈 모듈 2차 사이드바 — 개인 영역(내 작업/AI 위임) + 프로젝트(컬러 식별자).
import { LayoutList, ListChecks, Plus, Sparkles } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { sidebarLinkClass, sidebarTitleClass } from '@/components/layout/sidebar-link'
import { useProjects } from '@/hooks/queries/useProjects'
import { projectColor, projectInitial } from '@/lib/project-color'

export function IssueSidebar() {
  // 프로젝트 목록은 PageResponse<ProjectResponse> 형태 — data.content 로 접근한다.
  const projects = useProjects()

  return (
    <aside
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40"
      data-testid="issue-sidebar"
    >
      {/* 앱 타이틀 헤더 — 레일과 동일한 앱 아이콘 + 이름으로 "작업 관리" 앱임을 명시(Slack 모델) */}
      <div className={sidebarTitleClass}>
        <LayoutList className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        작업 관리
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* 개인 영역 — 경쟁 솔루션 공통 패턴: 개인 작업을 사이드바 최상단에 고정 */}
        <nav className="space-y-1">
          <NavLink to="/me/tasks/assigned" className={sidebarLinkClass}>
            <ListChecks className="h-4 w-4" /> 내 작업
          </NavLink>
          <NavLink to="/me/ai-tasks" className={sidebarLinkClass}>
            <Sparkles className="h-4 w-4" /> AI 위임 작업
          </NavLink>
        </nav>

        <div className="mt-5">
          <div className="flex items-center justify-between px-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              프로젝트
            </span>
            <NavLink
              to="/projects"
              aria-label="프로젝트 전체 보기"
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </NavLink>
          </div>
          <nav className="mt-2 space-y-1">
            {(projects.data?.content ?? []).map((p) => {
              // 백엔드에 색상 필드가 없어 key 해시로 결정적 컬러 식별자 생성(아이콘 일관성).
              const c = projectColor(p.key)
              return (
                <NavLink key={p.id} to={`/projects/${p.key}`} className={sidebarLinkClass}>
                  <span
                    data-testid={`project-badge-${p.key}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold"
                    style={{ backgroundColor: c.bg, color: c.fg }}
                  >
                    {projectInitial(p.key)}
                  </span>
                  <span className="truncate">{p.name}</span>
                </NavLink>
              )
            })}
          </nav>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: E2E + 타입체크 통과 확인**

Run: `cd apps/workplace-web && npx tsc -b --noEmit && npx playwright test e2e/pages/issue-sidebar.spec.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-web/src/components/issue/IssueSidebar.tsx \
        apps/workplace-web/e2e/pages/issue-sidebar.spec.ts
git commit -m "feat(web): 작업 관리 사이드바 개편 — 내 작업/AI 위임 + 프로젝트 컬러 식별자"
```

---

## Task 7: 프론트 — /me/watched 하위호환 리다이렉트

기존 `/me/watched` 진입을 `/me/tasks/watched` 로 리다이렉트한다. WatchedIssuesPage 컴포넌트는 더 이상 라우트에서 직접 쓰지 않지만(구독 탭이 동일 동작), 파일은 유지한다(별도 직접 진입 없음).

**Files:**
- Modify: `apps/workplace-web/src/App.tsx`
- Modify: `apps/workplace-web/e2e/pages/me/watched.spec.ts`

- [ ] **Step 1: watched E2E 를 리다이렉트 검증으로 갱신** — `e2e/pages/me/watched.spec.ts` 를 열어, `/me/watched` 로 goto 후 `/me/tasks/watched` 로 이동하고 구독 목록이 보이는지 검증하도록 바꾼다. 기존 테스트가 구독 응답을 모킹하고 `watched-row-*` 를 확인하던 부분은 그대로 두되, 진입 경로만 `/me/watched` → 리다이렉트로 확인.

테스트 본문에 리다이렉트 단언 추가(첫 goto 직후):
```ts
  await page.goto('/me/watched')
  await expect(page).toHaveURL(/\/me\/tasks\/watched$/)
```
(이후 기존 `watched-row-*` 단언은 구독 탭에서 동일하게 동작한다. 구독 응답 모킹은 `/api/v1/me/watched-issues` 그대로 유지.)

- [ ] **Step 2: E2E 실패 확인**

Run: `cd apps/workplace-web && npx playwright test e2e/pages/me/watched.spec.ts`
Expected: FAIL (`/me/watched` 가 아직 WatchedIssuesPage 직접 렌더 → URL 그대로)

- [ ] **Step 3: App.tsx — /me/watched 를 리다이렉트로 교체** — 기존 `<Route path="me/watched" element={<WatchedIssuesPage />} />` 를 교체:

```tsx
  {/* 하위호환 — 구버전 경로를 새 탭으로 리다이렉트 */}
  <Route path="me/watched" element={<Navigate to="/me/tasks/watched" replace />} />
```

`WatchedIssuesPage` lazy import 가 더 이상 라우트에서 안 쓰이면 미사용 경고가 난다 — import 라인을 제거하거나, `me/tasks/watched` 가 MyTasksPage 의 WatchedTab 으로 동작하므로 WatchedIssuesPage import 를 삭제한다.

- [ ] **Step 4: E2E + 타입체크 + 린트 통과 확인**

Run: `cd apps/workplace-web && npx tsc -b --noEmit && npx eslint . && npx playwright test e2e/pages/me/watched.spec.ts`
Expected: PASS (미사용 import 경고 0)

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-web/src/App.tsx apps/workplace-web/e2e/pages/me/watched.spec.ts
git commit -m "feat(web): /me/watched → /me/tasks/watched 하위호환 리다이렉트"
```

---

## Task 8: 전체 회귀 + 마무리

**Files:** (없음 — 검증만)

- [ ] **Step 1: 프론트 전체 게이트**

Run: `cd apps/workplace-web && npx tsc -b --noEmit && npx eslint . && npx vitest run && npx playwright test e2e/pages/me e2e/pages/issue-sidebar.spec.ts e2e/pages/home.spec.ts`
Expected: PASS (전부)

- [ ] **Step 2: 백엔드 전체 게이트**

Run: `cd apps/workplace-api && ./gradlew test`
Expected: BUILD SUCCESSFUL

- [ ] **Step 3: 최종 리뷰** — superpowers:finishing-a-development-branch 로 전체 변경을 리뷰하고 마무리한다.

---

## Self-Review

**Spec coverage:**
- 사이드바 구조(내 작업/AI 위임/프로젝트 컬러) → Task 6 ✓
- 내 작업 3탭(할당/내가만든/구독) + /me/tasks/:tab → Task 4 ✓
- AI 위임(reporter=me + kind=AGENT 클라이언트 필터) → Task 5 ✓
- 프로젝트 컬러 유틸 → Task 2 ✓
- 백엔드 reporter 필터 + JUnit → Task 1 ✓
- /me/watched 리다이렉트 → Task 7 ✓
- E2E(탭 query param·AI 필터·사이드바·리다이렉트) → Task 4/5/6/7 ✓
- 공유 컴포넌트 추출(DRY) → Task 3 ✓

**Type consistency:** `useMeIssues(params)`/`fetchMeIssues(params,cursor,size)`/`InfiniteIssueList({query,rowTestIdPrefix,emptyText,filter})`/`projectColor→{bg,fg}`/`projectInitial→string`/`IssueListTable({items,rowTestIdPrefix})` — Task 3·4·5·6 에서 일관 사용. `IssueResponse.assignees: UserSummary[]`, `UserSummary.kind: 'HUMAN'|'AGENT'` 확인됨.

**Placeholder scan:** 없음. Task 1 Step 6 의 "8곳 보정"은 컴파일러가 정확한 위치를 짚는 기계적 작업으로, grep 명령까지 제공.

**미확정 1건:** `e2e/pages/me/watched.spec.ts` 의 기존 본문은 직접 확인하지 않았다. Task 7 Step 1 은 "리다이렉트 단언 추가 + 구독 모킹 유지"라는 최소 변경만 지시하므로, 실행자가 파일을 열어 기존 구조에 맞춰 삽입한다.
