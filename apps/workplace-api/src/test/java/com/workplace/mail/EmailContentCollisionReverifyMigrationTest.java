package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.service.MailContentShareGate;
import com.workplace.mail.util.MailContentHash;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.function.Consumer;
import org.assertj.core.api.SoftAssertions;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-131: V141 이 V140 이전에 Message-ID 만으로 잘못 공유됐을 수 있는 envelope 만 미검증으로 되돌리는지 검증한다.
 *
 * <p>Testcontainers 는 빈 DB 에 마이그레이션을 돌리므로 V141 의 데이터 경로가 실행되지 않는다. 그래서 V140 이전 모양(fingerprint NULL
 * 공유 content)을 시드한 뒤 V141 스크립트를 직접 실행한다.
 */
class EmailContentCollisionReverifyMigrationTest extends IntegrationTestBase {

  private static final OffsetDateTime T0 = OffsetDateTime.parse("2026-09-01T00:00:00Z");
  private static final OffsetDateTime FETCHED = OffsetDateTime.parse("2026-09-01T01:00:00Z");

  @Autowired DSLContext dsl;
  @Autowired EmailAttachmentRepository attachmentRepo;
  @Autowired MailContentShareGate shareGate;

  /** 계정 + INBOX 폴더를 만들고 [accountId, folderId] 를 반환한다. */
  private long[] seedMailbox(String address) {
    long uid = TestFixtures.createHuman(dsl);
    long acc =
        dsl.insertInto(
                EMAIL_ACCOUNT,
                EMAIL_ACCOUNT.USER_ID,
                EMAIL_ACCOUNT.EMAIL_ADDRESS,
                EMAIL_ACCOUNT.TENANT_ID)
            .values(uid, address, 1L)
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();
    long fld =
        dsl.insertInto(
                EMAIL_FOLDER, EMAIL_FOLDER.ACCOUNT_ID, EMAIL_FOLDER.NAME, EMAIL_FOLDER.TENANT_ID)
            .values(acc, "INBOX", 1L)
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    return new long[] {acc, fld};
  }

  /** V140 이전 모양의 공유 content(fingerprint NULL, 첫 적재자 본문 기록됨). */
  private long seedContent(String messageId, String fingerprint) {
    return dsl.insertInto(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.TENANT_ID, 1L)
        .set(EMAIL_CONTENT.MESSAGE_ID, messageId)
        .set(EMAIL_CONTENT.THREAD_ID, messageId)
        .set(EMAIL_CONTENT.SUBJECT, "안내")
        .set(EMAIL_CONTENT.BODY_TEXT, "첫 수신자 본문")
        .set(EMAIL_CONTENT.CONTENT_HASH, MailContentHash.of("첫 수신자 본문", null))
        .set(EMAIL_CONTENT.BODY_FETCHED_AT, FETCHED)
        .set(EMAIL_CONTENT.FINGERPRINT, fingerprint)
        .returning(EMAIL_CONTENT.ID)
        .fetchOne()
        .getId();
  }

  /** 검증 완료(fetched_at) 상태 envelope. imapUid 가 null 이면 로컬 보낸메일 모양. */
  private long seedEnvelope(
      long[] box, long contentId, Long imapUid, String to, OffsetDateTime sentAt) {
    return seedEnvelope(box, contentId, imapUid, to, sentAt, FETCHED);
  }

  /** fetchedAt 을 지정한 envelope. content.body_fetched_at(FETCHED)과 가장 가까운 envelope 가 저장 본문의 주인이다. */
  private long seedEnvelope(
      long[] box,
      long contentId,
      Long imapUid,
      String to,
      OffsetDateTime sentAt,
      OffsetDateTime fetchedAt) {
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.TENANT_ID, 1L)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, box[0])
        .set(EMAIL_MESSAGE.FOLDER_ID, box[1])
        .set(EMAIL_MESSAGE.IMAP_UID, imapUid)
        .set(EMAIL_MESSAGE.THREAD_ID, "t")
        .set(EMAIL_MESSAGE.FROM_ADDRESS, "noti@corp.test")
        .set(EMAIL_MESSAGE.TO_ADDRESSES, to)
        .set(EMAIL_MESSAGE.SENT_AT, sentAt)
        .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
        .set(EMAIL_MESSAGE.FETCHED_AT, fetchedAt)
        .set(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY, "개인 요약")
        .set(EMAIL_MESSAGE.AI_PERSONAL_SUMMARIZED_AT, FETCHED)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  private static final ParsedAttachment ATT =
      new ParsedAttachment("guide.pdf", "application/pdf", 10L, null, null);

  private void runV141() {
    try {
      dsl.execute(
          new ClassPathResource("db/migration/V141__email_content_collision_reverify.sql")
              .getContentAsString(StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
  }

  private boolean fetched(long envId) {
    return dsl.fetchExists(
        EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(envId).and(EMAIL_MESSAGE.FETCHED_AT.isNotNull()));
  }

  private String personalSummary(long envId) {
    return dsl.select(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(envId))
        .fetchOneInto(String.class);
  }

  private int attachmentCount(long envId) {
    return dsl.fetchCount(EMAIL_ATTACHMENT, EMAIL_ATTACHMENT.MESSAGE_ID.eq(envId));
  }

  private long contentIdOf(long envId) {
    return dsl.select(EMAIL_MESSAGE.CONTENT_ID)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(envId))
        .fetchOneInto(Long.class);
  }

  /** 롤백 트랜잭션 안에서 시나리오를 실행하고 soft 단언을 모아 검증한다. */
  private void inRollbackTx(Consumer<SoftAssertions> scenario) {
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              status -> {
                SoftAssertions soft = new SoftAssertions();
                scenario.accept(soft);
                status.setRollbackOnly();
                soft.assertAll();
              });
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * 발신 시각이 다른 공유 그룹은 저장 본문의 주인만 남기고 미검증으로 되돌리며, 재적재 시 게이트가 다른 본문만 분리한다. V140 이전 updateBody 는 덮어쓰기라
   * 본문은 마지막 적재자(A)의 것이다.
   */
  @Test
  void suspectGroup_keepsOwner_reverifiesOthers_andGateSplitsOnlyDifferentBody() {
    long nano = System.nanoTime();
    inRollbackTx(
        soft -> {
          long[] a = seedMailbox("a-" + nano + "@corp.test");
          long[] b = seedMailbox("b-" + nano + "@corp.test");
          long[] c = seedMailbox("c-" + nano + "@corp.test");
          long content = seedContent("<noti-" + nano + "@corp.test>", null);
          long envA = seedEnvelope(a, content, 1L, "a@corp.test", T0, FETCHED);
          long envB =
              seedEnvelope(
                  b, content, 1L, "b@corp.test", T0.plusSeconds(30), FETCHED.minusMinutes(10));
          long envC =
              seedEnvelope(
                  c, content, 1L, "c@corp.test", T0.plusSeconds(60), FETCHED.minusMinutes(20));
          for (long env : new long[] {envA, envB, envC}) {
            attachmentRepo.insert(env, content, 0, ATT);
          }

          runV141();

          soft.assertThat(fetched(envA)).as("주인은 검증 유지").isTrue();
          soft.assertThat(personalSummary(envA)).as("주인 개인 요약 유지").isEqualTo("개인 요약");
          soft.assertThat(attachmentCount(envA)).as("주인 첨부 유지").isEqualTo(1);
          for (long env : new long[] {envB, envC}) {
            soft.assertThat(fetched(env)).as("미검증으로 되돌림 %d", env).isFalse();
            soft.assertThat(personalSummary(env)).as("개인 요약 삭제 %d", env).isNull();
            soft.assertThat(attachmentCount(env)).as("첨부 행 삭제 %d", env).isZero();
            soft.assertThat(contentIdOf(env)).as("미리 분리하지 않음 %d", env).isEqualTo(content);
          }

          // 재적재: C 는 같은 본문 → 공유 유지, B 는 다른 본문 → B 만 분리.
          long contentC =
              shareGate.storeFetchedBody(envC, content, "첫 수신자 본문", null, "첫 수신자 본문", List.of(ATT));
          long contentB =
              shareGate.storeFetchedBody(
                  envB, content, "두 번째 수신자 본문", null, "두 번째 수신자 본문", List.of(ATT));
          soft.assertThat(contentC).as("같은 본문은 공유 유지").isEqualTo(content);
          soft.assertThat(contentB).as("다른 본문은 분리").isNotEqualTo(content);
        });
  }

  /** 정상 공유·V140 이후 공유·보낸메일·재실행은 건드리지 않는다. */
  @Test
  void untouched_normalShare_postV140_sentMail_andRerunIsNoop() {
    long nano = System.nanoTime();
    inRollbackTx(
        soft -> {
          long[] a = seedMailbox("a-" + nano + "@corp.test");
          long[] b = seedMailbox("b-" + nano + "@corp.test");

          // 한 통을 두 명이 받은 정상 공유 — 헤더가 모두 같다.
          long normal = seedContent("<normal-" + nano + "@corp.test>", null);
          long n1 = seedEnvelope(a, normal, 2L, "a@corp.test,b@corp.test", T0);
          long n2 = seedEnvelope(b, normal, 2L, "a@corp.test,b@corp.test", T0);

          // V140 이후 지문으로 공유된 content — 게이트를 이미 통과했다.
          long post = seedContent("<post-" + nano + "@corp.test>", "e".repeat(64));
          long p1 = seedEnvelope(a, post, 3L, "a@corp.test", T0);
          long p2 = seedEnvelope(b, post, 3L, "b@corp.test", T0.plusSeconds(5));

          // 의심 그룹의 로컬 보낸메일 — 원본을 다시 받을 수 없으므로 제외.
          long withSent = seedContent("<sent-" + nano + "@corp.test>", null);
          long sent = seedEnvelope(a, withSent, null, "x@corp.test", T0);
          long recv = seedEnvelope(b, withSent, 4L, "b@corp.test", T0.plusSeconds(5));

          // 한쪽만 sent_at 이 NULL 인 그룹 — NULL 도 다른 값으로 본다.
          long nullDate = seedContent("<null-" + nano + "@corp.test>", null);
          long d1 = seedEnvelope(a, nullDate, 5L, "a@corp.test", T0);
          long d2 = seedEnvelope(b, nullDate, 5L, "a@corp.test", null, FETCHED.minusMinutes(1));

          runV141();
          soft.assertThat(fetched(d1)).as("NULL 날짜 그룹 주인 유지").isTrue();
          soft.assertThat(fetched(d2)).as("NULL 날짜 그룹은 의심 대상").isFalse();
          soft.assertThat(fetched(recv)).as("의심 그룹 수신 envelope 는 되돌림").isFalse();
          runV141(); // 재실행: 대상이 이미 미검증이라 아무것도 바뀌지 않아야 한다.

          for (long env : new long[] {n1, n2, p1, p2, sent}) {
            soft.assertThat(fetched(env)).as("검증 유지 %d", env).isTrue();
            soft.assertThat(personalSummary(env)).as("개인 요약 유지 %d", env).isEqualTo("개인 요약");
          }
        });
  }
}
