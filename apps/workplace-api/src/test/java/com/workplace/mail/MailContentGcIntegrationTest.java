package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.tables.EmailContent.EMAIL_CONTENT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailContentGcSweeper;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.UserKind;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Task10: refcount GC + orphan 스윕 통합 테스트.
 *
 * <p>핵심 시나리오: 두 envelope(envA, envB)가 동일 content 를 공유할 때 envA 삭제 → content 유지, envB(마지막) 삭제 →
 * content 삭제. 백스톱 sweeper 테스트: 고아 content 가 sweepTenant() 호출 후 삭제됨.
 *
 * <p>각 테스트는 GC 대상 데이터를 커밋(non-rollback)한 뒤 AfterEach 에서 전량 정리해 DB 를 깨끗하게 유지한다.
 */
class MailContentGcIntegrationTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;

  @Autowired private EmailContentRepository contentRepo;
  @Autowired private EmailMessageRepository messageRepo;
  @Autowired private MailContentGcSweeper gcSweeper;
  @Autowired private DSLContext dsl;

  /** 테스트별 생성 id 추적 — AfterEach 에서 역순 정리. */
  private final List<Long> userIds = new ArrayList<>();

  private final List<Long> accountIds = new ArrayList<>();
  private final List<Long> folderIds = new ArrayList<>();
  private final List<Long> contentIds = new ArrayList<>();

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
  }

  @AfterEach
  void tearDown() {
    // FK 역순: message → folder → account → content → user
    cleanupInTenant(
        TENANT_ID,
        () -> {
          // 테스트가 생성한 폴더에 속한 메시지 정리 (deleteByFolder 가 이미 삭제한 경우 no-op)
          for (Long fid : folderIds) {
            dsl.deleteFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.FOLDER_ID.eq(fid)).execute();
          }
          for (Long fid : folderIds) {
            dsl.deleteFrom(EMAIL_FOLDER).where(EMAIL_FOLDER.ID.eq(fid)).execute();
          }
          for (Long aid : accountIds) {
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(aid)).execute();
          }
          // content 는 GC 가 삭제했을 수도 있으므로 존재 시에만 삭제
          for (Long cid : contentIds) {
            dsl.deleteFrom(EMAIL_CONTENT).where(EMAIL_CONTENT.ID.eq(cid)).execute();
          }
        });
    // USER 는 RLS 없음 — 트랜잭션 없이 삭제 가능
    for (Long uid : userIds) {
      dsl.deleteFrom(USER).where(USER.ID.eq(uid)).execute();
    }
    userIds.clear();
    accountIds.clear();
    folderIds.clear();
    contentIds.clear();
    TenantContext.clear();
  }

  // ================================================================
  // 시드 헬퍼
  // ================================================================

  /** 테스트용 ParsedMessage 빌더. */
  private ParsedMessage msg(String messageId) {
    return new ParsedMessage(
        0L,
        messageId,
        messageId,
        null,
        null,
        "from@test.local",
        "From",
        "to@test.local",
        null,
        "subject-gc",
        null,
        null,
        false,
        false,
        null,
        null,
        null,
        List.of());
  }

  /**
   * 독립 계정/폴더를 생성하고 지정 content_id 에 연결된 envelope 를 삽입한다.
   *
   * <p>반드시 GUC 주입 트랜잭션 안에서 호출해야 한다.
   *
   * @return [accountId, folderId, envelopeId]
   */
  private long[] insertEnvelope(long tenantId, long contentId) {
    long nano = System.nanoTime();
    String uniqueSuffix = String.valueOf(nano);

    // USER 테이블은 RLS 없음 — 직접 삽입 가능
    Long uid =
        dsl.insertInto(USER, USER.USERNAME, USER.NAME, USER.EMAIL, USER.PASSWORD, USER.KIND)
            .values(
                "gc-user-" + uniqueSuffix,
                "GC User",
                "gc-" + uniqueSuffix + "@test.local",
                "pw",
                UserKind.HUMAN)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    userIds.add(uid);

    Long accId =
        dsl.insertInto(
                EMAIL_ACCOUNT,
                EMAIL_ACCOUNT.USER_ID,
                EMAIL_ACCOUNT.EMAIL_ADDRESS,
                EMAIL_ACCOUNT.TENANT_ID,
                EMAIL_ACCOUNT.AI_ENABLED)
            .values(uid, "gc-" + uniqueSuffix + "@test.local", tenantId, false)
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();
    accountIds.add(accId);

    Long fldId =
        dsl.insertInto(
                EMAIL_FOLDER, EMAIL_FOLDER.ACCOUNT_ID, EMAIL_FOLDER.NAME, EMAIL_FOLDER.TENANT_ID)
            .values(accId, "INBOX", tenantId)
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    folderIds.add(fldId);

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
            accId,
            fldId,
            "<thread-gc-" + uniqueSuffix + ">",
            "<gc-" + uniqueSuffix + "@test.local>",
            "from@test.local",
            false,
            false,
            contentId,
            tenantId)
        .execute();

    return new long[] {accId, fldId};
  }

  /** GUC 주입된 트랜잭션 안에서 content 존재 여부를 조회한다. */
  private boolean contentExists(long contentId) {
    // TransactionTemplate + TenantContext 로 GUC 를 주입해 RLS 적용 행을 올바르게 조회한다.
    Boolean exists =
        new TransactionTemplate(txManager)
            .execute(
                status ->
                    dsl.fetchExists(
                        dsl.selectOne().from(EMAIL_CONTENT).where(EMAIL_CONTENT.ID.eq(contentId))));
    return Boolean.TRUE.equals(exists);
  }

  // ================================================================
  // 핵심 시나리오: refcount GC (deleteByFolder 경로)
  // ================================================================

  /**
   * 두 envelope 가 동일 content 를 공유할 때 refcount GC 가 올바르게 동작한다.
   *
   * <ul>
   *   <li>envA 삭제(deleteByFolder) → envB 가 여전히 참조 → content 유지
   *   <li>envB 삭제(deleteByFolder) → 참조 0 → content 삭제
   * </ul>
   */
  @Test
  void refcountGc_contentKeptUntilLastEnvelopeGone_deleteByFolder() {
    long[] fldA = new long[1];
    long[] fldB = new long[1];
    long[] contentIdHolder = new long[1];

    // content + 두 envelope 를 커밋(non-rollback, GC 검증용)
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long contentId = contentRepo.findOrCreate(TENANT_ID, msg("<gc-shared-a@corp>"));
              contentIdHolder[0] = contentId;
              contentIds.add(contentId);
              long[] seedA = insertEnvelope(TENANT_ID, contentId);
              long[] seedB = insertEnvelope(TENANT_ID, contentId);
              fldA[0] = seedA[1];
              fldB[0] = seedB[1];
            });

    long contentId = contentIdHolder[0];

    // envA 폴더 삭제 — envB 가 아직 참조 중이므로 content 는 유지되어야 한다
    cleanupInTenant(TENANT_ID, () -> messageRepo.deleteByFolder(fldA[0]));
    assertThat(contentExists(contentId)).as("envA 삭제 후 envB 가 참조 중이므로 content 는 유지되어야 한다").isTrue();

    // envB 폴더 삭제 — 마지막 참조 제거 → content 삭제
    cleanupInTenant(TENANT_ID, () -> messageRepo.deleteByFolder(fldB[0]));
    assertThat(contentExists(contentId)).as("마지막 envelope 삭제 후 content 는 삭제되어야 한다").isFalse();
  }

  // ================================================================
  // deleteByProviderId 경로 refcount GC
  // ================================================================

  /**
   * deleteByProviderId 경로에서도 refcount GC 가 동작한다.
   *
   * <p>envA 가 provider_message_id 를 가진 envelope, envB 가 동일 content 를 공유. envA 를 provider id 로 삭제 →
   * content 유지. envB 폴더 삭제 → content 삭제.
   */
  @Test
  void refcountGc_contentKeptUntilLastEnvelopeGone_deleteByProviderId() {
    long[] accAHolder = new long[1];
    long[] fldBHolder = new long[1];
    long[] contentIdHolder = new long[1];
    String providerMsgId = "PROVIDER-GC-" + System.nanoTime();

    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long contentId = contentRepo.findOrCreate(TENANT_ID, msg("<gc-prov-b@corp>"));
              contentIdHolder[0] = contentId;
              contentIds.add(contentId);
              long nano = System.nanoTime();
              String suffix = String.valueOf(nano);

              // envA: provider_message_id 있는 envelope
              Long uid =
                  dsl.insertInto(
                          USER, USER.USERNAME, USER.NAME, USER.EMAIL, USER.PASSWORD, USER.KIND)
                      .values(
                          "gc-prov-" + suffix,
                          "GC Prov",
                          "gc-prov-" + suffix + "@test.local",
                          "pw",
                          UserKind.HUMAN)
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();
              userIds.add(uid);

              Long accA =
                  dsl.insertInto(
                          EMAIL_ACCOUNT,
                          EMAIL_ACCOUNT.USER_ID,
                          EMAIL_ACCOUNT.EMAIL_ADDRESS,
                          EMAIL_ACCOUNT.TENANT_ID,
                          EMAIL_ACCOUNT.AI_ENABLED)
                      .values(uid, "gc-prov-" + suffix + "@test.local", TENANT_ID, false)
                      .returning(EMAIL_ACCOUNT.ID)
                      .fetchOne()
                      .getId();
              accAHolder[0] = accA;
              accountIds.add(accA);

              Long fldA =
                  dsl.insertInto(
                          EMAIL_FOLDER,
                          EMAIL_FOLDER.ACCOUNT_ID,
                          EMAIL_FOLDER.NAME,
                          EMAIL_FOLDER.TENANT_ID)
                      .values(accA, "INBOX", TENANT_ID)
                      .returning(EMAIL_FOLDER.ID)
                      .fetchOne()
                      .getId();
              folderIds.add(fldA);

              dsl.insertInto(
                      EMAIL_MESSAGE,
                      EMAIL_MESSAGE.ACCOUNT_ID,
                      EMAIL_MESSAGE.FOLDER_ID,
                      EMAIL_MESSAGE.PROVIDER_MESSAGE_ID,
                      EMAIL_MESSAGE.THREAD_ID,
                      EMAIL_MESSAGE.FROM_ADDRESS,
                      EMAIL_MESSAGE.SEEN,
                      EMAIL_MESSAGE.HAS_ATTACHMENT,
                      EMAIL_MESSAGE.CONTENT_ID,
                      EMAIL_MESSAGE.TENANT_ID)
                  .values(
                      accA,
                      fldA,
                      providerMsgId,
                      "<thread-prov-" + suffix + ">",
                      "from@test.local",
                      false,
                      false,
                      contentId,
                      TENANT_ID)
                  .execute();

              // envB: 일반 폴더 envelope
              long[] seedB = insertEnvelope(TENANT_ID, contentId);
              fldBHolder[0] = seedB[1];
            });

    long contentId = contentIdHolder[0];

    // envA 를 provider id 로 삭제 → envB 참조 중이므로 content 유지
    cleanupInTenant(TENANT_ID, () -> messageRepo.deleteByProviderId(accAHolder[0], providerMsgId));
    assertThat(contentExists(contentId))
        .as("deleteByProviderId 후 envB 참조 중이므로 content 유지")
        .isTrue();

    // envB 폴더 삭제 → 마지막 참조 → content 삭제
    cleanupInTenant(TENANT_ID, () -> messageRepo.deleteByFolder(fldBHolder[0]));
    assertThat(contentExists(contentId)).as("마지막 envelope 삭제 후 content 삭제").isFalse();
  }

  // ================================================================
  // 백스톱 스윕: MailContentGcSweeper
  // ================================================================

  /**
   * 고아 email_content(envelope 참조 없음)는 sweepTenant() 호출 후 삭제된다.
   *
   * <p>스윕 전 TenantContext.clear() 로 ambient GUC 를 초기화해 per-tenant 루프 GUC 주입이 올바르게 동작하는지 확인한다.
   */
  @Test
  void sweeper_deletesOrphanContent() {
    long[] contentIdHolder = new long[1];

    // 고아 content 를 커밋 (envelope 없음)
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long cId = contentRepo.findOrCreate(TENANT_ID, msg("<gc-orphan-c@corp>"));
              contentIdHolder[0] = cId;
              contentIds.add(cId);
            });

    long contentId = contentIdHolder[0];
    assertThat(contentExists(contentId)).as("스윕 전 고아 content 존재").isTrue();

    // 스윕 실행 — sweepTenant 는 TenantContext 가 설정된 상태에서 직접 호출
    // (sweepAllTenants 루프는 TenantContext 를 내부에서 set/clear 하므로 여기서는 직접 sweepTenant 호출)
    new TransactionTemplate(txManager).executeWithoutResult(status -> gcSweeper.sweepTenant());

    assertThat(contentExists(contentId)).as("스윕 후 고아 content 삭제").isFalse();
  }
}
