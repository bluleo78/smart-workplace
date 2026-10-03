package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.dto.SeenSyncResult;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.ImapReadSyncer;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailSummaryBackfillService;
import com.workplace.mail.service.MailSyncProgress;
import com.workplace.mail.service.MailSyncService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * WP-187 IMAP 역동기화 — 접속 1회에 UID 묶음으로 \Seen 켜기/끄기.
 *
 * <p><b>@Transactional 금지</b>: 동기화가 짧은 트랜잭션으로 커밋한 행을 그대로 쓰고, 처리기는 운영(디스패처 조각 트랜잭션)과 같이 {@code
 * cleanupInTenant} 의 테넌트 트랜잭션 안에서 부른다 — 그래야 비밀번호 조회가 RLS 로 0행이 되는 회귀(#444)를 잡는다. 시드는
 * {@code @AfterEach} 에서 회수한다(ImapSeenSyncFailureTest 와 같은 구성).
 */
class ImapReadSyncerTest extends IntegrationTestBase {

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
  @Autowired EmailMessageRepository messageRepo;
  @Autowired ImapReadSyncer imapReadSyncer;

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

  @SuppressWarnings("unchecked")
  @Test
  void setsAndClearsSeen_inOneConnection() throws Exception {
    TenantContext.set(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.insertAccount(accountRepo, encryption, seededUser, false);
    MailTestPorts.sendText("box@test.local", "a@example.com", "읽을 메일", "본문");
    MailTestPorts.sendText("box@test.local", "b@example.com", "되돌릴 메일", "본문");
    greenMail.waitForIncomingEmail(2);
    MailTestPorts.setServerSeen("되돌릴 메일", true);
    syncService.sync(seededUser, seededAccount);
    progress.finish(seededAccount);

    long[] ids = new long[3];
    List<SeenSyncItem>[] items = new List[1];
    EmailAccountResponse[] account = new EmailAccountResponse[1];
    cleanupInTenant(
        1L,
        () -> {
          List<EmailMessageSummary> rows = messageRepo.listByAccount(seededAccount, null, 50);
          ids[0] = idOf(rows, "읽을 메일");
          ids[1] = idOf(rows, "되돌릴 메일");
          ids[2] = insertLocalPendingRow(); // 서버 UID 없는 로컬 행 — 반영할 것이 없으니 끝난 것으로 본다
          assertThat(messageRepo.markSeen(ids[0])).isEqualTo(1);
          assertThat(messageRepo.markUnseen(ids[1])).isEqualTo(1);
          items[0] = messageRepo.findPendingSeenSyncItems(List.of(ids[0], ids[1], ids[2]));
          account[0] = accountRepo.findByIdAndUser(seededUser, seededAccount).orElseThrow();
        });
    assertThat(items[0]).hasSize(3);
    assertThat(MailTestPorts.isServerSeen("읽을 메일")).isFalse();
    assertThat(MailTestPorts.isServerSeen("되돌릴 메일")).isTrue();

    // 운영처럼 테넌트 트랜잭션 안에서 호출 — 비밀번호를 실제로 읽어야 서버 상태가 바뀐다
    SeenSyncResult[] box = new SeenSyncResult[1];
    cleanupInTenant(
        1L,
        () -> {
          try {
            box[0] = imapReadSyncer.syncSeen(seededUser, account[0], items[0]);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });

    assertThat(box[0].succeeded()).containsExactlyInAnyOrder(ids[0], ids[1], ids[2]);
    assertThat(box[0].stopped()).isFalse();
    assertThat(MailTestPorts.isServerSeen("읽을 메일")).isTrue();
    assertThat(MailTestPorts.isServerSeen("되돌릴 메일")).isFalse();
  }

  private static long idOf(List<EmailMessageSummary> rows, String subject) {
    return rows.stream().filter(r -> subject.equals(r.subject())).findFirst().orElseThrow().id();
  }

  /** 동기화로 생긴 INBOX 에 imap_uid 없는 읽음·반영 대기 행을 하나 넣는다(로컬 생성 행 흉내). */
  private long insertLocalPendingRow() {
    long folderId =
        dsl.select(EMAIL_FOLDER.ID)
            .from(EMAIL_FOLDER)
            .where(EMAIL_FOLDER.ACCOUNT_ID.eq(seededAccount))
            .and(EMAIL_FOLDER.NAME.eq("INBOX"))
            .fetchOne(EMAIL_FOLDER.ID);
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, seededAccount)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.THREAD_ID, "thread-local-" + System.nanoTime())
        .set(EMAIL_MESSAGE.SEEN, true)
        .set(EMAIL_MESSAGE.SEEN_PUSH_PENDING, true)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }
}
