# 메일 테스트 실시간 데드라인 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메일 통합 테스트가 JVM·포드 정지(수십 초)에 깨지지 않도록, 테스트에서 GreenMail 서버의 읽기 제한과 운영 메일 접속 시간 제한(10초)을 정지보다 넉넉하게 둔다.

**Architecture:** 테스트 쪽은 `GreenMailExtension` 을 상속한 `MailTestGreenMail` 이 서버를 띄울 때마다 클라이언트 소켓 제한을 끈다. 운영 쪽은 메일 I/O 시간 제한 네 곳을 설정값 `workplace.mail.io-timeout-ms`(기본 10000)로 빼고 test 프로필에서 120000 으로 둔다.

**Tech Stack:** Java 25, Spring Boot, Lombok(`@Value` 는 lombok.config 의 copyableAnnotations 로 생성자 인자에 복사됨), GreenMail 2.1.0(greenmail-junit5), JUnit 5, AssertJ.

**Spec:** `docs/superpowers/specs/2026-11-16-mail-test-deadlines-design.md`

## Global Constraints

- 운영 기본값은 바뀌지 않는다: 메일 I/O 제한 10000ms, `SmtpMailTransport` 첨부 I/O 제한 120000ms.
- 설정 키: `workplace.mail.io-timeout-ms`, 기본 10000, `application-test.yml` 값 120000(무한 0 은 쓰지 않는다).
- GreenMail 서버 기동 대기: 60000ms. GreenMail 서버 클라이언트 소켓 제한: 0(제한 없음).
- 한국어 주석 필수(클래스·메서드·주요 로직에 무엇을·왜). 커밋 전 `./gradlew spotlessApply`.
- 셸 명령은 단순하게: 한 줄 셸 함수 정의, `${…:-{…}}` 중괄호 확장, `;`·`&&` 로 길게 이은 한 줄을 쓰지 않는다 — 복잡하면 스크립트 파일로. 태스크 끝에 커밋 하나(메시지 `test: … (WP-1641)` 꼴, 커밋 훅은 건너뛰지 않는다 — `--no-verify` 금지). push 하지 않는다.
- 모든 명령은 `apps/workplace-api`(워크트리 `/work/agents/developer7@iacloud.kr/repos/WP/.claude/worktrees/WP-1641/apps/workplace-api`) 에서.

## Review Focus

1. `withConfiguration(...)` 을 이어 부른 뒤에도 인스턴스가 `MailTestGreenMail` 이어야 한다(부모가 `this` 를 돌려주는지) — Task 1 테스트가 `withConfiguration` 을 거친 인스턴스로 확인한다.
2. 메서드마다 재기동(기본 per-method)할 때 두 번째 테스트의 새 서버에도 제한이 꺼져 있어야 한다 — Task 1 테스트가 테스트 두 개로 확인한다.
3. `MailTestPorts.SMTP_IMAP` 의 기동 대기 변경이 `sendText`·`sendWithHeader` 가 쓰는 SMTP 설정과 어긋나지 않아야 한다(같은 포트) — Task 1 테스트가 보낸 메일 1통 수신으로 확인.
4. 첨부가 있는 SMTP 발송의 I/O 제한은 설정값이 120000 보다 작아도 120000 아래로 내려가지 않아야 한다 — Task 2 단위 테스트.
5. `new` 로 직접 만드는 단위 테스트(`MailConnectionTesterTest`·`MailSentAppenderTest`)가 운영 기본 10000 을 쓴다 — Task 2 에서 그 호출부에 상수를 넘긴다.

---

### Task 1: 테스트 GreenMail — 서버 읽기 제한 끄기·기동 대기 늘리기

**Files:**
- Create: `src/test/java/com/workplace/mail/MailTestGreenMail.java`
- Modify: `src/test/java/com/workplace/mail/MailTestPorts.java` (`SMTP_SETUP`·`SMTP_IMAP` 에 기동 대기 60000)
- Modify: `new GreenMailExtension(MailTestPorts.SMTP_IMAP)` 을 쓰는 모든 테스트(`grep -rln "new GreenMailExtension(MailTestPorts.SMTP_IMAP)" src/test/java`) → `new MailTestGreenMail()` (필요 없어진 import 정리)
- Test: `src/test/java/com/workplace/mail/MailTestGreenMailTest.java`

**Interfaces:**
- Produces: `public class MailTestGreenMail extends GreenMailExtension` — `public MailTestGreenMail()`(= `super(MailTestPorts.SMTP_IMAP)`), `beforeEach`·`beforeAll` 재정의(부모 호출 뒤 실행 중이면 `getSmtp()`·`getImap()` 에 `setClientSocketTimeout(0)`). `public static final int STARTUP_TIMEOUT_MS = 60_000` 은 `MailTestPorts` 에 둔다.

- [ ] **Step 1: 실패하는 테스트 작성** — `MailTestGreenMailTest`(Spring 없음, 순수 JUnit). `@RegisterExtension static GreenMailExtension greenMail = new MailTestGreenMail().withConfiguration(GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));`
  - `serversHaveNoClientSocketTimeout_first()` / `..._second()`(두 테스트 — 재기동 뒤에도): `assertThat(greenMail).isInstanceOf(MailTestGreenMail.class)`, 리플렉션으로 `AbstractServer` 의 private `clientSocketTimeout` 을 읽어 `getSmtp()`·`getImap()` 모두 `0`.
  - `startupTimeoutIs60s()`: `assertThat(greenMail.getImap().getServerSetup().getServerStartupTimeout()).isEqualTo(60_000L)`, SMTP 도 같다.
  - `deliversThroughSharedSmtpSetup()`: `MailTestPorts.sendText("box@test.local", "a@example.com", "s", "b")` 뒤 `greenMail.waitForIncomingEmail(1)` 이 true.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "com.workplace.mail.MailTestGreenMailTest" -PnoCoverage -x jacocoTestReport` → 컴파일 실패(`MailTestGreenMail` 없음).
- [ ] **Step 3: 구현** — `MailTestGreenMail` 작성, `MailTestPorts` 의 두 `ServerSetup` 에 `setServerStartupTimeout(STARTUP_TIMEOUT_MS)`(ServerSetup.port(..) 가 돌려준 복사본에 건다). 클래스 주석에 왜(포드·JVM 정지 시 GreenMail 기본 30초 읽기 제한이 연결을 끊는다 — WP-1641)를 적는다.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS.
- [ ] **Step 5: 모든 메일 테스트를 바꾼다** — 위 grep 결과 파일의 생성식을 `new MailTestGreenMail()` 로. `grep -rn "new GreenMailExtension(" src/test/java` 결과가 0 줄.
- [ ] **Step 6: 메일 패키지 확인** — `./gradlew test --tests "com.workplace.mail.*" -PnoCoverage -x jacocoTestReport` → BUILD SUCCESSFUL. `./gradlew spotlessApply`.

### Task 2: 운영 메일 I/O 시간 제한 설정화

**Files:**
- Modify: `src/main/java/com/workplace/mail/service/ImapConnector.java`, `MailConnectionTester.java`, `MailSentAppender.java`, `SmtpMailTransport.java`
- Modify: `src/main/resources/application-test.yml` (`workplace.mail.io-timeout-ms: 120000`, 기존 `workplace.mail` 블록 안, 주석으로 이유)
- Modify: 직접 `new` 하는 테스트 — `src/test/java/com/workplace/mail/MailConnectionTesterTest.java:29`, `src/test/java/com/workplace/mail/MailSentAppenderTest.java:58`
- Test: `src/test/java/com/workplace/mail/MailIoTimeoutConfigTest.java`

**Interfaces:**
- Produces: `ImapConnector.DEFAULT_TIMEOUT_MS = 10_000`(public static final — 기존 `TIMEOUT_MS` 이름을 이것으로 바꾸고 다른 참조가 있으면 함께), 설정 키 문자열 `"${workplace.mail.io-timeout-ms:10000}"`. 네 클래스 모두 `@Value(...)` 를 단 `private final int ioTimeoutMs` 필드(롬복 생성자 인자로 복사) + 패키지 공개 접근자 `int ioTimeoutMs()`. `SmtpMailTransport` 는 `int ioTimeoutMs(boolean hasAttachments)` = 첨부면 `Math.max(ATTACHMENT_IO_TIMEOUT_MS, ioTimeoutMs)`, 아니면 `ioTimeoutMs` — 연결 제한(`connectiontimeout`)은 `ioTimeoutMs`. `MailConnectionTester` 는 `@RequiredArgsConstructor` 를 그대로 쓰되 인자가 `(MailHostGuard, int)` 가 된다.

- [ ] **Step 1: 실패하는 테스트 작성** — `MailIoTimeoutConfigTest extends IntegrationTestBase`(com.workplace.mail 이 아니라 접근자가 패키지 공개이므로 `com.workplace.mail.service` 패키지에 둔다 — 파일 경로도 `src/test/java/com/workplace/mail/service/MailIoTimeoutConfigTest.java`):
  - `testProfileUsesLongIoTimeout()`: 주입받은 `ImapConnector`·`MailConnectionTester`·`MailSentAppender` 의 `ioTimeoutMs()` 가 `120_000`, `SmtpMailTransport.ioTimeoutMs(false)` 가 `120_000`.
  - 단위(같은 클래스 안 일반 메서드도 됨) `attachmentTimeoutNeverBelow120s()`: `ioTimeoutMs` 를 10000 으로 만든 `SmtpMailTransport`(생성자에 다른 인자는 null 가능하면 null, 아니면 mock) 의 `ioTimeoutMs(true)` 가 `120_000`, `ioTimeoutMs(false)` 가 `10_000`.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "com.workplace.mail.service.MailIoTimeoutConfigTest" -PnoCoverage -x jacocoTestReport` → 컴파일 실패.
- [ ] **Step 3: 구현** — 네 클래스의 `TIMEOUT_MS` 사용을 `ioTimeoutMs` 로, yml 에 값. 직접 `new` 하는 두 테스트는 `ImapConnector.DEFAULT_TIMEOUT_MS` 를 넘긴다. 각 필드 주석에 기본 10초(운영)·test 프로필 2분(포드 정지에도 메일 테스트가 깨지지 않게 — WP-1641)을 적는다.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. 이어서 `./gradlew test --tests "com.workplace.mail.*" -PnoCoverage -x jacocoTestReport` → BUILD SUCCESSFUL. `./gradlew spotlessApply`.
