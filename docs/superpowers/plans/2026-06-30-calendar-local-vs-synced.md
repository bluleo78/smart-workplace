# 로컬 vs 연동 캘린더 구분 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캘린더 사이드바에서 로컬 캘린더와 외부 계정 연동 캘린더를 섹션으로 구분하고, 연동 섹션 헤더에 계정 이메일 + 공급자(M365) 라벨을 노출한다.

**Architecture:** 백엔드는 `CalendarResponse` 에 `accountEmail`/`provider`(둘 다 raw String, 로컬은 null) 두 필드를 추가하고, calendar 조회 쿼리에 `email_account` LEFT JOIN 을 건다(마이그레이션 0). 프론트는 `accountEmail` 로 캘린더를 그룹핑하는 순수 헬퍼를 만들고 `CalendarSidebar` 가 "내 캘린더" + 계정별 섹션으로 렌더한다.

**Tech Stack:** Spring Boot + jOOQ (백엔드), React 19 + TypeScript + Tailwind + shadcn/ui (프론트), JUnit 통합 테스트, Playwright E2E.

## Global Constraints

- 한국어 주석 필수 (클래스·메서드·주요 로직).
- 새 Flyway 마이그레이션 금지 — 기존 `calendar.external_account_id` / `email_account.email_address` / `email_account.provider` 컬럼만 활용. 스키마 변경이 없으므로 `generateJooq` 불필요.
- 도메인 모듈 경계 준수: calendar 모듈은 mail 모듈(`com.workplace.mail.*`)을 import 하지 않는다 → `provider` 는 `MailProvider` enum 이 아닌 **raw String**("M365_GRAPH"/"IMAP")으로 노출한다.
- 색상은 시맨틱 토큰만(hex 금지). 공급자 pill 은 "읽기 전용" 배지와 동일한 `Badge variant="secondary"` 톤.
- provider 라벨 매핑: `M365_GRAPH`→"M365", `IMAP`→"IMAP", 그 외→그대로.
- IMAP 은 일정 동기화를 하지 않음 → 현재 연동 캘린더의 provider 는 항상 `M365_GRAPH`. IMAP 분기는 forward-looking.
- 커밋/푸시는 사용자 승인 후에만. 각 Task 끝의 commit 스텝은 승인 시 실행.

---

### Task 1: 백엔드 — CalendarResponse 출처 노출 + email_account JOIN

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/calendar/dto/CalendarResponse.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/calendar/repository/CalendarRepository.java:22-27` (listByOwner), `:43-49` (findByIdForOwner), `:135-143` (toResponse)
- Modify: `apps/workplace-api/src/test/java/com/workplace/calendar/controller/CalendarControllerTest.java:58,83` (생성자 호출 2곳 — 컴파일 깨짐)
- Test: `apps/workplace-api/src/test/java/com/workplace/calendar/CalendarListReadOnlyTest.java` (테스트 메서드 추가)

**Interfaces:**
- Produces: `CalendarResponse(long id, String name, String color, boolean isDefault, int position, boolean isReadOnly, String accountEmail, String provider)` — `accountEmail`/`provider` 는 로컬 캘린더에서 null, 연동 캘린더에서 계정 이메일 / `"M365_GRAPH"`.
- Consumes: 기존 `ExternalCalendarRepository.upsertExternalCalendar(ownerId, accountId, externalId, name, color, readOnly)`, `TestFixtures.createHuman(dsl)`.

- [ ] **Step 1: 통합 테스트 추가 (RED — accountEmail()/provider() 미존재로 컴파일 실패)**

`CalendarListReadOnlyTest.java` 의 클래스 안에 메서드 추가. (기존 import: `EMAIL_ACCOUNT`, `TenantContext`, `TransactionTemplate`, `TestFixtures`, `CalendarResponse`, `assertThat` 이미 존재.)

```java
  /**
   * 연동 캘린더는 accountEmail/provider 를 노출하고, 로컬 캘린더는 둘 다 null 이어야 한다.
   * email_account JOIN 이 테넌트 RLS GUC 아래에서 행을 보이게 하는지까지 함께 검증한다
   * (accountEmail 이 null 로 떨어지면 연동 캘린더가 로컬로 오분류된다).
   */
  @Test
  void list_exposes_accountEmail_and_provider_for_synced_and_null_for_local() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              long ownerId = TestFixtures.createHuman(dsl);
              String email = "synced-" + System.nanoTime() + "@iacloud.kr";
              long accountId =
                  dsl.insertInto(
                          EMAIL_ACCOUNT,
                          EMAIL_ACCOUNT.USER_ID,
                          EMAIL_ACCOUNT.EMAIL_ADDRESS,
                          EMAIL_ACCOUNT.PROVIDER,
                          EMAIL_ACCOUNT.TENANT_ID,
                          EMAIL_ACCOUNT.AI_ENABLED)
                      .values(ownerId, email, "M365_GRAPH", TENANT_ID, false)
                      .returning(EMAIL_ACCOUNT.ID)
                      .fetchOne()
                      .getId();

              // 쓰기 가능 연동 캘린더(readOnly=false) — 로컬과 isReadOnly 로는 구분 불가한 케이스
              externalCalendarRepo.upsertExternalCalendar(
                  ownerId, accountId, "extCal1", "M365 달력", "blue", false);

              List<CalendarResponse> cals = calendarService.list(ownerId);

              CalendarResponse synced =
                  cals.stream()
                      .filter(c -> c.accountEmail() != null)
                      .findFirst()
                      .orElseThrow();
              assertThat(synced.accountEmail()).isEqualTo(email);
              assertThat(synced.provider()).isEqualTo("M365_GRAPH");

              CalendarResponse local =
                  cals.stream().filter(CalendarResponse::isDefault).findFirst().orElseThrow();
              assertThat(local.accountEmail()).isNull();
              assertThat(local.provider()).isNull();

              status.setRollbackOnly();
              return null;
            });
  }
```

- [ ] **Step 2: 컴파일/테스트 실행 → 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.calendar.CalendarListReadOnlyTest" --rerun-tasks`
Expected: 컴파일 실패 — `cannot find symbol: method accountEmail()` / `provider()` (CalendarResponse 에 아직 없음).

- [ ] **Step 3: CalendarResponse 에 필드 2개 추가**

`CalendarResponse.java` 전체를 다음으로:

```java
package com.workplace.calendar.dto;

/**
 * 캘린더 응답. isReadOnly=true 이면 편집 불가(외부 읽기전용 컨테이너).
 * accountEmail/provider 가 non-null 이면 외부 계정 연동 캘린더(로컬은 둘 다 null). provider 는
 * email_account.provider 의 raw 문자열("M365_GRAPH"/"IMAP") — 모듈 경계상 mail enum 을 쓰지 않는다.
 */
public record CalendarResponse(
    long id,
    String name,
    String color,
    boolean isDefault,
    int position,
    boolean isReadOnly,
    String accountEmail,
    String provider) {}
```

- [ ] **Step 4: CalendarRepository — JOIN + toResponse 매핑**

`CalendarRepository.java` 상단 import 에 추가:

```java
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
```

`listByOwner` 교체 (라인 22-27):

```java
  /** 소유자의 캘린더 목록(position, id 정렬). 연동 캘린더는 email_account JOIN 으로 출처 노출. */
  public List<CalendarResponse> listByOwner(long ownerId) {
    return dsl.select(CALENDAR.asterisk(), EMAIL_ACCOUNT.EMAIL_ADDRESS, EMAIL_ACCOUNT.PROVIDER)
        .from(CALENDAR)
        .leftJoin(EMAIL_ACCOUNT)
        .on(CALENDAR.EXTERNAL_ACCOUNT_ID.eq(EMAIL_ACCOUNT.ID))
        .where(CALENDAR.OWNER_ID.eq(ownerId))
        .orderBy(CALENDAR.POSITION.asc(), CALENDAR.ID.asc())
        .fetch(CalendarRepository::toResponse);
  }
```

`findByIdForOwner` 교체 (라인 43-49):

```java
  /** 소유자 본인 캘린더 단건. */
  public Optional<CalendarResponse> findByIdForOwner(long ownerId, long id) {
    return dsl.select(CALENDAR.asterisk(), EMAIL_ACCOUNT.EMAIL_ADDRESS, EMAIL_ACCOUNT.PROVIDER)
        .from(CALENDAR)
        .leftJoin(EMAIL_ACCOUNT)
        .on(CALENDAR.EXTERNAL_ACCOUNT_ID.eq(EMAIL_ACCOUNT.ID))
        .where(CALENDAR.ID.eq(id))
        .and(CALENDAR.OWNER_ID.eq(ownerId))
        .fetchOptional()
        .map(CalendarRepository::toResponse);
  }
```

`toResponse` 교체 (라인 135-143):

```java
  private static CalendarResponse toResponse(Record r) {
    return new CalendarResponse(
        r.get(CALENDAR.ID),
        r.get(CALENDAR.NAME),
        r.get(CALENDAR.COLOR),
        r.get(CALENDAR.IS_DEFAULT),
        r.get(CALENDAR.POSITION),
        Boolean.TRUE.equals(r.get(CALENDAR.IS_READ_ONLY)),
        r.get(EMAIL_ACCOUNT.EMAIL_ADDRESS), // 로컬 캘린더는 JOIN 행 없어 null
        r.get(EMAIL_ACCOUNT.PROVIDER)); // 로컬 캘린더는 null
  }
```

참고: `calendar` 테이블에 `email_address`/`provider` 동명 컬럼이 없으므로 `CALENDAR.asterisk()` + 두 컬럼 라벨 충돌 없음(jOOQ 컴파일/런타임으로 자연 검증, alias 불필요).

- [ ] **Step 5: 컨트롤러 테스트 생성자 호출 2곳 보정 (컴파일 복구)**

`CalendarControllerTest.java:58`:

```java
    return new CalendarResponse(1L, "기본", "blue", true, 0, false, null, null);
```

`CalendarControllerTest.java:83`:

```java
        .thenReturn(new CalendarResponse(2L, "업무", "red", false, 1, false, null, null));
```

- [ ] **Step 6: 테스트 실행 → 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.calendar.CalendarListReadOnlyTest" --tests "com.workplace.calendar.controller.CalendarControllerTest" --rerun-tasks`
Expected: PASS (신규 테스트 포함 전부 그린).

- [ ] **Step 7: 커밋 (승인 후)**

```bash
git add apps/workplace-api/src/main/java/com/workplace/calendar/dto/CalendarResponse.java \
        apps/workplace-api/src/main/java/com/workplace/calendar/repository/CalendarRepository.java \
        apps/workplace-api/src/test/java/com/workplace/calendar/CalendarListReadOnlyTest.java \
        apps/workplace-api/src/test/java/com/workplace/calendar/controller/CalendarControllerTest.java
git commit -m "feat(calendar): CalendarResponse 에 연동 출처(accountEmail/provider) 노출

email_account LEFT JOIN 으로 로컬(null)과 외부 연동 캘린더(계정 이메일+공급자) 구분.
마이그 0 — 기존 external_account_id 컬럼 활용. provider 는 모듈경계상 raw String."
```

---

### Task 2: 프론트 — 사이드바 로컬/연동 섹션 그룹핑 (C1)

**Files:**
- Modify: `apps/workplace-web/src/types/calendar.ts:88-96` (Calendar 인터페이스)
- Modify: `apps/workplace-web/src/lib/calendar.ts` (그룹핑 헬퍼 + providerLabel 추가)
- Modify: `apps/workplace-web/src/components/calendar/CalendarSidebar.tsx` (섹션 렌더)
- Modify: `apps/workplace-web/e2e/factories/calendar.factory.ts:27-38` (팩토리 기본값)
- Modify: `apps/workplace-web/e2e/pages/calendar-external-readonly.spec.ts` (연동 캘린더 mock 에 출처 추가)
- Test: `apps/workplace-web/e2e/pages/calendar-sidebar.spec.ts` (그룹핑 검증 테스트 추가)

**Interfaces:**
- Consumes: Task 1 의 `Calendar.accountEmail`/`Calendar.provider`.
- Produces:
  - `providerLabel(provider: string | null | undefined): string`
  - `groupCalendarsBySource(calendars: Calendar[]): { local: Calendar[]; accounts: { email: string; provider: string | null; calendars: Calendar[] }[] }` — `accounts` 는 첫 등장 순서 유지.

- [ ] **Step 1: Calendar 타입에 출처 필드 추가**

`types/calendar.ts` 의 `Calendar` 인터페이스(라인 88-96) 에 추가:

```ts
// 개인 캘린더(컨테이너).
export interface Calendar {
  id: number
  name: string
  color: string
  isDefault: boolean
  position: number
  // M365 등 외부 동기화 컨테이너인 경우 true — 이름·색 편집·삭제 불가. (이슈 #501)
  isReadOnly: boolean
  // 외부 계정 연동 캘린더의 출처 계정 이메일. 로컬 캘린더는 null.
  accountEmail?: string | null
  // 출처 공급자 raw 문자열('M365_GRAPH' | 'IMAP'). 로컬 캘린더는 null.
  provider?: string | null
}
```

- [ ] **Step 2: lib/calendar.ts 에 헬퍼 추가**

`lib/calendar.ts` 끝에 추가 (상단에 `import type { Calendar } from '@/types/calendar'` 가 없으면 추가):

```ts
// 공급자 raw 문자열 → 사이드바 pill 라벨. IMAP 은 일정 동기화를 안 하므로 현재는 M365 만 실제 등장.
export function providerLabel(provider: string | null | undefined): string {
  switch (provider) {
    case 'M365_GRAPH':
      return 'M365'
    case 'IMAP':
      return 'IMAP'
    default:
      return provider ?? ''
  }
}

// 사이드바 섹션 그룹핑 결과. accounts 는 계정 첫 등장 순서를 유지한다.
export interface CalendarSourceGroups {
  local: Calendar[]
  accounts: { email: string; provider: string | null; calendars: Calendar[] }[]
}

// accountEmail 기준으로 로컬/연동 캘린더를 분리·그룹핑. 입력 정렬(position,id)은 백엔드가 보장.
export function groupCalendarsBySource(calendars: Calendar[]): CalendarSourceGroups {
  const local: Calendar[] = []
  const accounts: CalendarSourceGroups['accounts'] = []
  const byEmail = new Map<string, CalendarSourceGroups['accounts'][number]>()
  for (const c of calendars) {
    if (!c.accountEmail) {
      local.push(c)
      continue
    }
    let group = byEmail.get(c.accountEmail)
    if (!group) {
      group = { email: c.accountEmail, provider: c.provider ?? null, calendars: [] }
      byEmail.set(c.accountEmail, group)
      accounts.push(group)
    }
    group.calendars.push(c)
  }
  return { local, accounts }
}
```

- [ ] **Step 3: CalendarSidebar — 아이템 렌더러 추출 + 섹션 렌더**

`CalendarSidebar.tsx` 의 import 에 `groupCalendarsBySource`, `providerLabel` 추가:

```ts
import {
  type CalendarLayers,
  groupCalendarsBySource,
  isCalendarVisible,
  providerLabel,
} from '@/lib/calendar'
```

"내 캘린더 그룹" 블록(라인 77-141)을 통째로 아래로 교체. 핵심: 캘린더 1행 렌더를 `renderItem` 으로 추출(DRY)하여 로컬 섹션과 계정 섹션이 분기하지 않게 한다.

```tsx
      {/* 캘린더 목록 — 로컬("내 캘린더") + 계정별 연동 섹션으로 그룹핑 */}
      {(() => {
        const { local, accounts } = groupCalendarsBySource(calendars)
        // 캘린더 1행 — 체크박스 + 색 점 + 이름 + (읽기전용 배지 | hover 편집). 로컬·연동 공용.
        const renderItem = (c: CalendarType) => {
          const palette = resolvePalette(c.color)
          const visible = isCalendarVisible(layers, c.id)
          return (
            <div
              key={c.id}
              data-testid={`calendar-list-item-${c.id}`}
              className="group mb-1 flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                data-testid={`calendar-toggle-${c.id}`}
                checked={visible}
                onCheckedChange={() => onToggleCalendar(c.id)}
                aria-label={`캘린더 표시: ${c.name}`}
              />
              <span
                className={`size-2.5 shrink-0 rounded-sm ${palette.dotClass}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.isReadOnly ? (
                <Badge
                  variant="secondary"
                  className="h-4 shrink-0 px-1 text-[10px]"
                  data-testid="calendar-readonly-badge"
                >
                  읽기 전용
                </Badge>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100"
                  data-testid={`calendar-edit-${c.id}`}
                  aria-label={`${c.name} 편집`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEditCalendar(c)
                  }}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
            </div>
          )
        }

        return (
          <>
            {/* 내 캘린더(로컬) 섹션 */}
            <div className="mt-2 px-3 pb-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  내 캘린더
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  data-testid="calendar-add"
                  aria-label="캘린더 추가"
                  onClick={onAddCalendar}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              {local.map(renderItem)}
            </div>

            {/* 계정별 연동 섹션 — 헤더: 이메일(일반 표기) + 공급자 회색 pill */}
            {accounts.map((acct) => (
              <div
                key={acct.email}
                data-testid={`calendar-account-section-${acct.email}`}
                className="border-t px-3 pb-2 pt-2"
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
                    {acct.email}
                  </span>
                  <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
                    {providerLabel(acct.provider)}
                  </Badge>
                </div>
                {acct.calendars.map(renderItem)}
              </div>
            ))}
          </>
        )
      })()}
```

(상단 주석 라인 1 "개인 캘린더별 토글" 은 그대로 두고, 미니 캘린더 블록과 "기타" 그룹 블록은 변경 없음.)

- [ ] **Step 4: E2E 팩토리 기본값 보강**

`e2e/factories/calendar.factory.ts` 의 `calendar()` 기본값(라인 27-38)에 추가:

```ts
export function calendar(over: Partial<Calendar> = {}): Calendar {
  return {
    id: 1,
    name: '기본',
    color: 'blue',
    isDefault: true,
    position: 0,
    isReadOnly: false,
    accountEmail: null,
    provider: null,
    ...over,
  }
}
```

- [ ] **Step 5: 기존 readonly E2E 의 연동 캘린더 mock 에 출처 부여 (RED 가능)**

`e2e/pages/calendar-external-readonly.spec.ts` 에서 isReadOnly:true 캘린더(M365) mock 에 `accountEmail`/`provider` 추가 — 현실(연동 캘린더는 항상 계정 보유) 반영. 예:

```ts
    await stubCalendars(page, [
      calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false }),
      calendar({
        id: 10,
        name: 'M365 캘린더',
        color: 'indigo',
        isDefault: false,
        isReadOnly: true,
        accountEmail: 'dh.yang@iacloud.kr',
        provider: 'M365_GRAPH',
      }),
    ])
```

(기존 readonly 배지 단언은 그대로 둔다 — 연동 섹션 안에서도 배지가 보여야 한다.)

- [ ] **Step 6: 그룹핑 E2E 추가**

`e2e/pages/calendar-sidebar.spec.ts` 에 테스트 추가. 로컬 2 + M365 연동 2(쓰기 1·읽기전용 1) mock 후 섹션 소속·헤더·배지 검증.

```ts
test('로컬과 연동 캘린더가 별도 섹션으로 그룹핑되고 계정 헤더·공급자 pill 이 표시된다', async ({
  authenticatedPage: page,
}) => {
  await stubCalendars(page, [
    calendar({ id: 1, name: '개인', isDefault: true, isReadOnly: false }),
    calendar({ id: 2, name: '프로젝트', isDefault: false, isReadOnly: false }),
    calendar({
      id: 10,
      name: '캘린더',
      isDefault: false,
      isReadOnly: false,
      accountEmail: 'dh.yang@iacloud.kr',
      provider: 'M365_GRAPH',
    }),
    calendar({
      id: 11,
      name: '대한민국 공휴일',
      isDefault: false,
      isReadOnly: true,
      accountEmail: 'dh.yang@iacloud.kr',
      provider: 'M365_GRAPH',
    }),
  ])
  await page.goto('/calendar')

  // 계정 섹션 헤더: 이메일 + 공급자 pill('M365')
  const acctSection = page.getByTestId('calendar-account-section-dh.yang@iacloud.kr')
  await expect(acctSection).toContainText('dh.yang@iacloud.kr')
  await expect(acctSection).toContainText('M365')

  // 연동 캘린더(10,11)는 계정 섹션 안에 소속
  await expect(acctSection.getByTestId('calendar-list-item-10')).toBeVisible()
  await expect(acctSection.getByTestId('calendar-list-item-11')).toBeVisible()
  // 읽기전용(11)은 배지, 쓰기 가능 연동(10)은 편집 버튼 없음(읽기전용 분기 아님 → 편집 버튼 존재)
  await expect(acctSection.getByTestId('calendar-readonly-badge')).toBeVisible()

  // 로컬 캘린더(1,2)는 계정 섹션 밖
  await expect(acctSection.getByTestId('calendar-list-item-1')).toHaveCount(0)
  await expect(page.getByTestId('calendar-list-item-1')).toBeVisible()
})
```

(`stubCalendars` 의 인자 형태·`authenticatedPage` fixture·`page.goto` 경로는 같은 파일의 기존 테스트 시그니처에 맞춘다. 기존 테스트가 인자 없는 `stubCalendars(page)` 만 쓰면, 배열을 받는 오버로드/형태를 `calendar-external-readonly.spec.ts` 쪽 패턴으로 맞춘다.)

- [ ] **Step 7: 타입체크 + E2E 실행 → 통과 확인**

Run:
```bash
cd apps/workplace-web
npx tsc -p tsconfig.e2e.json --noEmit && npx tsc -b --noEmit
pnpm test:e2e -- calendar-sidebar.spec.ts calendar-external-readonly.spec.ts
```
Expected: 타입체크 통과, 두 스펙 PASS.

- [ ] **Step 8: 커밋 (승인 후)**

```bash
git add apps/workplace-web/src/types/calendar.ts \
        apps/workplace-web/src/lib/calendar.ts \
        apps/workplace-web/src/components/calendar/CalendarSidebar.tsx \
        apps/workplace-web/e2e/factories/calendar.factory.ts \
        apps/workplace-web/e2e/pages/calendar-external-readonly.spec.ts \
        apps/workplace-web/e2e/pages/calendar-sidebar.spec.ts
git commit -m "feat(calendar): 사이드바 로컬/연동 캘린더 섹션 구분 (C1)

accountEmail 기준 그룹핑 — '내 캘린더' + 계정별 섹션(이메일 헤더 + M365 pill).
쓰기 가능 연동 캘린더도 섹션 위치로 출처가 드러나도록 핵심 갭 해소."
```

---

## Self-Review

**1. Spec coverage:**
- 백엔드 출처 노출(accountEmail/provider, LEFT JOIN, 마이그 0) → Task 1. ✓
- 통합 테스트(로컬=null, 연동=이메일/provider, RLS 가시성) → Task 1 Step 1. ✓
- 프론트 타입/헬퍼/사이드바 C1 그룹핑 → Task 2 Step 1-3. ✓
- provider 라벨 매핑(M365_GRAPH→M365) → Task 2 Step 2 `providerLabel`. ✓
- 읽기전용 배지/편집버튼 기존 동작 유지 → Task 2 Step 3 `renderItem`. ✓
- E2E(그룹핑·헤더·배지) + 기존 테스트 수정 → Task 2 Step 5-6. ✓
- IMAP 일정 동기화 안 함(forward-looking) → Global Constraints + providerLabel 주석. ✓
- 범위 밖(피커·미니캘린더·레이어 토글 무변경) → 두 Task 모두 해당 블록 미수정. ✓

**2. Placeholder scan:** "TBD"/"적절히"/추상 단계 없음. 모든 코드 스텝에 실제 코드 포함. Step 6 의 `stubCalendars` 시그니처 정합 안내는 플레이스홀더가 아니라 기존 파일 패턴 적응 지침. ✓

**3. Type consistency:** `CalendarResponse` 8-인자 생성자 → toResponse + 컨트롤러 테스트 2곳 모두 일치(Task 1 Step 3·5). `groupCalendarsBySource`/`providerLabel` 시그니처가 Interfaces 블록·Step 2 정의·Step 3 사용처에서 동일. `Calendar.accountEmail/provider` 타입(`string | null`)이 백엔드 null 노출과 정합. ✓

모든 항목 충족 — 갭 없음.
