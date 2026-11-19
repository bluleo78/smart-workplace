package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MAIL_DRAFT;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.QueuedSend;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.service.MailDraftService;
import com.workplace.mail.service.MailSendQueueScheduler;
import com.workplace.mail.service.MailSendQueueService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * 보낸 뒤 임시보관 정리 실패(WP-1786 코드 리뷰) — 발송은 성공했는데 send 안의 임시보관 삭제가 실패해(경고로 삼켜진다) 행이 SENDING 으로 남으면, 10분
 * 뒤 멈춤 정리가 이미 나간 메일을 「보냈는지 확인하지 못함」으로 알려 사용자가 다시 보내게(중복 발송) 만든다. 대기열 발송기가 보낸 뒤 행이 남았는지 다시 확인해 지우는지
 * 본다.
 *
 * <p>send 안의 삭제({@link MailDraftService#deleteIfPresent})만 실패시키려고 그 서비스를 스파이로 바꾼다 — 그 때문에 Spring
 * 컨텍스트가 따로 뜨므로 이 경우만 별도 클래스로 둔다. 발송이 각자 트랜잭션으로 커밋돼야 해 테스트 트랜잭션 없이 돌고, 시드는 {@link #cleanup} 에서 지운다.
 */
class MailQueuedSenderDraftCleanupIntegrationTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired MailSendQueueScheduler scheduler;
  @Autowired MailSendQueueService queueService;
  @Autowired EncryptionService encryption;
  @Autowired GraphApiClient graphApiClient;
  @MockitoSpyBean MailDraftService draftService;

  private final List<Long> users = new ArrayList<>();

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  /** 알림 → file → 계정(임시저장 CASCADE) → 사용자 순으로 정리. */
  @AfterEach
  void cleanup() {
    if (!users.isEmpty()) {
      cleanupInTenant(
          1L,
          () -> {
            dsl.deleteFrom(NOTIFICATION).where(NOTIFICATION.RECIPIENT_ID.in(users)).execute();
            dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(users)).execute();
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.USER_ID.in(users)).execute();
            dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
          });
    }
    users.clear();
    TenantContext.clear();
  }

  @Test
  void send_안의_임시보관_삭제가_실패해도_보낸_뒤_다시_지워_SENDING_으로_남지_않는다() {
    long me = TestFixtures.createHuman(dsl);
    TestFixtures.ensureActiveMember(dsl, me, 1L);
    users.add(me);
    long acc = callInTenant(1L, () -> MailTestSupport.seedGraphAccount(dsl, encryption, me));
    long draftId =
        callInTenant(
            1L,
            () -> {
              QueuedSend q =
                  queueService.enqueue(
                      me,
                      acc,
                      new MailSendRequest(
                          List.of("peer@example.com"),
                          List.of(),
                          List.of(),
                          "삭제가 실패할 메일",
                          "<p>본문</p>",
                          "본문",
                          null));
              dsl.update(MAIL_DRAFT)
                  .set(MAIL_DRAFT.SEND_AT, DSL.currentOffsetDateTime().minus(1))
                  .where(MAIL_DRAFT.ID.eq(q.draftId()))
                  .execute();
              return q.draftId();
            });
    // send 안의 정리(deleteIfPresent)는 늘 실패 — send 는 이를 경고로 삼키고 성공으로 끝난다
    doThrow(new IllegalStateException("삭제 실패(테스트)"))
        .when(draftService)
        .deleteIfPresent(anyLong(), anyLong());

    scheduler.poll();

    verify(graphApiClient, times(1)).sendMail(any(), any());
    verify(draftService, times(1)).deleteIfPresent(me, draftId);
    // 발송기가 남은 행을 다시 지웠다 — 멈춤 정리가 「확인하지 못함」으로 알릴 행이 없다
    assertThat(callInTenant(1L, () -> dsl.fetchExists(MAIL_DRAFT, MAIL_DRAFT.ID.eq(draftId))))
        .isFalse();
    assertThat(
            callInTenant(1L, () -> dsl.fetchCount(NOTIFICATION, NOTIFICATION.RECIPIENT_ID.eq(me))))
        .isZero();
  }
}
