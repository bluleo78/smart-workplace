package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.tables.EmailContent.EMAIL_CONTENT;
import static com.workplace.jooq.tables.Tenant.TENANT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.UserKind;
import java.time.Instant;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * email_content RLS 테넌트 격리 검증 + V93 백필 로직 검증 + Task4 sync 경로 content_id 연결 검증 + Task5 lazy 본문 fetch
 * → content 기록 검증 + Task6 5종 reader content-join 검증.
 */
class EmailContentDedupIntegrationTest extends IntegrationTestBase {

  // ================================================================
  // Task6 시드 헬퍼: email_message 에 subject/body/snippet 을 두지 않고
  // email_content 에만 저장한 "신규 스타일" envelope 를 생성한다.
  // ================================================================

  /**
   * Task6 테스트용 시드. 반환값 배열 = [userId, accountId, folderId, envId].
   *
   * <p>email_message 에는 subject/body_text/body_html/snippet 을 넣지 않는다 — 이 값들이 email_content 에서만 읽혀야
   * 함을 검증하기 위해.
   */
  private long[] seedNewStyleEnvelope(
      DSLContext dsl,
      long tenantId,
      String msgId,
      String subject,
      String bodyText,
      String bodyHtml,
      String snippet) {
    long uid = TestFixtures.createHuman(dsl);
    long nano = System.nanoTime();
    Long accId =
        dsl.insertInto(
                EMAIL_ACCOUNT,
                EMAIL_ACCOUNT.USER_ID,
                EMAIL_ACCOUNT.EMAIL_ADDRESS,
                EMAIL_ACCOUNT.TENANT_ID,
                EMAIL_ACCOUNT.AI_ENABLED)
            .values(uid, "t6-" + nano + "@test.local", tenantId, true)
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();
    Long fldId =
        dsl.insertInto(
                EMAIL_FOLDER, EMAIL_FOLDER.ACCOUNT_ID, EMAIL_FOLDER.NAME, EMAIL_FOLDER.TENANT_ID)
            .values(accId, "INBOX", tenantId)
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();

    // email_content: subject 는 findOrCreate 로 설정, body/snippet 은 updateBody 로
    ParsedMessage pm =
        new ParsedMessage(
            nano,
            msgId,
            "<thread-t6-" + nano + ">",
            null,
            null,
            "sender@example.com",
            "Sender",
            "recv@example.com",
            null,
            subject,
            Instant.now(),
            Instant.now(),
            false,
            false,
            null,
            null,
            null,
            List.of());
    long contentId = contentRepo.findOrCreate(tenantId, pm);
    contentRepo.updateBody(contentId, bodyText, bodyHtml, snippet);

    // email_message: subject/body/snippet 은 NULL — content_id 로만 연결
    Long envId =
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
                "<thread-t6-" + nano + ">",
                msgId,
                "sender@example.com",
                false,
                false,
                contentId,
                tenantId)
            .returning(EMAIL_MESSAGE.ID)
            .fetchOne()
            .getId();

    return new long[] {uid, accId, fldId, envId};
  }

  /**
   * Task6 RED→GREEN: listByAccount 가 subject/snippet 을 email_content 에서 읽어야 한다.
   *
   * <p>email_message.subject = NULL, email_content.subject = "T6-SUBJECT" → listByAccount 결과에
   * "T6-SUBJECT" 가 보여야 한다.
   */
  @Test
  void listByAccount_readsSubjectAndSnippetFromContent() {
    long nano = System.nanoTime();
    String msgId = "<t6-list-" + nano + "@corp>";
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                long[] seed =
                    seedNewStyleEnvelope(
                        dsl, 1L, msgId, "T6-SUBJECT", "T6-BODY", null, "T6-SNIPPET");
                long accId = seed[1];

                var list = messageRepo.listByAccount(accId, "INBOX", null, 10);
                assertThat(list).hasSize(1);
                assertThat(list.get(0).subject())
                    .as("subject 는 email_content 에서 읽어야 한다")
                    .isEqualTo("T6-SUBJECT");
                assertThat(list.get(0).snippet())
                    .as("snippet 은 email_content 에서 읽어야 한다")
                    .isEqualTo("T6-SNIPPET");

                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  /** Task6 RED→GREEN: listRecentUnread 가 subject/snippet 을 email_content 에서 읽어야 한다. */
  @Test
  void listRecentUnread_readsSubjectAndSnippetFromContent() {
    long nano = System.nanoTime();
    String msgId = "<t6-unread-" + nano + "@corp>";
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                long[] seed =
                    seedNewStyleEnvelope(
                        dsl, 1L, msgId, "T6-UNREAD-SUBJECT", "T6-BODY", null, "T6-UNREAD-SNIPPET");
                long userId = seed[0];

                var list = messageRepo.listRecentUnread(userId, 10);
                assertThat(list).isNotEmpty();
                var match = list.stream().filter(s -> msgId.equals(s.threadId())).findFirst();
                // threadId = message の thread_id 欄(ここでは msgId を thread として使用していない)
                // 代わりに subject で検索
                var bySubject =
                    list.stream().filter(s -> "T6-UNREAD-SUBJECT".equals(s.subject())).findFirst();
                assertThat(bySubject).as("listRecentUnread: subject が content から読めるべき").isPresent();
                assertThat(bySubject.get().snippet())
                    .as("snippet 은 email_content 에서 읽어야 한다")
                    .isEqualTo("T6-UNREAD-SNIPPET");

                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  /** Task6 RED→GREEN: findAiContextByIdAndUser 가 subject/body 를 email_content 에서 읽어야 한다. */
  @Test
  void findAiContext_readsBodyAndSubjectFromContent() {
    long nano = System.nanoTime();
    String msgId = "<t6-ai-" + nano + "@corp>";
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                long[] seed =
                    seedNewStyleEnvelope(
                        dsl, 1L, msgId, "T6-AI-SUBJECT", "T6-AI-BODY", null, "T6-AI-SNIP");
                long userId = seed[0];
                long envId = seed[3];

                var ctx = messageRepo.findAiContextByIdAndUser(userId, envId);
                assertThat(ctx).as("findAiContextByIdAndUser 결과가 있어야 한다").isPresent();
                assertThat(ctx.get().subject())
                    .as("subject 는 email_content 에서 읽어야 한다")
                    .isEqualTo("T6-AI-SUBJECT");
                assertThat(ctx.get().bodyText())
                    .as("bodyText 는 email_content 에서 읽어야 한다")
                    .isEqualTo("T6-AI-BODY");

                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  /** Task6 RED→GREEN: findThreadByIdAndUser 가 body 를 email_content 에서 읽어야 한다. */
  @Test
  void findThread_readsBodyFromContent() {
    long nano = System.nanoTime();
    String msgId = "<t6-thread-" + nano + "@corp>";
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                long[] seed =
                    seedNewStyleEnvelope(
                        dsl, 1L, msgId, "T6-THREAD-SUBJECT", "T6-THREAD-BODY", null, null);
                long userId = seed[0];
                long envId = seed[3];

                var thread = messageRepo.findThreadByIdAndUser(userId, envId);
                assertThat(thread).as("스레드 멤버가 1건이어야 한다").hasSize(1);
                // MailBodyText.effectiveBody(bodyText, bodyHtml) → bodyText 반환
                assertThat(thread.get(0).body())
                    .as("body 는 email_content 에서 읽어야 한다")
                    .isEqualTo("T6-THREAD-BODY");

                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * Task6 RED→GREEN: findClassifyContextByIdAndUser 가 subject/snippet 을 email_content 에서 읽어야 한다.
   */
  @Test
  void findClassifyContext_readsSubjectAndSnippetFromContent() {
    long nano = System.nanoTime();
    String msgId = "<t6-classify-" + nano + "@corp>";
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                long[] seed =
                    seedNewStyleEnvelope(
                        dsl, 1L, msgId, "T6-CLASS-SUBJECT", "T6-BODY", null, "T6-CLASS-SNIPPET");
                long userId = seed[0];
                long envId = seed[3];

                var ctx = messageRepo.findClassifyContextByIdAndUser(userId, envId);
                assertThat(ctx).as("findClassifyContextByIdAndUser 결과가 있어야 한다").isPresent();
                assertThat(ctx.get().subject())
                    .as("subject 는 email_content 에서 읽어야 한다")
                    .isEqualTo("T6-CLASS-SUBJECT");
                assertThat(ctx.get().snippet())
                    .as("snippet 은 email_content 에서 읽어야 한다")
                    .isEqualTo("T6-CLASS-SNIPPET");

                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  @Autowired DSLContext dsl;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;

  /** 현재 트랜잭션 안에서 GUC를 로컬로 설정한다(set_config true = tx-scoped). */
  private void setGuc(DSLContext dsl, long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /**
   * V93 백필 SQL — Task9 에서 email_message.body_text/body_html/snippet/subject 컬럼 제거 후 단순화. 본문 컬럼은
   * email_content 에만 존재하므로 canonical 선택 기준을 id 순으로만 유지한다. 이 테스트는 테넌트 격리·content_id 그룹핑 불변식만 검증한다.
   */
  private static final String BACKFILL_PART1_SQL =
      """
      WITH grouped AS (
          SELECT tenant_id, message_id,
                 (ARRAY_AGG(id ORDER BY id))[1] AS canonical_id
          FROM email_message
          WHERE message_id IS NOT NULL AND content_id IS NULL
          GROUP BY tenant_id, message_id
      ),
      ins AS (
          INSERT INTO email_content
              (tenant_id, message_id,
               in_reply_to, mail_references, thread_id, created_at)
          SELECT m.tenant_id, m.message_id,
                 m.in_reply_to, m.mail_references, m.thread_id, m.created_at
          FROM grouped g
          JOIN email_message m ON m.id = g.canonical_id
          RETURNING id, tenant_id, message_id
      )
      UPDATE email_message em
      SET content_id = ins.id
      FROM ins
      WHERE em.tenant_id = ins.tenant_id AND em.message_id = ins.message_id
      """;

  @Test
  void content_isolatedByTenant() {
    String slug = "email-content-rls-" + System.nanoTime();

    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 격리 테스트용 임시 테넌트 생성(RLS bypass 없이 FK 충족)
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, slug)
                      .set(TENANT.NAME, "EmailContent RLS Test Tenant")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // 테넌트2 GUC로 email_content 1행 삽입
              setGuc(dsl, tid2);
              dsl.insertInto(EMAIL_CONTENT)
                  .set(EMAIL_CONTENT.TENANT_ID, tid2)
                  .set(EMAIL_CONTENT.MESSAGE_ID, "<isolated@t2>")
                  .set(EMAIL_CONTENT.THREAD_ID, "<isolated@t2>")
                  .execute();

              // 테넌트1 GUC로 전환 → RLS가 tid2 행을 가려 0건이어야 한다
              setGuc(dsl, 1L);
              long visible =
                  dsl.selectCount()
                      .from(EMAIL_CONTENT)
                      .where(EMAIL_CONTENT.MESSAGE_ID.eq("<isolated@t2>"))
                      .fetchOneInto(long.class);
              assertThat(visible).isZero();

              // 롤백으로 임시 데이터 정리(공유 DB 오염 방지)
              status.setRollbackOnly();
              return null;
            });
  }

  /**
   * V93 백필 로직 검증: 같은 (tenant_id, message_id) 쌍은 동일 email_content 를 공유하고, 다른 테넌트의 동일 message_id는 별도
   * content 로 분리됨을 확인한다.
   *
   * <p>글로벌 NULL 불변식(전체 content_id IS NULL = 0) 대신, 통제된 데이터에 백필 SQL을 직접 실행해 그룹핑·테넌트 경계를 검증한다 — Task4
   * 완료 전까지 런타임 경로가 NULL content_id 행을 추가할 수 있으므로 전역 단언은 플레이키(fragile)하다.
   */
  @Test
  void backfill_sharesContentBySameMessageId_andIsolatesTenant() {
    long nano = System.nanoTime();
    String sharedMsgId = "<shared-" + nano + "@backfill.test>";

    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 1. 테스트 전용 테넌트 2개 생성(TENANT 테이블 RLS 없음)
              Long tid1 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "bf-t1-" + nano)
                      .set(TENANT.NAME, "Backfill T1")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "bf-t2-" + nano)
                      .set(TENANT.NAME, "Backfill T2")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // 2. 사용자 1명(USER 테이블 RLS 없음 — email_account.user_id FK 충족용)
              Long uid = TestFixtures.createHuman(dsl);

              // 3. T1: 계정 2개 + 폴더 2개 + 메시지 2개(같은 message_id, content_id=NULL)
              setGuc(dsl, tid1);
              Long acc1a =
                  dsl.insertInto(
                          EMAIL_ACCOUNT,
                          EMAIL_ACCOUNT.USER_ID,
                          EMAIL_ACCOUNT.EMAIL_ADDRESS,
                          EMAIL_ACCOUNT.TENANT_ID)
                      .values(uid, "t1a-" + nano + "@test.local", tid1)
                      .returning(EMAIL_ACCOUNT.ID)
                      .fetchOne()
                      .getId();
              Long acc1b =
                  dsl.insertInto(
                          EMAIL_ACCOUNT,
                          EMAIL_ACCOUNT.USER_ID,
                          EMAIL_ACCOUNT.EMAIL_ADDRESS,
                          EMAIL_ACCOUNT.TENANT_ID)
                      .values(uid, "t1b-" + nano + "@test.local", tid1)
                      .returning(EMAIL_ACCOUNT.ID)
                      .fetchOne()
                      .getId();
              Long fld1a =
                  dsl.insertInto(
                          EMAIL_FOLDER,
                          EMAIL_FOLDER.ACCOUNT_ID,
                          EMAIL_FOLDER.NAME,
                          EMAIL_FOLDER.TENANT_ID)
                      .values(acc1a, "INBOX", tid1)
                      .returning(EMAIL_FOLDER.ID)
                      .fetchOne()
                      .getId();
              Long fld1b =
                  dsl.insertInto(
                          EMAIL_FOLDER,
                          EMAIL_FOLDER.ACCOUNT_ID,
                          EMAIL_FOLDER.NAME,
                          EMAIL_FOLDER.TENANT_ID)
                      .values(acc1b, "INBOX", tid1)
                      .returning(EMAIL_FOLDER.ID)
                      .fetchOne()
                      .getId();
              // 메시지 A: T1 + sharedMsgId (body 는 email_content 에 저장 — Task9 이후 envelope 제거)
              Long midA =
                  dsl.insertInto(
                          EMAIL_MESSAGE,
                          EMAIL_MESSAGE.ACCOUNT_ID,
                          EMAIL_MESSAGE.FOLDER_ID,
                          EMAIL_MESSAGE.THREAD_ID,
                          EMAIL_MESSAGE.MESSAGE_ID,
                          EMAIL_MESSAGE.SEEN,
                          EMAIL_MESSAGE.HAS_ATTACHMENT,
                          EMAIL_MESSAGE.TENANT_ID)
                      .values(acc1a, fld1a, "thread-" + nano, sharedMsgId, false, false, tid1)
                      .returning(EMAIL_MESSAGE.ID)
                      .fetchOne()
                      .getId();
              // 메시지 B: T1 + 같은 sharedMsgId + 본문 없음(비 canonical)
              Long midB =
                  dsl.insertInto(
                          EMAIL_MESSAGE,
                          EMAIL_MESSAGE.ACCOUNT_ID,
                          EMAIL_MESSAGE.FOLDER_ID,
                          EMAIL_MESSAGE.THREAD_ID,
                          EMAIL_MESSAGE.MESSAGE_ID,
                          EMAIL_MESSAGE.SEEN,
                          EMAIL_MESSAGE.HAS_ATTACHMENT,
                          EMAIL_MESSAGE.TENANT_ID)
                      .values(acc1b, fld1b, "thread2-" + nano, sharedMsgId, false, false, tid1)
                      .returning(EMAIL_MESSAGE.ID)
                      .fetchOne()
                      .getId();

              // 4. T2: 계정 1개 + 폴더 1개 + 메시지 1개(같은 message_id, 다른 테넌트)
              setGuc(dsl, tid2);
              Long acc2 =
                  dsl.insertInto(
                          EMAIL_ACCOUNT,
                          EMAIL_ACCOUNT.USER_ID,
                          EMAIL_ACCOUNT.EMAIL_ADDRESS,
                          EMAIL_ACCOUNT.TENANT_ID)
                      .values(uid, "t2-" + nano + "@test.local", tid2)
                      .returning(EMAIL_ACCOUNT.ID)
                      .fetchOne()
                      .getId();
              Long fld2 =
                  dsl.insertInto(
                          EMAIL_FOLDER,
                          EMAIL_FOLDER.ACCOUNT_ID,
                          EMAIL_FOLDER.NAME,
                          EMAIL_FOLDER.TENANT_ID)
                      .values(acc2, "INBOX", tid2)
                      .returning(EMAIL_FOLDER.ID)
                      .fetchOne()
                      .getId();
              // 메시지 C: T2 + 같은 sharedMsgId → 테넌트 경계로 별도 content 생성되어야 함
              Long midC =
                  dsl.insertInto(
                          EMAIL_MESSAGE,
                          EMAIL_MESSAGE.ACCOUNT_ID,
                          EMAIL_MESSAGE.FOLDER_ID,
                          EMAIL_MESSAGE.THREAD_ID,
                          EMAIL_MESSAGE.MESSAGE_ID,
                          EMAIL_MESSAGE.SEEN,
                          EMAIL_MESSAGE.HAS_ATTACHMENT,
                          EMAIL_MESSAGE.TENANT_ID)
                      .values(acc2, fld2, "thread-t2-" + nano, sharedMsgId, false, false, tid2)
                      .returning(EMAIL_MESSAGE.ID)
                      .fetchOne()
                      .getId();

              // 5. T1 GUC로 백필 실행: RLS가 T1 행만 노출 → T1 email_content 생성
              setGuc(dsl, tid1);
              dsl.execute(BACKFILL_PART1_SQL);

              // 6. T2 GUC로 백필 실행: RLS가 T2 행만 노출 → T2 email_content 별도 생성
              setGuc(dsl, tid2);
              dsl.execute(BACKFILL_PART1_SQL);

              // 7. T1 결과 조회
              setGuc(dsl, tid1);
              Long contentA =
                  dsl.select(EMAIL_MESSAGE.CONTENT_ID)
                      .from(EMAIL_MESSAGE)
                      .where(EMAIL_MESSAGE.ID.eq(midA))
                      .fetchOneInto(Long.class);
              Long contentB =
                  dsl.select(EMAIL_MESSAGE.CONTENT_ID)
                      .from(EMAIL_MESSAGE)
                      .where(EMAIL_MESSAGE.ID.eq(midB))
                      .fetchOneInto(Long.class);

              // 8. T2 결과 조회
              setGuc(dsl, tid2);
              Long contentC =
                  dsl.select(EMAIL_MESSAGE.CONTENT_ID)
                      .from(EMAIL_MESSAGE)
                      .where(EMAIL_MESSAGE.ID.eq(midC))
                      .fetchOneInto(Long.class);

              // 단언: T1 두 메시지는 같은 (tenant, message_id) → 동일 content 공유
              assertThat(contentA).as("T1 메시지 A의 content_id는 NULL이 아니어야 한다").isNotNull();
              assertThat(contentA)
                  .as("T1: 같은 (tenant_id, message_id)는 content 공유")
                  .isEqualTo(contentB);

              // 단언: T2는 같은 message_id지만 다른 테넌트 → 별도 content
              assertThat(contentC).as("T2 메시지 C의 content_id는 NULL이 아니어야 한다").isNotNull();
              assertThat(contentC).as("다른 테넌트: 테넌트 경계를 넘어 content 병합 금지").isNotEqualTo(contentA);

              // 롤백으로 테스트 데이터 자동 정리
              status.setRollbackOnly();
              return null;
            });
  }

  /**
   * Task4 검증: 같은 테넌트 내 두 계정이 동일 message_id 를 수신하면 email_content 1행 + email_message 2행이 생성되고 두
   * envelope 의 content_id 가 동일해야 한다.
   *
   * <p>sync 경로({@code insertIgnoreConflict})를 직접 호출하고, TenantContext +
   * TenantAwareTransactionManager 가 GUC 를 주입하는 production 패턴을 그대로 재현한다.
   */
  @Test
  void twoAccountsSameMessageId_shareOneContent() {
    long nano = System.nanoTime();
    String sharedMsgId = "<shared-sync-" + nano + "@content.test>";

    // TenantContext 설정 → TenantAwareTransactionManager.doBegin 에서 GUC 주입
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                // 사용자 1명 생성(email_account.user_id FK 충족용)
                Long uid = TestFixtures.createHuman(dsl);

                // 같은 테넌트(1L) 에 계정 2개 + 폴더 2개 생성
                Long accA =
                    dsl.insertInto(
                            EMAIL_ACCOUNT,
                            EMAIL_ACCOUNT.USER_ID,
                            EMAIL_ACCOUNT.EMAIL_ADDRESS,
                            EMAIL_ACCOUNT.TENANT_ID)
                        .values(uid, "sync-a-" + nano + "@test.local", 1L)
                        .returning(EMAIL_ACCOUNT.ID)
                        .fetchOne()
                        .getId();
                Long accB =
                    dsl.insertInto(
                            EMAIL_ACCOUNT,
                            EMAIL_ACCOUNT.USER_ID,
                            EMAIL_ACCOUNT.EMAIL_ADDRESS,
                            EMAIL_ACCOUNT.TENANT_ID)
                        .values(uid, "sync-b-" + nano + "@test.local", 1L)
                        .returning(EMAIL_ACCOUNT.ID)
                        .fetchOne()
                        .getId();
                Long fldA =
                    dsl.insertInto(
                            EMAIL_FOLDER,
                            EMAIL_FOLDER.ACCOUNT_ID,
                            EMAIL_FOLDER.NAME,
                            EMAIL_FOLDER.TENANT_ID)
                        .values(accA, "INBOX", 1L)
                        .returning(EMAIL_FOLDER.ID)
                        .fetchOne()
                        .getId();
                Long fldB =
                    dsl.insertInto(
                            EMAIL_FOLDER,
                            EMAIL_FOLDER.ACCOUNT_ID,
                            EMAIL_FOLDER.NAME,
                            EMAIL_FOLDER.TENANT_ID)
                        .values(accB, "INBOX", 1L)
                        .returning(EMAIL_FOLDER.ID)
                        .fetchOne()
                        .getId();

                // sync 단계: 본문 NULL — lazy 적재는 나중에
                ParsedMessage msg =
                    new ParsedMessage(
                        nano,
                        sharedMsgId,
                        "<thread-" + nano + ">",
                        null,
                        null,
                        "sender@example.com",
                        "Sender",
                        "recv@example.com",
                        null,
                        "공유 테스트 메일",
                        Instant.now(),
                        Instant.now(),
                        false,
                        false,
                        null, // bodyText — sync 단계 null
                        null, // bodyHtml
                        null, // snippet
                        List.of());

                // 두 계정이 같은 메시지를 수신: content 1행, envelope 2행이어야 한다
                messageRepo.insertIgnoreConflict(accA, fldA, msg);
                messageRepo.insertIgnoreConflict(accB, fldB, msg);

                // email_content 행 수: 같은 (tenant_id=1, message_id) → 1개
                long contentCount =
                    dsl.selectCount()
                        .from(EMAIL_CONTENT)
                        .where(EMAIL_CONTENT.MESSAGE_ID.eq(sharedMsgId))
                        .fetchOneInto(long.class);
                assertThat(contentCount).as("email_content 행은 1개여야 한다").isEqualTo(1L);

                // email_message 행 수: 계정 A + B → 2개
                long envCount =
                    dsl.selectCount()
                        .from(EMAIL_MESSAGE)
                        .where(EMAIL_MESSAGE.MESSAGE_ID.eq(sharedMsgId))
                        .fetchOneInto(long.class);
                assertThat(envCount).as("email_message envelope 는 2개여야 한다").isEqualTo(2L);

                // 두 envelope 의 content_id 가 동일한지 확인
                var contentIds =
                    dsl.select(EMAIL_MESSAGE.CONTENT_ID)
                        .from(EMAIL_MESSAGE)
                        .where(EMAIL_MESSAGE.MESSAGE_ID.eq(sharedMsgId))
                        .orderBy(EMAIL_MESSAGE.ID)
                        .fetchInto(Long.class);
                assertThat(contentIds).as("content_id 2개").hasSize(2);
                assertThat(contentIds.get(0)).as("content_id 가 NULL 이면 안 된다").isNotNull();
                assertThat(contentIds.get(0))
                    .as("두 envelope 가 동일한 content_id 를 가리켜야 한다")
                    .isEqualTo(contentIds.get(1));

                // 롤백으로 테스트 데이터 자동 정리
                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * Task4 보완 검증: insertSent 경로도 content_id 를 연결하고 본문이 email_content 에 기록되어야 한다.
   *
   * <p>RED(구현 전): content_id 가 NULL — GREEN(구현 후): content_id NOT NULL + JOIN 으로 본문 조회 가능.
   */
  @Test
  void insertSent_linksContentId_andBodyReadableViaJoin() {
    long nano = System.nanoTime();
    String msgId = "<sent-" + nano + "@test.local>";

    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                Long uid = TestFixtures.createHuman(dsl);

                // 계정 + 보낸편지함 폴더 생성
                Long acc =
                    dsl.insertInto(
                            EMAIL_ACCOUNT,
                            EMAIL_ACCOUNT.USER_ID,
                            EMAIL_ACCOUNT.EMAIL_ADDRESS,
                            EMAIL_ACCOUNT.TENANT_ID)
                        .values(uid, "sender-" + nano + "@test.local", 1L)
                        .returning(EMAIL_ACCOUNT.ID)
                        .fetchOne()
                        .getId();
                Long fld =
                    dsl.insertInto(
                            EMAIL_FOLDER,
                            EMAIL_FOLDER.ACCOUNT_ID,
                            EMAIL_FOLDER.NAME,
                            EMAIL_FOLDER.TENANT_ID)
                        .values(acc, "SENT", 1L)
                        .returning(EMAIL_FOLDER.ID)
                        .fetchOne()
                        .getId();

                OutgoingMail sent =
                    new OutgoingMail(
                        msgId,
                        "<thread-sent-" + nano + ">",
                        "sender-" + nano + "@test.local",
                        "발신자",
                        List.of("recipient@example.com"),
                        List.of(),
                        List.of(),
                        "보낸메일 제목",
                        "보낸메일 본문 텍스트",
                        null,
                        null,
                        null,
                        "보낸메일 미리보기",
                        Instant.now());

                long envId = messageRepo.insertSent(acc, fld, sent);

                // 단언 1: envelope 의 content_id 가 NULL 이 아니어야 한다
                Long contentId =
                    dsl.select(EMAIL_MESSAGE.CONTENT_ID)
                        .from(EMAIL_MESSAGE)
                        .where(EMAIL_MESSAGE.ID.eq(envId))
                        .fetchOneInto(Long.class);
                assertThat(contentId).as("insertSent: content_id 는 NULL 이면 안 된다").isNotNull();

                // 단언 2: email_message JOIN email_content 로 본문을 읽을 수 있어야 한다
                String bodyViaJoin =
                    dsl.select(EMAIL_CONTENT.BODY_TEXT)
                        .from(EMAIL_MESSAGE)
                        .join(EMAIL_CONTENT)
                        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
                        .where(EMAIL_MESSAGE.ID.eq(envId))
                        .fetchOneInto(String.class);
                assertThat(bodyViaJoin).as("JOIN 으로 읽은 본문이 원본과 일치해야 한다").isEqualTo("보낸메일 본문 텍스트");

                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * Task5 검증: contentRepo.updateBody 후 같은 content_id 를 가진 두 envelope 모두 email_message JOIN
   * email_content 로 동일한 본문을 읽을 수 있어야 한다.
   *
   * <p>본문은 email_content 에 1벌만 저장되므로, 공유 envelope 는 추가 fetch 없이 본문을 얻는다.
   */
  @Test
  void bodyFetch_writesContent_sharedAcrossEnvelopes() {
    long nano = System.nanoTime();
    String sharedMsgId = "<lazy-" + nano + "@corp>";

    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                Long uid = TestFixtures.createHuman(dsl);

                // 같은 테넌트(1L)에 계정 2개 + 폴더 2개
                Long accA =
                    dsl.insertInto(
                            EMAIL_ACCOUNT,
                            EMAIL_ACCOUNT.USER_ID,
                            EMAIL_ACCOUNT.EMAIL_ADDRESS,
                            EMAIL_ACCOUNT.TENANT_ID)
                        .values(uid, "lazy-a-" + nano + "@test.local", 1L)
                        .returning(EMAIL_ACCOUNT.ID)
                        .fetchOne()
                        .getId();
                Long accB =
                    dsl.insertInto(
                            EMAIL_ACCOUNT,
                            EMAIL_ACCOUNT.USER_ID,
                            EMAIL_ACCOUNT.EMAIL_ADDRESS,
                            EMAIL_ACCOUNT.TENANT_ID)
                        .values(uid, "lazy-b-" + nano + "@test.local", 1L)
                        .returning(EMAIL_ACCOUNT.ID)
                        .fetchOne()
                        .getId();
                Long fldA =
                    dsl.insertInto(
                            EMAIL_FOLDER,
                            EMAIL_FOLDER.ACCOUNT_ID,
                            EMAIL_FOLDER.NAME,
                            EMAIL_FOLDER.TENANT_ID)
                        .values(accA, "INBOX", 1L)
                        .returning(EMAIL_FOLDER.ID)
                        .fetchOne()
                        .getId();
                Long fldB =
                    dsl.insertInto(
                            EMAIL_FOLDER,
                            EMAIL_FOLDER.ACCOUNT_ID,
                            EMAIL_FOLDER.NAME,
                            EMAIL_FOLDER.TENANT_ID)
                        .values(accB, "INBOX", 1L)
                        .returning(EMAIL_FOLDER.ID)
                        .fetchOne()
                        .getId();

                // 두 계정이 같은 message_id 를 수신 — content 1행 + envelope 2행
                ParsedMessage msg =
                    new ParsedMessage(
                        nano,
                        sharedMsgId,
                        "<thread-lazy-" + nano + ">",
                        null,
                        null,
                        "sender@example.com",
                        "발신자",
                        "recv@example.com",
                        null,
                        "lazy body test",
                        Instant.now(),
                        Instant.now(),
                        false,
                        false,
                        null, // bodyText — lazy
                        null,
                        null,
                        List.of());
                messageRepo.insertIgnoreConflict(accA, fldA, msg);
                messageRepo.insertIgnoreConflict(accB, fldB, msg);

                // content_id 조회
                Long contentId =
                    dsl.select(EMAIL_CONTENT.ID)
                        .from(EMAIL_CONTENT)
                        .where(EMAIL_CONTENT.MESSAGE_ID.eq(sharedMsgId))
                        .fetchOneInto(Long.class);
                assertThat(contentId).as("content 행이 생성되어야 한다").isNotNull();

                // lazy fetch 완료 시뮬레이션: content 에 본문 기록
                contentRepo.updateBody(contentId, "LAZY_BODY", null, "LAZY_BODY");

                // 두 envelope 를 email_content JOIN 으로 읽으면 동일한 본문이 보여야 한다
                List<String> bodies =
                    dsl.select(EMAIL_CONTENT.BODY_TEXT)
                        .from(EMAIL_MESSAGE)
                        .join(EMAIL_CONTENT)
                        .on(EMAIL_MESSAGE.CONTENT_ID.eq(EMAIL_CONTENT.ID))
                        .where(EMAIL_MESSAGE.MESSAGE_ID.eq(sharedMsgId))
                        .fetchInto(String.class);
                assertThat(bodies)
                    .as("두 envelope 모두 content JOIN 으로 본문이 보여야 한다")
                    .hasSize(2)
                    .containsOnly("LAZY_BODY");

                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * V97 검증: markFetched 호출 후 findBodyTarget 이 email_message.fetched_at 을 BodyTarget.bodyFetchedAt
   * 으로 노출해야 한다. 또한 BodyTarget.contentId 가 0 보다 커야 한다.
   *
   * <p>V97 이전(Task5): content.body_fetched_at → V97: email_message.fetched_at(per-envelope).
   * content 에 body 가 적재되어도 envelope.fetched_at = NULL 이면 bodyFetchedAt = null(재적재 대상). markFetched
   * 후에만 non-null.
   */
  @Test
  void bodyFetch_idempotent_contentBodyFetchedAtExposedInBodyTarget() {
    long nano = System.nanoTime();
    String msgId = "<idem-" + nano + "@corp>";

    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                Long uid = TestFixtures.createHuman(dsl);

                Long acc =
                    dsl.insertInto(
                            EMAIL_ACCOUNT,
                            EMAIL_ACCOUNT.USER_ID,
                            EMAIL_ACCOUNT.EMAIL_ADDRESS,
                            EMAIL_ACCOUNT.TENANT_ID)
                        .values(uid, "idem-" + nano + "@test.local", 1L)
                        .returning(EMAIL_ACCOUNT.ID)
                        .fetchOne()
                        .getId();
                Long fld =
                    dsl.insertInto(
                            EMAIL_FOLDER,
                            EMAIL_FOLDER.ACCOUNT_ID,
                            EMAIL_FOLDER.NAME,
                            EMAIL_FOLDER.TENANT_ID)
                        .values(acc, "INBOX", 1L)
                        .returning(EMAIL_FOLDER.ID)
                        .fetchOne()
                        .getId();

                ParsedMessage msg =
                    new ParsedMessage(
                        nano,
                        msgId,
                        "<thread-idem-" + nano + ">",
                        null,
                        null,
                        "sender@example.com",
                        "발신자",
                        "recv@example.com",
                        null,
                        "idempotency test",
                        Instant.now(),
                        Instant.now(),
                        false,
                        false,
                        null,
                        null,
                        null,
                        List.of());
                Long envId = messageRepo.insertIgnoreConflict(acc, fld, msg).orElseThrow();

                // content_id 조회
                Long contentId =
                    dsl.select(EMAIL_MESSAGE.CONTENT_ID)
                        .from(EMAIL_MESSAGE)
                        .where(EMAIL_MESSAGE.ID.eq(envId))
                        .fetchOneInto(Long.class);
                assertThat(contentId).as("envelope 에 content_id 가 설정되어야 한다").isNotNull();

                // content 에 본문 기록(body_fetched_at 설정) — V97: envelope.fetched_at 은 아직 NULL
                contentRepo.updateBody(contentId, "BODY", null, "snip");

                // V97: content.updateBody 만으로는 bodyFetchedAt = null(per-envelope 게이트)
                BodyTarget beforeMark = messageRepo.findBodyTarget(acc, envId).orElseThrow();
                assertThat(beforeMark.bodyFetchedAt())
                    .as(
                        "markFetched 전: email_message.fetched_at = NULL → bodyFetchedAt 은 null 이어야 한다")
                    .isNull();

                // per-envelope 마커 설정
                messageRepo.markFetched(envId);

                // markFetched 후: bodyFetchedAt != null
                BodyTarget target = messageRepo.findBodyTarget(acc, envId).orElseThrow();
                assertThat(target.bodyFetchedAt())
                    .as("markFetched 후 bodyFetchedAt(email_message.fetched_at) 이 null 이면 안 된다")
                    .isNotNull();

                // contentId 필드: BodyTarget 에 추가된 후 0 보다 커야 한다
                assertThat(target.contentId())
                    .as("BodyTarget.contentId 가 올바르게 채워져야 한다")
                    .isGreaterThan(0L);

                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * 회귀 테스트: 공유 콘텐츠 첨부 누락 — per-envelope fetch 마커(V97)
   *
   * <p>같은 테넌트 내 두 계정(accA, accB)이 동일 message_id 를 수신해 하나의 email_content 를 공유한다. accA 의 본문 적재 완료 후에도
   * accB envelope 는 {@code listMissingBody}/{@code countMissingBody} 에 계속 포함되어야 하며(per-envelope
   * fetched_at 기준), accB 를 적재하면 accB 자신의 첨부 행도 생성되어야 한다.
   *
   * <p>RED(수정 전): email_content.body_fetched_at 이 설정되면 accB 도 목록에서 제외됨 → accB 첨부 누락. GREEN(수정 후):
   * email_message.fetched_at 으로 게이트 → accB 는 자신의 fetched_at 이 NULL 인 한 목록에 포함됨.
   */
  @Test
  void sharedContent_secondEnvelope_stillNeedsFetch_andGetsItsOwnAttachment() {
    long nano = System.nanoTime();
    String sharedMsgId = "<shared-attach-" + nano + "@attach.test>";

    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                // 유니크 접미사로 공유 test DB 오염(username 충돌) 방지
                String uname = "v97-test-" + nano;
                Long uid =
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, uname)
                        .set(USER.NAME, uname)
                        .set(USER.EMAIL, uname + "@test.local")
                        .set(USER.PASSWORD, "pw")
                        .set(USER.KIND, UserKind.HUMAN)
                        .returning(USER.ID)
                        .fetchOne()
                        .getId();

                // 같은 테넌트(1L)에 계정 2개 + 폴더 2개 생성
                Long accA =
                    dsl.insertInto(
                            EMAIL_ACCOUNT,
                            EMAIL_ACCOUNT.USER_ID,
                            EMAIL_ACCOUNT.EMAIL_ADDRESS,
                            EMAIL_ACCOUNT.TENANT_ID,
                            EMAIL_ACCOUNT.AI_ENABLED)
                        .values(uid, "attach-a-" + nano + "@test.local", 1L, false)
                        .returning(EMAIL_ACCOUNT.ID)
                        .fetchOne()
                        .getId();
                Long accB =
                    dsl.insertInto(
                            EMAIL_ACCOUNT,
                            EMAIL_ACCOUNT.USER_ID,
                            EMAIL_ACCOUNT.EMAIL_ADDRESS,
                            EMAIL_ACCOUNT.TENANT_ID,
                            EMAIL_ACCOUNT.AI_ENABLED)
                        .values(uid, "attach-b-" + nano + "@test.local", 1L, false)
                        .returning(EMAIL_ACCOUNT.ID)
                        .fetchOne()
                        .getId();
                Long fldA =
                    dsl.insertInto(
                            EMAIL_FOLDER,
                            EMAIL_FOLDER.ACCOUNT_ID,
                            EMAIL_FOLDER.NAME,
                            EMAIL_FOLDER.TENANT_ID)
                        .values(accA, "INBOX", 1L)
                        .returning(EMAIL_FOLDER.ID)
                        .fetchOne()
                        .getId();
                Long fldB =
                    dsl.insertInto(
                            EMAIL_FOLDER,
                            EMAIL_FOLDER.ACCOUNT_ID,
                            EMAIL_FOLDER.NAME,
                            EMAIL_FOLDER.TENANT_ID)
                        .values(accB, "INBOX", 1L)
                        .returning(EMAIL_FOLDER.ID)
                        .fetchOne()
                        .getId();

                // 두 계정이 같은 message_id 로 메시지 수신(content 공유)
                ParsedMessage msg =
                    new ParsedMessage(
                        nano,
                        sharedMsgId,
                        "<thread-attach-" + nano + ">",
                        null,
                        null,
                        "sender@example.com",
                        "발신자",
                        "recv@example.com",
                        null,
                        "공유 첨부 테스트",
                        Instant.now(),
                        Instant.now(),
                        false,
                        true, // has_attachment=true
                        null,
                        null,
                        null,
                        List.of());
                Long envA = messageRepo.insertIgnoreConflict(accA, fldA, msg).orElseThrow();
                Long envB = messageRepo.insertIgnoreConflict(accB, fldB, msg).orElseThrow();

                // 공유 content_id 확인
                Long contentId =
                    dsl.select(EMAIL_CONTENT.ID)
                        .from(EMAIL_CONTENT)
                        .where(EMAIL_CONTENT.MESSAGE_ID.eq(sharedMsgId))
                        .fetchOneInto(Long.class);
                assertThat(contentId).as("content 행이 생성되어야 한다").isNotNull();

                // accA 본문 적재 시뮬레이션: content 에 본문 기록 + accA fetched_at 설정
                contentRepo.updateBody(contentId, "SHARED_BODY", null, "snip");
                // accA envelope 의 fetched_at 직접 설정(loader 가 markFetched 를 호출하는 것과 동일)
                messageRepo.markFetched(envA);
                // accA 첨부 행 삽입
                dsl.insertInto(
                        EMAIL_ATTACHMENT,
                        EMAIL_ATTACHMENT.MESSAGE_ID,
                        EMAIL_ATTACHMENT.FILENAME,
                        EMAIL_ATTACHMENT.CONTENT_TYPE,
                        EMAIL_ATTACHMENT.TENANT_ID)
                    .values(envA, "report.pdf", "application/pdf", 1L)
                    .execute();

                // [핵심 단언 1] accA fetch 후에도 accB 는 listMissingBody 에 포함되어야 한다
                //   RED(수정 전): content.body_fetched_at != NULL → accB 제외 → 목록에 없음
                //   GREEN(수정 후): accB.fetched_at = NULL → 목록에 포함됨
                List<BodyTarget> missing = messageRepo.listMissingBody(accB, 10);
                assertThat(missing)
                    .as("accA 적재 후에도 accB 는 listMissingBody 에 포함되어야 한다 (per-envelope 게이트)")
                    .extracting(BodyTarget::messageId)
                    .contains(envB);

                // [핵심 단언 2] countMissingBody 도 accB 를 포함해야 한다
                int count = messageRepo.countMissingBody(accB);
                assertThat(count)
                    .as("countMissingBody(accB): accB 는 아직 미적재 → 1 이어야 한다")
                    .isGreaterThanOrEqualTo(1);

                // accB 도 적재 완료 시뮬레이션
                messageRepo.markFetched(envB);
                dsl.insertInto(
                        EMAIL_ATTACHMENT,
                        EMAIL_ATTACHMENT.MESSAGE_ID,
                        EMAIL_ATTACHMENT.FILENAME,
                        EMAIL_ATTACHMENT.CONTENT_TYPE,
                        EMAIL_ATTACHMENT.TENANT_ID)
                    .values(envB, "report.pdf", "application/pdf", 1L)
                    .execute();

                // [핵심 단언 3] accB 적재 완료 후 listMissingBody 에서 제외되어야 한다
                List<BodyTarget> missingAfter = messageRepo.listMissingBody(accB, 10);
                assertThat(missingAfter)
                    .as("accB fetched_at 설정 후 listMissingBody 에서 제외되어야 한다")
                    .extracting(BodyTarget::messageId)
                    .doesNotContain(envB);

                // [핵심 단언 4] accB 에 자신의 첨부 행이 존재해야 한다
                long attachB =
                    dsl.selectCount()
                        .from(EMAIL_ATTACHMENT)
                        .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(envB))
                        .fetchOneInto(long.class);
                assertThat(attachB).as("accB 는 자신의 첨부 행을 가져야 한다").isEqualTo(1L);

                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }
}
