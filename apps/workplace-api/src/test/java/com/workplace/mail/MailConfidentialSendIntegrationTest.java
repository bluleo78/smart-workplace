package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import java.util.function.Consumer;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-2029: 기밀로 보낸 메일의 보낸 사본은 상세·목록 응답에 confidential=true 로 나오고, 기밀이 아닌 발송은 false 다. 저장 경로는 실제 발송
 * 기록과 같은 {@link EmailMessageRepository#insertSentRow} 이며, 데이터는 트랜잭션 롤백으로 정리한다.
 */
class MailConfidentialSendIntegrationTest extends IntegrationTestBase {

  private static final long TENANT = 1L;

  @Autowired DSLContext dsl;
  @Autowired EmailMessageRepository messageRepo;

  @Test
  void confidentialSend_sentCopyDetailAndListReportConfidential() {
    inTenantTx(
        f -> {
          long id = send(f, "[기밀] 단가 협상안", true);
          EmailMessageDetail detail = messageRepo.findDetailByIdAndUser(f.userId, id).orElseThrow();
          assertThat(detail.confidential()).isTrue();
          assertThat(detail.subject()).isEqualTo("[기밀] 단가 협상안");
          assertThat(row(f, id).confidential()).isTrue();
        });
  }

  @Test
  void normalSend_sentCopyReportsNotConfidential() {
    inTenantTx(
        f -> {
          long id = send(f, "일반 메일", false);
          assertThat(messageRepo.findDetailByIdAndUser(f.userId, id).orElseThrow().confidential())
              .isFalse();
          assertThat(row(f, id).confidential()).isFalse();
        });
  }

  /** 보낸편지함 목록에서 해당 행을 찾는다. */
  private EmailMessageSummary row(Fixture f, long id) {
    return messageRepo.listByAccount(f.accountId, "SENT", null, 50).stream()
        .filter(s -> s.id() == id)
        .findFirst()
        .orElseThrow();
  }

  private long send(Fixture f, String subject, boolean confidential) {
    String mid = "conf-" + System.nanoTime() + "@iacloud.kr";
    OutgoingMail m =
        new OutgoingMail(
            mid,
            mid,
            f.me,
            "나",
            List.of(f.me),
            List.of(),
            List.of(),
            subject,
            "본문",
            null,
            null,
            null,
            "본문",
            Instant.now(),
            List.of(),
            List.of(),
            confidential);
    return messageRepo.insertSentRow(f.accountId, f.sentFolder, m).messageId();
  }

  private record Fixture(long userId, long accountId, long sentFolder, String me) {}

  /** 테넌트 1 트랜잭션 안에서 시드를 만들어 실행하고 롤백한다. */
  private void inTenantTx(Consumer<Fixture> body) {
    TenantContext.set(TENANT);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                body.accept(seed());
                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  private Fixture seed() {
    long uid = TestFixtures.createHuman(dsl);
    String me = "me-" + System.nanoTime() + "@iacloud.kr";
    long accountId =
        dsl.insertInto(
                EMAIL_ACCOUNT,
                EMAIL_ACCOUNT.USER_ID,
                EMAIL_ACCOUNT.EMAIL_ADDRESS,
                EMAIL_ACCOUNT.TENANT_ID,
                EMAIL_ACCOUNT.AI_ENABLED)
            .values(uid, me, TENANT, false)
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();
    long sent =
        dsl.insertInto(
                EMAIL_FOLDER, EMAIL_FOLDER.ACCOUNT_ID, EMAIL_FOLDER.NAME, EMAIL_FOLDER.TENANT_ID)
            .values(accountId, "SENT", TENANT)
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    return new Fixture(uid, accountId, sent, me);
  }
}
