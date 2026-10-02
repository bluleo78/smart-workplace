# Coding Convention

> 이 코드는 사람과 AI 가 같이 읽고 같이 고친다. 주석은 의도를 전달하는 1급 도구.

## 원칙

1. **한국어 주석을 쓴다.** 한국어 본문 + 영문 식별자.
2. **무엇을 + 왜** 를 적는다. 코드가 이미 말하는 "어떻게"는 반복하지 않는다.
3. **누가 읽어도 30초 안에 의도가 전달**되어야 한다 — 새로 합류한 사람도, 다음 세션의 AI 도.

## 무엇에 주석을 다는가

| 대상 | 필수 | 비고 |
|---|---|---|
| 클래스/모듈 | ✅ | 역할·책임 1~2줄 |
| public 메서드/함수 | ✅ | 무엇을 하는지 + 왜 필요한지 |
| 복잡한 분기·알고리즘 | ✅ | 의도와 트레이드오프 |
| 매직 넘버/상수 | ✅ | 출처·이유 |
| 외부 의존(API, DB) 가정 | ✅ | 깨지면 무엇이 망가지는지 |
| 명백한 한 줄 (getter/setter, 단순 변환) | ❌ | 코드가 이미 말함 |

## 형식

### Java (Javadoc)

```java
/**
 * 사용자 로그인 시도를 잠금 상태와 함께 검증한다.
 *
 * <p>잠금 정책: 5회 실패 → 30분 잠금. 분산 환경에서 일관성을 위해
 * {@code login_attempts} 테이블에 영속화한다(#144).
 */
public TokenResponse login(LoginRequest req) {
  ...
}
```

- 클래스/메서드는 Javadoc 블록
- 한 줄 보강은 `// ...`
- "무엇을" 첫 줄, 빈 줄 후 "왜/제약"

### TypeScript (JSDoc / 인라인)

```ts
/**
 * 이슈 스레드에 메시지를 전송한다.
 *
 * - AI 에이전트도 동일 함수로 메시지를 남긴다 (author 가 Agent 일 뿐).
 * - 멘션은 메시지 저장 후 비동기로 알림 발송.
 */
export async function postMessage(...) { }
```

## 안티패턴

```java
// ❌ 코드가 이미 말함
// 사용자 id를 반환한다
public Long getId() { return id; }

// ❌ "어떻게"의 반복
// userRepository를 호출해서 사용자를 가져온다
return userRepository.findById(id);

// ❌ 의미 없는 주석
// TODO: 나중에 (왜? 무엇을? 누가?)
```

```java
// ✅ "왜"가 비자명할 때
// 첫 사용자는 자동으로 ADMIN — 부트스트랩 편의(#7).
if (userRepository.count() == 0) { assignAdmin(user); }

// ✅ 외부 의존의 가정
// PG사 응답 5초 초과 시 재시도. 인앱 결제 SDK 가 4초 타임아웃이라 그보다 짧게.
client.setTimeout(Duration.ofSeconds(3));

// ✅ 매직 넘버
// 30분 — 사용자 세션 평균 길이 분석 결과(#42).
private static final long ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000L;
```

## 날짜/시간 표시 포맷 (workplace-web)

### 원칙

1. **화면 코드에서 `toLocaleDateString` / `toLocaleString` / `toLocaleTimeString` 직접 호출 금지.** ESLint `no-restricted-syntax` 로 강제한다(#632). 유일한 예외는 공용 포매터 구현부 `apps/workplace-web/src/lib/formatters.ts`.
2. 날짜/시간 표시는 **공용 포매터를 사용**한다. 필요한 포맷이 없으면 화면에 로컬 구현을 두지 말고 `formatters.ts` 에 포매터를 **추가**한다(한국어 JSDoc 으로 용도·출력 예시 명시).
3. 서버 문자열 파싱은 항상 `parseUtcDate` 를 거친다. `new Date(str)` 직접 파싱은 서버 `LocalDateTime`(타임존 없음)을 브라우저 로컬로 오해석한다.
4. 포매터를 통합/변경할 때는 **기존 호출부의 화면 표기가 바뀌지 않는지** 확인한다. 표기 변경은 의도적으로, 이슈에 명시하고 한다.

### 포매터 용도 표

| 용도 | 포매터 | 출력 예 | 비고 |
|---|---|---|---|
| 목록/테이블 컬럼 — 날짜만 | `formatDateOnly` | `2026-07-15` | zero-pad, 로케일 비의존. 기본 선택지 |
| 좁은 칩/배지 — 월·일 | `formatDateMonthDay` | `7월 15일` | 무효 입력 시 `''` (세그먼트 생략용) |
| 상세/헤더 — 한국어 표기 | `formatDateKorean` | `2026년 7월 15일` | 입력은 **날짜 전용** `YYYY-MM-DD` (타임존 왜곡 방지로 UTC 파싱 안 함) |
| 로그/타임스탬프 — 초 단위 | `formatDateTime` | `2026-07-15 14:59:59` | 감사 로그 등 정밀도 필요한 곳 |
| 툴팁/활동 — 분 단위 | `formatDateTimeMinute` | `2026-07-15 14:59` | hover 절대시간, 댓글/타임라인 |
| 상대시간 | `formatRelativeTime` | `5분 전`, `3개월 전` | 피드·알림·목록 보조 표기 |
| 시각만 — 채팅 버블 | `formatClockTime` | `오후 3:24` | `Asia/Seoul` 고정 |
| 시각만 — 컴팩트 거터 | `formatClockTimeCompact` | `15:24` | 24시간제, 좁은 폭 |
| 시각만 — 캘린더 로컬 | `formatLocalClockTime24` | `14:30` | 24시간제, **브라우저 로컬 타임존**(캘린더 날짜 계산과 기준 일치) |
| 시각만 — 오전/오후 zero-pad | `formatClockTimePadded` | `오후 02:30` | 캘린더 그리드·메일 목록(오늘) |
| 좁은 목록 — 월·일 zero-pad | `formatDateMonthDayPadded` | `07. 15.` | 메일 목록(오늘 이전) |
| 설정/관리 — 로케일 일시 | `formatDateTimeLocale` | `2026. 7. 15. 오후 2:30:00` | 토큰·에이전트·버전 이력 기존 표기 유지 |
| 숫자 천단위 | `formatNumber` | `9,007,199,254,740,991` | 날짜 아님(구문 기반 린트 규칙 대응) |
| 로케일 날짜 | `formatDateShort` | `2026. 7. 15.` | 기존 표기 유지용(토큰·드라이브 휴지통). 신규 목록은 `formatDateOnly` 우선 |

모든 포매터는 `null`/`undefined`/무효 입력 시 `'-'` 를 반환한다(`formatDateMonthDay` 만 `''`).

### 기존 직접 호출 잔존분

린트 활성화 시점(#632)에 임시 허용했던 직접 호출은 #828 에서 모두 공용 포매터로 이전했다. **새 `eslint-disable` 예외를 추가하지 않는다** — 필요한 포맷은 `formatters.ts` 에 추가한다.

### 회귀 레퍼런스 — #617 오프셋 파싱

`parseUtcDate` 는 "타임존 정보가 이미 있으면 그대로, 없으면 `Z` 를 붙여 UTC 로 간주" 한다. 판별 정규식이 콜론 없는 오프셋(`+0900`)만 인식하던 시절, 백엔드가 `OffsetDateTime` 으로 직렬화한 `2026-07-15T23:59:59+09:00` 에 `Z` 를 중복 append → `Invalid Date` → 화면에 `-` 가 찍혔다(ShareLinkModal 만료일, AgentManagementPage).

- 판별은 `Z` / `±HH:MM` / `±HHMM` 을 모두 인식해야 한다 — `apps/workplace-web/src/lib/formatters.parseUtcDate.test.ts` 가 고정한다.
- 교훈: 화면마다 로컬 파싱/포매팅을 두면 한 곳의 수정이 다른 곳에 전파되지 않는다. 그래서 위 원칙 1·3 을 린트로 강제한다.

## MCP 도구 (AI · 원격 MCP)

workplace-mcp 와 workplace-ai-agent 가 함께 쓰는 MCP 도구는 [`packages/mcp-tools-shared`](../packages/mcp-tools-shared/README.md) 에 한 번만 정의한다. 앱에서 같은 이름의 도구를 다시 정의하지 않으며, 두 앱의 패리티 테스트가 이를 강제한다. 새 도구의 파라미터 이름은 README 의 **파라미터 명명 규칙**을 따른다(도메인 접두 id, 사람=username, 조회·쓰기 동일 표현).

## DB 마이그레이션 — 롤링 배포 호환(expand/contract)

운영 api 는 k8s 롤링 배포(maxSurge 1 / maxUnavailable 0)다. 새 파드가 기동하면서 Flyway 로 스키마를 **먼저** 바꾸고, 그동안 구 파드는 수십 초간 계속 요청을 받는다. 이전 이미지로 롤백해도 스키마는 되돌아가지 않는다. 그래서 **모든 마이그레이션은 "새 스키마 + 구 코드" 조합에서도 동작해야 한다.** jOOQ 는 생성 시점의 컬럼을 select/insert 에 명시하므로, 구 코드가 아는 컬럼이 사라지거나 구 코드의 insert 가 막히면 배포 구간 동안 그대로 장애가 된다.

### 원칙

1. **이번 배포는 추가(expand)만** 한다 — 테이블·nullable 컬럼·기본값 있는 컬럼·인덱스 추가, 허용값 확대.
2. **삭제·이름 변경·제약 강화(contract)는 다음 배포로** 미룬다 — 구 코드가 더는 그 컬럼/값을 쓰지 않는 버전이 운영에 완전히 반영된 뒤에.
3. 한 PR 안에서 "코드가 새 컬럼으로 전환" 과 "구 컬럼 삭제" 를 같이 하지 않는다.

### 위험 변경 체크리스트와 안전한 2단계 절차

| 변경 | 구 코드에서 깨지는 이유 | 1차 배포(expand) | 2차 배포(contract) |
|---|---|---|---|
| 컬럼 삭제 | 구 코드 select/insert 가 없는 컬럼 참조 | 코드에서 컬럼 사용 제거(+ jOOQ 재생성), 스키마는 그대로 | `DROP COLUMN` |
| 컬럼 rename | 구 이름 참조 실패 | 새 컬럼 추가 + 데이터 복사, 코드는 양쪽에 쓰고 새 컬럼을 읽음 | 구 컬럼 삭제 |
| NOT NULL 추가(기본값 없이) | 구 코드 insert 가 값을 안 넣어 실패 | nullable 로 추가(또는 `DEFAULT` 지정), 코드가 항상 값을 채움 + 백필 | `SET NOT NULL` |
| CHECK/UNIQUE/FK 추가 | 구 코드가 위반 데이터를 계속 씀 | 코드가 규칙을 지키게 배포 + 기존 데이터 정리 | 제약 추가(FK·CHECK 는 `NOT VALID` → `VALIDATE` 검토) |
| 테이블 rename/삭제 | 구 코드 쿼리 실패 | 코드에서 사용 제거(rename 은 새 테이블 + 양쪽 쓰기) | rename/`DROP TABLE` |
| enum·CHECK 허용값 제거 | 구 코드가 제거된 값을 씀/읽음 | 코드에서 값 사용 중단 + 기존 행 이관 | 허용값에서 제거 |
| 컬럼 타입 축소(`text`→`varchar(n)`, `bigint`→`int` 등) | 구 코드 값이 범위 초과 | 코드가 새 범위만 쓰게 배포 + 데이터 확인 | `ALTER COLUMN TYPE` |
| 대용량 테이블 잠금 DDL | `ACCESS EXCLUSIVE` 잠금 동안 구·신 파드 요청 모두 대기 | 잠금이 짧은 형태로 쪼갬(아래) | — |

예시 — NOT NULL 컬럼 추가:

```sql
-- V{n}__issue_add_source.sql (1차): DEFAULT 와 함께 추가 → 구 코드 insert 가 막히지 않음.
-- PG11+ 는 상수 DEFAULT 추가 시 기존 행에도 값이 보이고 테이블을 재작성하지 않는다(별도 백필 불필요).
-- DEFAULT 를 둘 수 없으면 nullable 로 추가하고 기존 행은 범위를 나눠 백필한다.
ALTER TABLE issue ADD COLUMN source varchar(20) DEFAULT 'WEB';

-- V{n+k}__issue_source_not_null.sql (2차, 구 코드가 운영에서 사라진 뒤)
ALTER TABLE issue ALTER COLUMN source SET NOT NULL;
```

예시 — 컬럼 rename(`title` → `subject`):

```sql
-- 1차: 새 컬럼 추가 + 복사. 코드는 title·subject 양쪽에 쓰고 subject 를 읽는다
ALTER TABLE note ADD COLUMN subject text;
UPDATE note SET subject = title WHERE subject IS NULL;
-- 2차: 코드가 title 을 완전히 안 쓰게 된 다음 배포에서
ALTER TABLE note DROP COLUMN title;
```

예시 — 제약 추가(검증 잠금 최소화):

```sql
-- V{n}: 새 행만 검사, 짧은 잠금
ALTER TABLE issue ADD CONSTRAINT issue_project_fk
  FOREIGN KEY (project_id) REFERENCES project(id) NOT VALID;
-- V{n+1}(별도 파일): 기존 행 검사, 쓰기 차단 안 함. 같은 파일에 두면 한 트랜잭션이라 앞 문장의 잠금이 검사 끝까지 유지된다
ALTER TABLE issue VALIDATE CONSTRAINT issue_project_fk;
```

### 잠금 DDL 주의

- 대용량 테이블의 인덱스는 `CREATE INDEX CONCURRENTLY` 를 검토한다. 단 Flyway 는 마이그레이션을 트랜잭션으로 감싸는데 `CONCURRENTLY` 는 트랜잭션 안에서 실행할 수 없다 — **그 문장만 단독 마이그레이션 파일로** 분리하고, 로컬·테스트에서 Flyway 가 비트랜잭션으로 실행하는지(advisory lock 대기·혼합 실행 오류 없음) 확인한 뒤 쓴다. 작은 테이블은 일반 `CREATE INDEX` 로 충분하다.
- `ALTER COLUMN TYPE`(테이블 재작성), 기본값이 volatile 함수인 `ADD COLUMN`, 대량 `UPDATE` 는 테이블 잠금·재작성을 일으킨다. 백필은 범위를 나눠 별도 마이그레이션 또는 애플리케이션 배치로 한다.

### 구 코드가 새 스키마에서 동작하는지 확인

- **구 코드 기준 insert** — 구 버전 jOOQ insert 가 넣는 컬럼 집합만으로 새 스키마에 행을 넣을 수 있는가(새 NOT NULL·CHECK·FK 에 막히지 않는가).
- **구 코드 기준 select** — 구 코드가 참조하는 컬럼·테이블이 그대로 존재하는가(`DROP`/`RENAME` 이 diff 에 있으면 1차 배포에서 이미 사용을 제거했는지 git log 로 확인).
- **구 코드가 쓰는 값** — 구 코드가 쓰는 enum/상태 문자열이 새 CHECK 허용값에 남아 있는가.
- 의심스러우면 이전 커밋을 체크아웃해 새 마이그레이션까지 적용된 DB 로 해당 도메인 통합 테스트를 돌려 본다.
- 신규 테이블의 `app_tenant` 권한은 V44 default privileges 로 자동 부여되지만, RLS 정책을 기존 테이블에 새로 걸거나 조이는 것도 "제약 강화" 로 보고 같은 2단계를 따른다.

### 롤백 고려

- 롤백은 **이미지만 되돌리고 스키마는 그대로** 둔다(Flyway undo 를 쓰지 않는다). 그래서 위 규칙을 지키면 롤백도 자동으로 안전하다.
- contract 마이그레이션(삭제·제약 강화)은 되돌릴 수 없는 변경이다. 이를 포함한 배포는 그 직전 버전으로만 롤백할 수 있음을 PR 본문에 적는다.
- 데이터를 지우는 마이그레이션(`DROP`, 값 이관 후 원본 삭제)은 contract 단계에서도 필요하면 백업 테이블·덤프를 먼저 남긴다.

## 자동화

- Java: Spotless(Google Java Format)가 포맷만 강제 (주석 내용은 사람이 책임)
- TypeScript: ESLint 가 포맷·룰 강제 (`apps/workplace-web/eslint.config.js` — import 정렬, 날짜/시간 `toLocale*` 직접 호출 금지 등). prettier 는 사용하지 않는다
- 주석 누락은 리뷰에서 잡는다 — CI 자동화 X
