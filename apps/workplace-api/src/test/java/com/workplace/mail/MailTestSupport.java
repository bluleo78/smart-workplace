package com.workplace.mail;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.repository.EmailAccountRepository;

/** 메일 통합 테스트 공용 헬퍼. GreenMail(IMAP 3143/SMTP 3025)을 가리키는 계정을 직접 삽입(연결테스트 우회)한다. */
final class MailTestSupport {

  private MailTestSupport() {}

  /**
   * box@test.local 을 가리키는 계정을 직접 삽입하고 생성된 accountId 를 반환한다. aiEnabled 로 AI 분류 게이트를 제어한다(분류 테스트에서
   * true).
   */
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
