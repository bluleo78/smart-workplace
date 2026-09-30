package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailContentShareGate;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import java.util.function.Consumer;
import org.assertj.core.api.SoftAssertions;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-130: 같은 테넌트에서 Message-ID 만 같은 서로 다른 메일이 content·첨부를 공유해 다른 사람 메일이 노출·변조되지 않는지 검증한다.
 *
 * <p>공격 시나리오: 사용자 X 가 A 메일의 Message-ID 를 알아내(References 헤더 등) 외부 SMTP 로 같은 Message-ID 를 단 메일을 자신에게
 * 보낸다. 방어선 ① 동기화 시점 지문(발신자·Date·제목·본문 구조), ② 본문 적재 시점 해시·첨부 목록 검증({@link MailContentShareGate}).
 * 정상적인 중복 수신은 계속 content 1벌을 공유해야 한다.
 */
class MailContentCollisionIntegrationTest extends IntegrationTestBase {

  private static final Instant SENT_A = Instant.parse("2026-09-01T00:00:00Z");
  private static final String STRUCTURE_A =
      "[multipart/mixed[text/plain;7bit;11;1;;][application/pdf;base64;10;-1;attachment;a-secret.pdf]]";

  @Autowired DSLContext dsl;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailAttachmentRepository attachmentRepo;
  @Autowired ContentAttachmentRepository contentAttachmentRepo;
  @Autowired MailContentShareGate shareGate;

  /** 사용자 1명 + 계정 + INBOX 폴더를 만들고 [userId, accountId, folderId] 를 반환한다. */
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
    return new long[] {uid, acc, fld};
  }

  /** IMAP 동기화 단계 메시지(헤더 + BODYSTRUCTURE 요약, 본문은 lazy 적재). */
  private static ParsedMessage imapHeader(
      long uid, String messageId, String from, String subject, Instant sentAt, String structure) {
    return new ParsedMessage(
        uid,
        messageId,
        messageId,
        null,
        null,
        from,
        null,
        "someone@corp.test",
        null,
        subject,
        sentAt,
        sentAt,
        false,
        false,
        null,
        null,
        null,
        List.of(),
        structure);
  }

  /** IMAP 동기화로 envelope 1건을 저장하고 id 를 반환한다. */
  private long sync(long[] box, ParsedMessage m) {
    return messageRepo.insertIgnoreConflict(box[1], box[2], m).orElseThrow();
  }

  private long contentIdOf(long envId) {
    return dsl.select(EMAIL_MESSAGE.CONTENT_ID)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(envId))
        .fetchOneInto(Long.class);
  }

  /** 본문 적재 — 실제 로더와 같은 순서(공유 게이트 → 첨부 삽입 → fetched 마킹). */
  private void loadBody(long envId, String body, ParsedAttachment att) {
    long contentId =
        shareGate.storeFetchedBody(envId, contentIdOf(envId), body, null, body, List.of(att));
    attachmentRepo.insert(envId, contentId, 0, att);
    messageRepo.markFetched(envId);
  }

  private long attachmentIdOf(long envId) {
    return dsl.select(EMAIL_ATTACHMENT.ID)
        .from(EMAIL_ATTACHMENT)
        .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(envId))
        .fetchOneInto(Long.class);
  }

  /** A 가 받은 원본 메일 적재 + 첨부 다운로드 완료(content_hash = blob 캐시 키 기록) 상태를 만든다. */
  private long seedVictim(long[] a, String msgId) {
    long envA = sync(a, imapHeader(1, msgId, "ceo@corp.test", "A 기밀 제목", SENT_A, STRUCTURE_A));
    loadBody(
        envA, "A 비밀 본문", new ParsedAttachment("a-secret.pdf", "application/pdf", 10L, null, null));
    long caA =
        dsl.select(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID)
            .from(EMAIL_ATTACHMENT)
            .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(envA))
            .fetchOneInto(Long.class);
    contentAttachmentRepo.setContentHashIfNull(caA, "a".repeat(64));
    return envA;
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

  /** X 가 A 의 제목·본문·첨부를 보지 못하고, A 의 메일은 그대로인지 공통 단언. */
  private void assertIsolated(
      SoftAssertions soft, long[] a, long envA, long[] x, long envX, String xBody) {
    var xDetail = messageRepo.findDetailByIdAndUser(x[0], envX).orElseThrow();
    soft.assertThat(xDetail.bodyText()).as("X 본문").isEqualTo(xBody);
    var xDl = attachmentRepo.findContextForDownload(x[0], attachmentIdOf(envX)).orElseThrow();
    soft.assertThat(xDl.filename()).as("X 첨부 파일명").isEqualTo("x.pdf");
    soft.assertThat(xDl.contentHash()).as("X 첨부가 A 첨부 캐시 키를 물려받음").isNull();
    soft.assertThat(contentIdOf(envX)).as("X 는 A 와 다른 content").isNotEqualTo(contentIdOf(envA));

    var aDetail = messageRepo.findDetailByIdAndUser(a[0], envA).orElseThrow();
    soft.assertThat(aDetail.subject()).as("A 제목").isEqualTo("A 기밀 제목");
    soft.assertThat(aDetail.bodyText()).as("A 본문 변조").isEqualTo("A 비밀 본문");
  }

  /** 방어선 ①: 헤더(발신자·Date·제목)가 다른 위조 메일은 동기화 시점부터 별도 content. */
  @Test
  void forgedMessageIdWithDifferentHeaders_isSeparatedAtSync() {
    long nano = System.nanoTime();
    String msgId = "<victim-" + nano + "@corp.test>";
    inRollbackTx(
        soft -> {
          long[] a = seedMailbox("a-" + nano + "@corp.test");
          long[] x = seedMailbox("x-" + nano + "@corp.test");
          long envA = seedVictim(a, msgId);

          long envX =
              sync(
                  x,
                  imapHeader(
                      2,
                      msgId,
                      "attacker@evil.test",
                      "X 메일",
                      Instant.parse("2026-09-20T00:00:00Z"),
                      STRUCTURE_A));

          // 본문 적재 전에도 A 의 제목·본문이 보이면 안 된다
          var before = messageRepo.findDetailByIdAndUser(x[0], envX).orElseThrow();
          soft.assertThat(before.subject()).as("적재 전 X 제목").isEqualTo("X 메일");
          soft.assertThat(before.bodyText()).as("적재 전 X 본문").isNull();

          loadBody(
              envX, "X 위조 본문", new ParsedAttachment("x.pdf", "application/pdf", 20L, null, null));
          assertIsolated(soft, a, envA, x, envX, "X 위조 본문");
        });
  }

  /** 방어선 ②: 헤더·구조까지 맞춘 위조라도 내려받은 본문 해시가 다르면 적재 시점에 분리. */
  @Test
  void forgedMessageIdWithSameFingerprint_isForkedOnBodyMismatch() {
    long nano = System.nanoTime();
    String msgId = "<victim-" + nano + "@corp.test>";
    inRollbackTx(
        soft -> {
          long[] a = seedMailbox("a-" + nano + "@corp.test");
          long[] x = seedMailbox("x-" + nano + "@corp.test");
          long envA = seedVictim(a, msgId);

          long envX =
              sync(x, imapHeader(2, msgId, "ceo@corp.test", "A 기밀 제목", SENT_A, STRUCTURE_A));
          soft.assertThat(contentIdOf(envX)).as("지문 일치 → 동기화 시점엔 공유").isEqualTo(contentIdOf(envA));

          loadBody(
              envX, "X 위조 본문", new ParsedAttachment("x.pdf", "application/pdf", 20L, null, null));
          assertIsolated(soft, a, envA, x, envX, "X 위조 본문");
        });
  }

  /** 방어선 ②: 본문까지 같아도 첨부 목록(파일명·크기)이 다르면 분리 — 첨부 캐시 키를 물려받지 않는다. */
  @Test
  void forgedMessageIdWithSameBody_isForkedOnAttachmentMismatch() {
    long nano = System.nanoTime();
    String msgId = "<victim-" + nano + "@corp.test>";
    inRollbackTx(
        soft -> {
          long[] a = seedMailbox("a-" + nano + "@corp.test");
          long[] x = seedMailbox("x-" + nano + "@corp.test");
          long envA = seedVictim(a, msgId);

          long envX =
              sync(x, imapHeader(2, msgId, "ceo@corp.test", "A 기밀 제목", SENT_A, STRUCTURE_A));
          loadBody(
              envX, "A 비밀 본문", new ParsedAttachment("x.pdf", "application/pdf", 20L, null, null));
          assertIsolated(soft, a, envA, x, envX, "A 비밀 본문");
        });
  }

  /** 정상 중복 수신: 같은 메일을 받은 두 IMAP 계정은 content·첨부 manifest 1벌을 공유하고, 두 번째 적재가 본문을 덮어쓰지 않는다. */
  @Test
  void sameMailToTwoRecipients_sharesOneContent() {
    long nano = System.nanoTime();
    String msgId = "<notice-" + nano + "@corp.test>";
    inRollbackTx(
        soft -> {
          long[] a = seedMailbox("a-" + nano + "@corp.test");
          long[] b = seedMailbox("b-" + nano + "@corp.test");
          long envA = seedVictim(a, msgId);

          long envB =
              sync(b, imapHeader(2, msgId, "ceo@corp.test", "A 기밀 제목", SENT_A, STRUCTURE_A));
          loadBody(
              envB,
              "A 비밀 본문",
              new ParsedAttachment("a-secret.pdf", "application/pdf", 10L, null, null));

          soft.assertThat(contentIdOf(envB)).as("같은 content 공유").isEqualTo(contentIdOf(envA));
          var bDl = attachmentRepo.findContextForDownload(b[0], attachmentIdOf(envB)).orElseThrow();
          soft.assertThat(bDl.contentHash()).as("첨부 캐시 공유").isEqualTo("a".repeat(64));
          var aDetail = messageRepo.findDetailByIdAndUser(a[0], envA).orElseThrow();
          soft.assertThat(aDetail.bodyText()).isEqualTo("A 비밀 본문");
        });
  }

  /** IMAP 구조 요약이 없으면(파싱 실패) 공유하지 않는다(fail-closed). */
  @Test
  void imapWithoutStructure_isNeverShared() {
    long nano = System.nanoTime();
    String msgId = "<nostruct-" + nano + "@corp.test>";
    inRollbackTx(
        soft -> {
          long[] a = seedMailbox("a-" + nano + "@corp.test");
          long[] b = seedMailbox("b-" + nano + "@corp.test");
          long envA = sync(a, imapHeader(1, msgId, "ceo@corp.test", "제목", SENT_A, null));
          long envB = sync(b, imapHeader(2, msgId, "ceo@corp.test", "제목", SENT_A, null));
          soft.assertThat(contentIdOf(envA)).isNotEqualTo(contentIdOf(envB));
        });
  }

  /** 이미 있는 envelope 재동기화(삽입 무시) 시 지문 없는 content 가 새로 생겨 고아로 남지 않는다. */
  @Test
  void resyncOfExistingEnvelope_leavesNoOrphanContent() {
    long nano = System.nanoTime();
    String msgId = "<resync-" + nano + "@corp.test>";
    inRollbackTx(
        soft -> {
          long[] a = seedMailbox("a-" + nano + "@corp.test");
          // 구조 요약 없음 → 지문 없음 → 재동기화마다 findOrCreate 가 새 content 를 만든다
          ParsedMessage m = imapHeader(7, msgId, "ceo@corp.test", "제목", SENT_A, null);
          sync(a, m);
          soft.assertThat(messageRepo.insertIgnoreConflict(a[1], a[2], m)).as("재동기화는 무시").isEmpty();
          long contents =
              dsl.fetchCount(
                  com.workplace.jooq.Tables.EMAIL_CONTENT,
                  com.workplace.jooq.Tables.EMAIL_CONTENT.MESSAGE_ID.eq(msgId));
          soft.assertThat(contents).as("content 행 수").isEqualTo(1);
        });
  }
}
