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
| (deprecated) | `formatDateShort` | `2026. 7. 15.` | 로케일 의존. 신규 사용 금지 → `formatDateOnly`. 기존 1곳 표기 유지용(#828) |

모든 포매터는 `null`/`undefined`/무효 입력 시 `'-'` 를 반환한다(`formatDateMonthDay` 만 `''`).

### 기존 직접 호출 잔존분

린트 활성화 시점에 남아 있던 직접 호출은 표기 변경을 피하기 위해 교체하지 않고 `eslint-disable-next-line no-restricted-syntax -- TODO(#828)` 로 임시 허용해 두었다. 마이그레이션은 #828 에서 처리하며, **새 예외를 추가하지 않는다**.

### 회귀 레퍼런스 — #617 오프셋 파싱

`parseUtcDate` 는 "타임존 정보가 이미 있으면 그대로, 없으면 `Z` 를 붙여 UTC 로 간주" 한다. 판별 정규식이 콜론 없는 오프셋(`+0900`)만 인식하던 시절, 백엔드가 `OffsetDateTime` 으로 직렬화한 `2026-07-15T23:59:59+09:00` 에 `Z` 를 중복 append → `Invalid Date` → 화면에 `-` 가 찍혔다(ShareLinkModal 만료일, AgentManagementPage).

- 판별은 `Z` / `±HH:MM` / `±HHMM` 을 모두 인식해야 한다 — `apps/workplace-web/src/lib/formatters.parseUtcDate.test.ts` 가 고정한다.
- 교훈: 화면마다 로컬 파싱/포매팅을 두면 한 곳의 수정이 다른 곳에 전파되지 않는다. 그래서 위 원칙 1·3 을 린트로 강제한다.

## MCP 도구 (AI · 원격 MCP)

workplace-mcp 와 workplace-ai-agent 가 함께 쓰는 MCP 도구는 [`packages/mcp-tools-shared`](../packages/mcp-tools-shared/README.md) 에 한 번만 정의한다. 앱에서 같은 이름의 도구를 다시 정의하지 않으며, 두 앱의 패리티 테스트가 이를 강제한다. 새 도구의 파라미터 이름은 README 의 **파라미터 명명 규칙**을 따른다(도메인 접두 id, 사람=username, 조회·쓰기 동일 표현).

## 자동화

- Java: Spotless(Google Java Format)가 포맷만 강제 (주석 내용은 사람이 책임)
- TypeScript: ESLint 가 포맷·룰 강제 (`apps/workplace-web/eslint.config.js` — import 정렬, 날짜/시간 `toLocale*` 직접 호출 금지 등). prettier 는 사용하지 않는다
- 주석 누락은 리뷰에서 잡는다 — CI 자동화 X
