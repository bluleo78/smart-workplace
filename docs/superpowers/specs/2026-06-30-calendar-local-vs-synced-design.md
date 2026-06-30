# 로컬 캘린더 vs 연동 캘린더 구분 — 설계

> 작성일: 2026-06-30
> 상태: 설계 확정 (구현 계획 대기)

## 배경 / 문제

캘린더 도메인은 두 종류의 컨테이너를 갖는다.

- **로컬 캘린더**: 사용자가 직접 만든 캘린더 (`calendar.external_account_id IS NULL`).
- **연동 캘린더**: M365 등 외부 계정 연결로 동기화된 컨테이너 (`external_account_id` 가 `email_account.id` 참조).

현재 프론트엔드가 가진 유일한 구분 신호는 `CalendarResponse.isReadOnly` 뿐이다. 그런데 `isReadOnly=true` 는 **읽기전용 외부 캘린더**(공휴일·생일 등 `canEdit=false`)에만 설정된다. **쓰기 가능한 연동 M365 캘린더는 `isReadOnly=false`** 이므로, 사이드바에서 로컬 캘린더와 시각적으로 구별되지 않는다.

→ 사용자가 "내가 만든 캘린더"와 "계정 연동으로 들어온 캘린더"를 구분할 수 없는 것이 핵심 갭이다.

## 목표

1. 데이터/API: 연동 캘린더의 출처(계정 이메일 + 공급자)를 프론트에 노출한다.
2. UI: 캘린더 사이드바에서 로컬 캘린더와 연동 캘린더를 **섹션 그룹핑**으로 구분하고, 연동 섹션 헤더에 **계정 이메일 + 공급자**를 표시한다.

## 비목표 (YAGNI)

- 일정 작성 다이얼로그의 캘린더 피커: 이미 읽기전용 캘린더 제외 동작이 있어 그대로 둔다.
- 미니 캘린더·레이어 토글(`내 이슈 마감일`/`초대받은 일정`): 변경 없음.
- 새 마이그레이션: 불필요 (기존 컬럼 활용).

## 데이터 모델 (변경 없음 — 기존 컬럼 활용)

`V106__calendar_external_source.sql` 로 이미 존재:

- `calendar.external_account_id BIGINT` → `email_account(id)` FK. `NULL` = 로컬.
- `calendar.is_read_only BOOLEAN` → 외부 읽기전용 컨테이너 표시.
- `email_account.email_address VARCHAR(320)`, `email_account.provider VARCHAR(32)` (`IMAP` | `M365_GRAPH`, `V90` 추가).

> **중요 — IMAP 은 일정 동기화 안 함.** 외부 캘린더 컨테이너를 만드는 경로는 `GraphCalendarFetcher`(M365 Graph) 하나뿐(`upsertExternalCalendar` 유일 호출처)이다. IMAP `email_account` 는 캘린더 행을 만들지 않으므로 `external_account_id` 가 IMAP 계정을 가리키는 캘린더는 존재할 수 없다. **따라서 연동 캘린더의 `provider` 는 현재 항상 `M365_GRAPH`.** `provider` 필드/`IMAP` 라벨 매핑은 향후 공급자 확장(Google/CalDAV 등) 대비 forward-looking 으로만 유지한다(현재는 죽은 분기).

## 백엔드 설계

### CalendarResponse DTO 확장

```java
/** 캘린더 응답. accountEmail/provider 가 non-null 이면 외부 계정 연동 캘린더. */
public record CalendarResponse(
    long id,
    String name,
    String color,
    boolean isDefault,
    int position,
    boolean isReadOnly,
    String accountEmail,     // NULL=로컬, 값=연동 계정 이메일
    MailProvider provider) {} // NULL=로컬, IMAP | M365_GRAPH
```

`MailProvider` enum(`com.workplace.mail.dto.MailProvider`)을 재사용한다. 도메인 간 직접 import 가 우려되면 calendar 모듈 내 동등 enum 또는 문자열 노출을 검토하되, 기본은 문자열 provider 값을 그대로 매핑한다(직렬화는 enum/문자열 동일 결과). **구현 계획에서 모듈 경계 위반 여부를 한 번 확인**한다.

### Repository 쿼리

`CalendarRepository.listByOwner()` 및 단건 조회(`findByIdForOwner` 등 `CalendarResponse` 를 만드는 모든 경로)에 LEFT JOIN 추가:

```java
dsl.select(CALENDAR.asterisk(),
        EMAIL_ACCOUNT.EMAIL_ADDRESS,
        EMAIL_ACCOUNT.PROVIDER)
   .from(CALENDAR)
   .leftJoin(EMAIL_ACCOUNT)
   .on(CALENDAR.EXTERNAL_ACCOUNT_ID.eq(EMAIL_ACCOUNT.ID))
   .where(CALENDAR.OWNER_ID.eq(ownerId))
   .orderBy(CALENDAR.POSITION.asc(), CALENDAR.ID.asc())
   .fetch(CalendarRepository::toResponse);
```

- 로컬 캘린더는 join 행이 없어 `EMAIL_ACCOUNT.*` 가 NULL → `accountEmail/provider = null`.
- `toResponse()` 가 NULL-safe 하게 매핑.
- `CALENDAR.asterisk()` + `EMAIL_ACCOUNT.PROVIDER` 라벨 충돌 주의: 두 테이블에 동명 컬럼이 없는지 확인(없으면 그대로, 있으면 alias). 구현 시 jOOQ 컴파일/런타임으로 검증.

### 테스트 (통합)

- 로컬 캘린더 → `accountEmail/provider == null`.
- 외부 연동 캘린더(M365_GRAPH) → `accountEmail = 계정 이메일`, `provider = M365_GRAPH`.
- 읽기전용 외부 캘린더 → `isReadOnly=true` 와 `accountEmail/provider` 동시 노출.
- 기존 `CalendarListReadOnlyTest` 회귀 통과.

## 프론트엔드 설계

### 타입

```ts
export interface Calendar {
  id: number
  name: string
  color: string
  isDefault: boolean
  position: number
  isReadOnly: boolean
  // 연동 캘린더 출처. 로컬 캘린더는 null/undefined. (이 작업)
  accountEmail?: string | null
  provider?: string | null // 'IMAP' | 'M365_GRAPH'
}
```

### CalendarSidebar 그룹핑 (확정안: C1)

`calendars` 를 `accountEmail` 기준으로 그룹핑:

- **내 캘린더** 섹션: `accountEmail` 이 null/빈 값인 캘린더. 기존 그룹 헤더 스타일(`text-xs font-semibold uppercase tracking-wide text-muted-foreground`) + 추가(`+`) 버튼 그대로.
- **계정별 섹션**: 동일 `accountEmail` 끼리 묶음. 섹션 헤더 한 줄:
  - 좌측: 계정 이메일 — **대문자 변환 없이**(`text-xs font-semibold text-muted-foreground`), `truncate`.
  - 우측: 공급자 **회색 pill** — `Badge variant="secondary"`, "읽기" 배지와 동일 톤/크기(`h-4 px-1 text-[10px]` 계열). 라벨: `M365_GRAPH`→"M365", `IMAP`→"IMAP".
  - 섹션 사이는 기존 톤의 얇은 divider(`border-t`)로 구분.
- 섹션 순서: 내 캘린더 먼저, 그다음 계정 섹션(이메일 기준 안정 정렬).
- 각 캘린더 아이템 렌더는 기존과 동일: 체크박스 + 색 점 + 이름 + (읽기전용이면 "읽기" 배지, 아니면 hover 편집 버튼).
- 연동 캘린더는 편집 버튼을 숨긴다(현재 `isReadOnly` 분기 그대로). 쓰기 가능 연동 캘린더(`isReadOnly=false`)도 **섹션 위치만으로** 연동임이 드러나는 것이 이 작업의 핵심 해소점.

provider 라벨 매핑은 작은 헬퍼(`lib/calendar` 등)로 두어 사이드바와 향후 재사용에 대비.

### E2E (Playwright, 모킹)

`calendarsApi.list` 모킹 응답에 로컬 2개 + M365_GRAPH 연동 2개(쓰기 1·읽기전용 1, 모두 `provider: 'M365_GRAPH'`)를 포함하고:

1. "내 캘린더" 섹션에 로컬 캘린더만, 계정 섹션에 연동 캘린더만 그룹핑되는지(DOM 순서/소속).
2. 계정 섹션 헤더에 이메일 + provider pill("M365") 텍스트 표시.
3. 읽기전용 캘린더에 "읽기" 배지 표시, 연동 쓰기 캘린더에 편집 버튼 미표시.
4. 로컬 캘린더는 hover 편집 버튼 노출(기존 회귀).

## 영향 범위

| 파일 | 변경 |
|------|------|
| `apps/workplace-api/.../calendar/dto/CalendarResponse.java` | 필드 2개 추가 |
| `apps/workplace-api/.../calendar/repository/CalendarRepository.java` | LEFT JOIN + toResponse NULL-safe 매핑 |
| `apps/workplace-api/.../calendar/...Test` | 출처 노출 통합 테스트 |
| `apps/workplace-web/src/types/calendar.ts` | `accountEmail`/`provider` 추가 |
| `apps/workplace-web/src/components/calendar/CalendarSidebar.tsx` | 섹션 그룹핑 렌더 |
| `apps/workplace-web/src/lib/calendar.ts` (또는 신규 헬퍼) | provider 라벨 매핑 |
| `apps/workplace-web/e2e/...` | 그룹핑 E2E |

## 리스크 / 확인 사항

- jOOQ `CALENDAR.asterisk()` 와 `EMAIL_ACCOUNT.PROVIDER` 라벨 충돌 가능성 → 구현 시 검증, 충돌 시 alias.
- `MailProvider` enum 의 모듈 경계(mail → calendar import) → 구현 계획에서 처리 방식 확정(문자열 매핑 권장).
- 단건 `CalendarResponse` 생성 경로가 여러 곳이면 모두 join 적용해 일관성 유지.
