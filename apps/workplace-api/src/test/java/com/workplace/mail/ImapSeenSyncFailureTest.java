package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailSummaryBackfillService;
import com.workplace.mail.service.MailSyncProgress;
import com.workplace.mail.service.MailSyncService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * WP-148: IMAP 읽음 상태 동기화가 실패해도 신규 메일 적재는 막히지 않음을 검증한다(best-effort).
 *
 * <p>리포지토리를 spy 로 감싸 읽음 동기화 단계(대상 조회 · 반영)만 예외를 던지게 한다. <b>@Transactional 금지</b>: 운영처럼 각 짧은 트랜잭션이
 * 독립 커밋·롤백돼야 "읽음 단계 실패가 신규 적재를 되돌리지 않음"을 그대로 확인할 수 있다. 시드는 @AfterEach 에서 회수한다(#512 non-tx 격리 패턴).
 */
class ImapSeenSyncFailureTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(MailTestPorts.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EncryptionService encryption;
  @Autowired MailSyncProgress progress;

  /** 읽음 동기화 단계만 실패시키기 위한 spy — 나머지 메서드는 실제 동작. */
  @MockitoSpyBean EmailMessageRepository messageRepo;

  /** 비동기 본문 보충 차단 — 메타 적재만 결정적으로 본다. */
  @MockitoBean MailBackfillService backfillService;

  /** 선제 요약 차단. */
  @MockitoBean MailSummaryBackfillService summaryBackfillService;

  /** ai-agent 실호출 차단. */
  @MockitoBean AiAgentMailClient mailClient;

  private Long seededUser;
  private Long seededAccount;

  @AfterEach
  void cleanup() {
    if (seededAccount != null) {
      progress.finish(seededAccount);
      // 계정 삭제가 folder·message 를 CASCADE 로 함께 지운다
      cleanupInTenant(
          1L,
          () -> dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(seededAccount)).execute());
    }
    if (seededUser != null) {
      cleanupInTenant(1L, () -> dsl.deleteFrom(USER).where(USER.ID.eq(seededUser)).execute());
    }
    TenantContext.clear();
  }

  /** 첫 동기화로 기존 메일 1건을 적재해 두고(첫 동기화는 읽음 동기화를 건너뜀) 다음 sync 를 준비한다. */
  private void seedFirstSync() {
    TenantContext.set(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.insertAccount(accountRepo, encryption, seededUser, false);
    MailTestPorts.sendText("box@test.local", "alice@example.com", "기존 메일", "본문");
    greenMail.waitForIncomingEmail(1);
    syncService.sync(seededUser, seededAccount);
    progress.finish(seededAccount); // 백필 목킹으로 남은 진행 상태 해제
  }

  /** 읽음 재조회 대상 조회가 실패해도 새 메일은 적재되고 동기화는 성공한다. */
  @Test
  void seenCandidateLookupFails_newMailStillSaved() {
    seedFirstSync();
    doThrow(new IllegalStateException("seen lookup boom"))
        .when(messageRepo)
        .listRecentImapSeenStates(anyLong(), anyLong(), any(), anyInt());
    MailTestPorts.sendText("box@test.local", "bob@example.com", "새 메일", "본문");
    greenMail.waitForIncomingEmail(2);

    MailSyncResult r = syncService.sync(seededUser, seededAccount);

    // 실패 경로를 실제로 탔는지 확인(거짓 양성 방지)
    verify(messageRepo).listRecentImapSeenStates(anyLong(), anyLong(), any(), anyInt());
    assertThat(r.saved()).isEqualTo(1);
    assertThat(r.seenChanged()).isZero();
    assertThat(messageRepo.listByAccount(seededAccount, null, 50)).hasSize(2);
  }

  /** 읽음 반영(UPDATE)이 실패해도 같은 동기화의 새 메일은 적재되고 동기화는 성공한다. */
  @Test
  void seenApplyFails_newMailStillSaved() throws Exception {
    seedFirstSync();
    MailTestPorts.setServerSeen("기존 메일", true); // 반영 단계까지 가도록 실제 변화를 만든다
    doThrow(new IllegalStateException("seen apply boom"))
        .when(messageRepo)
        .updateSeenByImapUid(anyLong(), anyLong(), anyLong(), anyBoolean());
    MailTestPorts.sendText("box@test.local", "bob@example.com", "새 메일", "본문");
    greenMail.waitForIncomingEmail(2);

    MailSyncResult r = syncService.sync(seededUser, seededAccount);

    verify(messageRepo).updateSeenByImapUid(anyLong(), anyLong(), anyLong(), anyBoolean());
    assertThat(r.saved()).isEqualTo(1);
    assertThat(r.seenChanged()).isZero();
    assertThat(messageRepo.listByAccount(seededAccount, null, 50)).hasSize(2);
  }
}
