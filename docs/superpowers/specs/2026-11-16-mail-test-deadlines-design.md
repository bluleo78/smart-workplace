# 메일 테스트의 실시간 데드라인 제거 (WP-1641)

## 왜

push 게이트(`pnpm test:full`)의 api 전체 단계에서 `ImapReadSyncerTest.setsAndClearsSeen_inOneConnection_acrossPushes`(IMAP `ConnectionException`)와 `EmailAccountServiceTest.test_returnsResultWithoutPersisting`(연결 시험 `success=false`)가 가끔 깨진다. 두 클래스만 다시 돌리면 통과한다.

원인: 테스트 JVM 이 잠시 멈추면(포드 전체의 메모리·CPU 압박 등 — 포드는 CPU 8·메모리 16GiB, 게이트는 포크 3개 × 힙 1.5g + DB 컨테이너 3개) 실시간 데드라인이 지난다.
- GreenMail 서버는 접속마다 소켓 읽기 제한 30초(`AbstractServer.CLIENT_SOCKET_SO_TIMEOUT`)를 건다 — 그동안 다음 명령이 오지 않으면 연결을 끊는다 → 클라이언트에 `* BYE … Connection dropped by server?`(`iap.ConnectionException`).
- 운영 코드의 메일 접속은 연결·읽기 제한 10초(`MailConnectionTester`·`ImapConnector`·`MailSentAppender`·`SmtpMailTransport`) → 연결 시험이 실패를 돌려준다.
- 검증: 테스트 실행기 JVM 을 35초씩 얼리자(SIGSTOP/SIGCONT) 두 클래스가 게이트와 같은 모양으로 깨졌다(`Connection dropped by server?`, `메일 서버 연결 테스트에 실패했습니다`). 부하 없이·CPU 부하만으로는(api 전체 3포크 3회) 재현되지 않았다.

## 목표 / 하지 않을 것

- 목표: 메일 테스트가 JVM·포드 정지에 영향받지 않게 한다 — 시간 제한을 정지보다 넉넉하게 둔다.
- 하지 않음: 재시도로 덮기(결정적이지 않다), 포크·힙 줄이기(정지 자체는 남는다), 운영 기본 시간 제한 변경(운영은 10초 그대로).

## 접근

| 안 | 내용 | 판단 |
|---|---|---|
| A. 테스트 환경에서 데드라인 제거 | GreenMail 서버 읽기 제한 끄기 + 기동 대기 늘리기, 운영 메일 시간 제한을 설정값으로 빼고 test 프로필에서 넉넉하게 | **선택** — 원인(실시간 데드라인)을 없앤다 |
| B. 테스트에서 재시도 | 연결 실패 시 다시 시도 | 버림 — 증상을 덮고 결정적이지 않다 |
| C. 부하 줄이기 | 포크 수·힙 조정 | 버림 — 포드 전체 정지에는 무력하다 |

## 설계

1. **테스트 GreenMail** — `MailTestGreenMail extends GreenMailExtension`(test, `com.workplace.mail`): `MailTestPorts.SMTP_IMAP` 로 만들고, `beforeEach`·`beforeAll` 에서 부모가 서버를 띄운 뒤 SMTP·IMAP 서버의 `setClientSocketTimeout(0)`(제한 없음)을 건다(GreenMail 은 시작마다 서버를 새로 만들므로 매번). 메일 테스트의 `new GreenMailExtension(MailTestPorts.SMTP_IMAP)` 을 모두 이것으로 바꾼다.
2. **기동 대기** — `MailTestPorts.SMTP_IMAP` 의 서버 기동 대기(기본 2초)를 60초로 — 바로 뜨면 그대로 바로 돌아오므로 느려지지 않는다.
3. **운영 메일 시간 제한 설정화** — `workplace.mail.io-timeout-ms`(기본 10000 — 운영 동작 그대로)를 네 클래스가 읽는다. `SmtpMailTransport` 의 첨부 I/O 제한(120초)은 이 값보다 작아지지 않게 둘 중 큰 값. `application-test.yml` 은 120000(2분) — 무한(0)은 진짜 멈춘 서버에서 테스트가 끝나지 않으므로 쓰지 않는다. `MailConnectionTester` 를 직접 `new` 하는 단위 테스트를 위해 기존 생성자(기본 10초)는 남긴다.
4. **검증** — 같은 정지 실험(35초 SIGSTOP 반복)에서 두 클래스가 통과(느려질 뿐)하고, 메일 패키지 전체가 통과한다.

## 빌더에게 남기는 것

- 남은 위험(이 이슈 밖): 다른 저장소 사본에서 같은 api 테스트가 동시에 돌면(게이트 락은 사본마다 하나) 새 데몬의 워커 번호가 같아 같은 GreenMail 포트를 써 `Could not start mail server` 로 깨진다 — 실험으로 확인. 증상이 달라 별도 이슈로 둔다.
