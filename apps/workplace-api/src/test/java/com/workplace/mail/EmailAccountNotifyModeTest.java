package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.service.EmailAccountService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
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
  @Autowired EmailAccountService service;

  /** 실시간 변경 알림 호출 여부만 확인하므로 spy — 실제 동작은 그대로 둔다. */
  @MockitoSpyBean MailChangeNotifier notifier;

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

  /** WP-1740: 본인 활성 계정은 setNotifyMode 로 값이 바뀌어 재조회에 반영된다. */
  @Test
  void setNotifyMode_updatesOwnAccount() {
    long user = TestFixtures.createHuman(dsl);
    long id = repo.insert(user, sampleReq("set-own@example.com"), "ENC");

    service.setNotifyMode(user, id, "OFF");

    assertThat(repo.findByIdAndUser(user, id).orElseThrow().notifyMode()).isEqualTo("OFF");
  }

  /** WP-1740: ALL|WORK|OFF 가 아닌 값(소문자 등)은 서비스에서 거부되고 저장값은 그대로다. */
  @Test
  void setNotifyMode_invalidValue_isRejected_andKeepsValue() {
    long user = TestFixtures.createHuman(dsl);
    long id = repo.insert(user, sampleReq("set-invalid@example.com"), "ENC");

    assertThatThrownBy(() -> service.setNotifyMode(user, id, "work"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> service.setNotifyMode(user, id, null))
        .isInstanceOf(IllegalArgumentException.class);

    assertThat(repo.findByIdAndUser(user, id).orElseThrow().notifyMode()).isEqualTo("WORK");
  }

  /** WP-1740: 다른 사용자의 계정은 404 예외이고 값은 그대로 'WORK' 다. */
  @Test
  void setNotifyMode_otherUsersAccount_throwsNotFound_andKeepsValue() {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long id = repo.insert(owner, sampleReq("set-other@example.com"), "ENC");

    assertThatThrownBy(() -> service.setNotifyMode(other, id, "ALL"))
        .isInstanceOf(EmailAccountNotFoundException.class);

    assertThat(repo.findByIdAndUser(owner, id).orElseThrow().notifyMode()).isEqualTo("WORK");
  }

  /** WP-1740: 비활성(soft delete) 계정은 404 예외다. */
  @Test
  void setNotifyMode_disabledAccount_throwsNotFound() {
    long user = TestFixtures.createHuman(dsl);
    long id = repo.insert(user, sampleReq("set-disabled@example.com"), "ENC");
    repo.softDelete(user, id);

    assertThatThrownBy(() -> service.setNotifyMode(user, id, "ALL"))
        .isInstanceOf(EmailAccountNotFoundException.class);
  }

  /** WP-1740: 변경에 성공하면 본인에게 계정 변경(updated) 실시간 이벤트를 낸다. */
  @Test
  void setNotifyMode_publishesAccountChanged() {
    long user = TestFixtures.createHuman(dsl);
    long id = repo.insert(user, sampleReq("set-event@example.com"), "ENC");

    service.setNotifyMode(user, id, "OFF");

    verify(notifier)
        .accountChanged(eq(ResourceChangedEvent.OP_UPDATED), eq(user), eq(id), eq(user));
  }

  /** WP-1740: 404 로 실패하면 이벤트를 내지 않는다. */
  @Test
  void setNotifyMode_notFound_publishesNothing() {
    long user = TestFixtures.createHuman(dsl);

    assertThatThrownBy(() -> service.setNotifyMode(user, 999_999L, "ALL"))
        .isInstanceOf(EmailAccountNotFoundException.class);

    verify(notifier, never()).accountChanged(anyString(), anyLong(), anyLong(), any());
  }
}
