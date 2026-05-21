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

## 자동화

- Java: Spotless(Google Java Format)가 포맷만 강제 (주석 내용은 사람이 책임)
- TypeScript: ESLint 가 포맷·룰 강제 (예정)
- 주석 누락은 리뷰에서 잡는다 — CI 자동화 X
