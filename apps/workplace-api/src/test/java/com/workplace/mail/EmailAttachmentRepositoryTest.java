package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository.AttachmentDownloadContext;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * EmailAttachmentRepository 통합 테스트.
 *
 * <p>두 수신자가 같은 content_attachment(manifest)를 공유하며, 각 envelope의 attachmentId로 findContextForDownload
 * 시 동일 content_attachment_id·filename을 반환함을 검증한다. §3 소유 검증(타인 attachmentId 접근 차단)도 함께 검증한다.
 *
 * <p>RLS(FORCE) 통과를 위해 TenantContext + TransactionTemplate 패턴 사용.
 */
class EmailAttachmentRepositoryTest extends IntegrationTestBase {

  @Autowired private EmailAttachmentRepository repo;
  @Autowired private ContentAttachmentRepository contentAttachmentRepo;
  @Autowired private EmailContentRepository contentRepo;
  @Autowired private DSLContext dsl;

  private static final long TENANT_ID = 1L;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /**
   * 시드 헬퍼 결과 — attachmentId 와 userId 를 묶어 반환한다.
   *
   * @param attachmentId email_attachment.id
   * @param userId email_account.user_id
   */
  record Seeded(long attachmentId, long userId) {}

  /**
   * 테스트용 첨부 시드 헬퍼.
   *
   * <p>신규 사용자·계정·폴더·envelope(email_message)를 생성하고, 지정된 messageId 문자열로 email_content(findOrCreate)를
   * 가져온 뒤 ContentAttachmentRepository.findOrCreate 로 manifest를 공유시키고
   * EmailAttachmentRepository.insert 로 email_attachment 행을 삽입한다.
   *
   * @param providerMsgId 공유 메일 식별자(같은 값이면 같은 email_content를 공유)
   * @param filename 첨부 파일명
   * @param ordinal 첨부 순서(0-based MIME 인덱스)
   */
  private Seeded seedSharedAttachment(String providerMsgId, String filename, int ordinal) {
    long nano = System.nanoTime();

    // 신규 사용자 생성
    long userId = TestFixtures.createHuman(dsl);

    // 이메일 계정 생성
    Long accountId =
        dsl.insertInto(
                EMAIL_ACCOUNT,
                EMAIL_ACCOUNT.USER_ID,
                EMAIL_ACCOUNT.EMAIL_ADDRESS,
                EMAIL_ACCOUNT.TENANT_ID,
                EMAIL_ACCOUNT.AI_ENABLED)
            .values(userId, "att-test-" + nano + "@test.local", TENANT_ID, true)
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();

    // INBOX 폴더 생성
    Long folderId =
        dsl.insertInto(
                EMAIL_FOLDER, EMAIL_FOLDER.ACCOUNT_ID, EMAIL_FOLDER.NAME, EMAIL_FOLDER.TENANT_ID)
            .values(accountId, "INBOX", TENANT_ID)
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();

    // email_content(공유 manifest 앵커) find-or-create
    ParsedMessage pm =
        new ParsedMessage(
            nano,
            providerMsgId,
            "<thread-" + providerMsgId + ">",
            null,
            null,
            "sender@example.com",
            "Sender",
            "recv@example.com",
            null,
            "Test Subject",
            Instant.now(),
            Instant.now(),
            false,
            true,
            null,
            null,
            null,
            List.of());
    long contentId = contentRepo.findOrCreate(TENANT_ID, pm);

    // envelope(email_message) 생성
    Long messageId =
        dsl.insertInto(
                EMAIL_MESSAGE,
                EMAIL_MESSAGE.ACCOUNT_ID,
                EMAIL_MESSAGE.FOLDER_ID,
                EMAIL_MESSAGE.THREAD_ID,
                EMAIL_MESSAGE.MESSAGE_ID,
                EMAIL_MESSAGE.FROM_ADDRESS,
                EMAIL_MESSAGE.SEEN,
                EMAIL_MESSAGE.HAS_ATTACHMENT,
                EMAIL_MESSAGE.CONTENT_ID,
                EMAIL_MESSAGE.TENANT_ID)
            .values(
                accountId,
                folderId,
                "<thread-" + providerMsgId + ">",
                providerMsgId,
                "sender@example.com",
                false,
                true,
                contentId,
                TENANT_ID)
            .returning(EMAIL_MESSAGE.ID)
            .fetchOne()
            .getId();

    // email_attachment 삽입 (content_attachment find-or-create 포함)
    ParsedAttachment parsed = new ParsedAttachment(filename, "application/pdf", 1024L, null, null);
    repo.insert(messageId, contentId, ordinal, parsed);

    // 방금 삽입된 email_attachment id 조회
    Long attachmentId =
        dsl.select(com.workplace.jooq.Tables.EMAIL_ATTACHMENT.ID)
            .from(com.workplace.jooq.Tables.EMAIL_ATTACHMENT)
            .where(com.workplace.jooq.Tables.EMAIL_ATTACHMENT.MESSAGE_ID.eq(messageId))
            .and(com.workplace.jooq.Tables.EMAIL_ATTACHMENT.ORDINAL.eq(ordinal))
            .fetchOne(com.workplace.jooq.Tables.EMAIL_ATTACHMENT.ID);

    return new Seeded(attachmentId, userId);
  }

  /**
   * §3 소유 검증 + content_attachment 공유 검증.
   *
   * <p>두 사용자(A, B)가 같은 메일(같은 message_id)의 첨부를 각자 sync한 경우, 동일 content_attachment manifest를 공유하며, 각
   * envelope의 attachmentId로 findContextForDownload 시 동일 content_attachment_id·filename을 반환한다. §3
   * 불변식: 사용자 B는 사용자 A의 attachmentId로 컨텍스트를 조회할 수 없다.
   */
  @Test
  void 두_수신자_같은_content_attachment_공유_및_소유검증() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 동일 메일 식별자(같은 message_id → 같은 email_content)
              String sharedMsgId = "<shared-" + System.nanoTime() + "@corp>";

              // 사용자 A·B 각자의 envelope·email_attachment 시드
              Seeded a = seedSharedAttachment(sharedMsgId, "doc.pdf", 0);
              Seeded b = seedSharedAttachment(sharedMsgId, "doc.pdf", 0);

              // 각 envelope 의 첨부 컨텍스트 조회
              AttachmentDownloadContext ctxA =
                  repo.findContextForDownload(a.userId(), a.attachmentId()).orElseThrow();
              AttachmentDownloadContext ctxB =
                  repo.findContextForDownload(b.userId(), b.attachmentId()).orElseThrow();

              // 같은 manifest 공유 — content_attachment_id 동일
              assertThat(ctxA.contentAttachmentId())
                  .as("두 수신자는 같은 content_attachment manifest 를 공유해야 한다")
                  .isEqualTo(ctxB.contentAttachmentId());

              // filename 은 content_attachment 에서 읽힌다
              assertThat(ctxA.filename())
                  .as("filename 은 content_attachment.filename 출처여야 한다")
                  .isEqualTo("doc.pdf");
              assertThat(ctxB.filename()).isEqualTo("doc.pdf");

              // §3 소유 검증: 사용자 B는 A의 attachmentId로 접근 불가
              assertThat(repo.findContextForDownload(b.userId(), a.attachmentId()))
                  .as("§3: 사용자 B는 사용자 A의 attachmentId로 컨텍스트를 조회할 수 없어야 한다")
                  .isEmpty();

              // 롤백으로 테스트 데이터 자동 정리
              status.setRollbackOnly();
              return null;
            });
  }

  /**
   * Part A 회귀: content_attachment_id = NULL 인 미매니페스트 레거시 행도 findContextForDownload 가 반환해야 한다.
   *
   * <p>LEFT JOIN 이 INNER JOIN 으로 돌아가면 이 케이스는 empty 를 반환한다. §3 소유 검증(타인 접근 차단)도 함께 확인한다.
   */
  @Test
  void 미매니페스트_레거시행_LEFT_JOIN_및_소유검증() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              long nano = System.nanoTime();

              // 사용자 A — 소유자
              long userA = TestFixtures.createHuman(dsl);
              // 사용자 B — 타인 (§3 소유검증)
              long userB = TestFixtures.createHuman(dsl);

              // 계정 생성 (사용자 A)
              Long accountId =
                  dsl.insertInto(
                          EMAIL_ACCOUNT,
                          EMAIL_ACCOUNT.USER_ID,
                          EMAIL_ACCOUNT.EMAIL_ADDRESS,
                          EMAIL_ACCOUNT.TENANT_ID,
                          EMAIL_ACCOUNT.AI_ENABLED)
                      .values(userA, "legacy-" + nano + "@test.local", TENANT_ID, false)
                      .returning(EMAIL_ACCOUNT.ID)
                      .fetchOne()
                      .getId();

              // 폴더 생성
              Long folderId =
                  dsl.insertInto(
                          EMAIL_FOLDER,
                          EMAIL_FOLDER.ACCOUNT_ID,
                          EMAIL_FOLDER.NAME,
                          EMAIL_FOLDER.TENANT_ID)
                      .values(accountId, "INBOX", TENANT_ID)
                      .returning(EMAIL_FOLDER.ID)
                      .fetchOne()
                      .getId();

              // email_message — content_id = NULL (슬라이스① 이전 레거시 행 시뮬레이션)
              Long messageId =
                  dsl.insertInto(
                          EMAIL_MESSAGE,
                          EMAIL_MESSAGE.ACCOUNT_ID,
                          EMAIL_MESSAGE.FOLDER_ID,
                          EMAIL_MESSAGE.THREAD_ID,
                          EMAIL_MESSAGE.MESSAGE_ID,
                          EMAIL_MESSAGE.FROM_ADDRESS,
                          EMAIL_MESSAGE.SEEN,
                          EMAIL_MESSAGE.HAS_ATTACHMENT,
                          EMAIL_MESSAGE.TENANT_ID)
                      .values(
                          accountId,
                          folderId,
                          "<legacy-thread-" + nano + ">",
                          "<legacy-msg-" + nano + ">",
                          "sender@example.com",
                          false,
                          true,
                          TENANT_ID)
                      .returning(EMAIL_MESSAGE.ID)
                      .fetchOne()
                      .getId();

              // email_attachment — content_attachment_id = NULL (미매니페스트 레거시 행)
              Long attachmentId =
                  dsl.insertInto(
                          EMAIL_ATTACHMENT,
                          EMAIL_ATTACHMENT.MESSAGE_ID,
                          EMAIL_ATTACHMENT.ORDINAL,
                          EMAIL_ATTACHMENT.TENANT_ID)
                      .values(messageId, 0, TENANT_ID)
                      .returning(EMAIL_ATTACHMENT.ID)
                      .fetchOne()
                      .getId();

              // LEFT JOIN → 미매니페스트 행도 컨텍스트 반환 (Part A 핵심 회귀)
              var ctx = repo.findContextForDownload(userA, attachmentId);
              assertThat(ctx)
                  .as("미매니페스트 레거시 행도 findContextForDownload 가 반환해야 한다(LEFT JOIN)")
                  .isPresent();
              assertThat(ctx.get().filename()).as("미매니페스트 행은 filename = null 이어야 한다").isNull();
              assertThat(ctx.get().contentAttachmentId())
                  .as("미매니페스트 행은 contentAttachmentId = 0 이어야 한다")
                  .isEqualTo(0L);

              // §3 소유 검증: 사용자 B는 사용자 A의 attachmentId로 접근 불가
              assertThat(repo.findContextForDownload(userB, attachmentId))
                  .as("§3: 타인은 소유자 A의 attachmentId로 컨텍스트를 조회할 수 없어야 한다")
                  .isEmpty();

              status.setRollbackOnly();
              return null;
            });
  }
}
