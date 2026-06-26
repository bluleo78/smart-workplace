package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.repository.EmailAccountRepository;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;

/** 메일 통합 테스트 공용 헬퍼. GreenMail(IMAP 3143/SMTP 3025)을 가리키는 계정을 직접 삽입(연결테스트 우회)한다. */
final class MailTestSupport {

  private MailTestSupport() {}

  /**
   * box@test.local 을 가리키는 계정을 직접 삽입하고 생성된 accountId 를 반환한다. aiEnabled 로 AI 분류 게이트를 제어한다(분류 테스트에서
   * true).
   */
  /**
   * M365_GRAPH 계정을 test DB 에 직접 삽입하고 accountId 를 반환한다. Task 4 이후 공통으로 재사용한다.
   *
   * <p>V90 에서 IMAP 컬럼이 nullable 로 완화됐으므로 OAuth 전용 계정은 IMAP 값 없이 삽입한다.
   */
  static long seedGraphAccount(DSLContext dsl, EncryptionService enc, long userId) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "graph-" + userId + "@example.com")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "Graph 테스트 계정")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, enc.encrypt("RT"))
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, enc.encrypt("FAKE_TOKEN"))
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * M365_GRAPH 계정을 test DB 에 직접 삽입하고 accountId 를 반환한다. EncryptionService 없이 raw 토큰 문자열을 저장한다 —
   * GraphTokenService 를 모킹하는 테스트에서 실제 토큰 값이 중요하지 않을 때 사용한다.
   */
  static long seedGraphAccount(DSLContext dsl, long userId) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "graph-" + userId + "@example.com")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "Graph 테스트 계정")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, "DUMMY_RT") // GraphTokenService 모킹으로 실제 미사용
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, "DUMMY_AT")
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * Graph 계정의 INBOX 폴더를 생성하고 seen=false, providerMessageId 지정된 미읽음 메시지를 삽입해 messageId 를 반환한다. 읽음
   * 역동기화(Task 7) 테스트용 시드 헬퍼.
   */
  static long seedUnseenGraphMessage(DSLContext dsl, long accountId, String providerMessageId) {
    long folderId =
        dsl.insertInto(EMAIL_FOLDER)
            .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
            .set(EMAIL_FOLDER.NAME, "INBOX")
            .onConflictDoNothing()
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, providerMessageId)
        .set(EMAIL_MESSAGE.THREAD_ID, "thread-" + providerMessageId)
        .set(EMAIL_MESSAGE.SEEN, false)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  static long insertAccount(
      EmailAccountRepository repo, EncryptionService enc, long userId, boolean aiEnabled) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            "box@test.local",
            "테스트박스",
            "127.0.0.1",
            3143,
            MailSecurity.NONE,
            "box@test.local",
            "127.0.0.1",
            3025,
            MailSecurity.NONE,
            "box@test.local",
            "pw",
            aiEnabled);
    return repo.insert(userId, req, enc.encrypt("pw"));
  }
}
