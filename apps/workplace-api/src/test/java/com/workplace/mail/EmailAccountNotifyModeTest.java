package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1739: email_account.notify_mode(새 메일 OS 푸시 알림 범위 ALL|WORK|OFF) 검증. 신규 계정은 컬럼 기본값 'WORK' 로
 * 적재되고, 갱신 후 재조회하면 그 값이 EmailAccountResponse.notifyMode() 로 돌아온다 — Task 3·4 가 이 getter 로 판정한다.
 * 메서드 @Transactional 로 공유 test DB 롤백(현행 리포지토리 통합 테스트 패턴).
 */
@Transactional
class EmailAccountNotifyModeTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailAccountRepository repo;

  /** 테스트용 IMAP 계정 요청 — 현행 리포지토리 테스트와 같은 최소 시드. */
  private EmailAccountRequest sampleReq(String email) {
    return new EmailAccountRequest(
        email,
        "표시명",
        "imap.example.com",
        993,
        MailSecurity.SSL_TLS,
        email,
        "smtp.example.com",
        587,
        MailSecurity.STARTTLS,
        email,
        "plain-pw",
        false);
  }

  /** INSERT 직후 notifyMode() 는 DB 기본값 'WORK', 'ALL' 로 갱신 후 재조회하면 'ALL' 이다. */
  @Test
  void insert_defaultsToWork_andUpdateToAll_isReflectedOnReread() {
    long user = TestFixtures.createHuman(dsl);
    long id = repo.insert(user, sampleReq("notify-mode@example.com"), "ENC");

    // 신규 계정: notify_mode 컬럼 기본값 'WORK'
    EmailAccountResponse before = repo.findByIdAndUser(user, id).orElseThrow();
    assertThat(before.notifyMode()).isEqualTo("WORK");

    // 'ALL' 로 갱신 — 현행 리포지토리에 알림 범위 갱신 메서드가 없어 테스트가 직접 jOOQ DSL 로 UPDATE 한다(테스트 코드 DSL 직접 사용 허용).
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.NOTIFY_MODE, "ALL")
        .where(EMAIL_ACCOUNT.ID.eq(id))
        .execute();

    EmailAccountResponse after = repo.findByIdAndUser(user, id).orElseThrow();
    assertThat(after.notifyMode()).isEqualTo("ALL");
  }
}
