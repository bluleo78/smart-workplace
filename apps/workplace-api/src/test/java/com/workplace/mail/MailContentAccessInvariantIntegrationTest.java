package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * §3 접근 불변식 회귀 가드: 공유 email_content 는 반드시 envelope(email_message) 소유 조인을 통해서만 접근 가능해야 한다.
 *
 * <p>핵심 불변식 — 같은 테넌트 내 사용자 B는 사용자 A 전용 envelope 를 통해 A의 email_content 본문("SECRET")을 절대 읽을 수 없어야 한다.
 *
 * <p>테스트가 "이빨"을 갖는 이유: findDetailByIdAndUser·findAiContextByIdAndUser 가 EMAIL_ACCOUNT.USER_ID 소유
 * 조건을 제거하면 음성 단언(negative assertion)이 즉시 실패한다. 양성 대조(positive control)는 시딩 오류로 인한 vacuous pass 를
 * 방지한다.
 */
class MailContentAccessInvariantIntegrationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;

  /**
   * 테스트용 envelope 시드 헬퍼.
   *
   * <p>신규 사용자와 계정을 생성하고, 지정된 contentId 를 가리키는 email_message envelope 를 삽입한다. 반환값 = [userId,
   * accountId, envelopeId].
   */
  private long[] seedEnvelopeForUser(long tenantId, long contentId, String msgId) {
    long nano = System.nanoTime();
    long uid = TestFixtures.createHuman(dsl);
    Long accId =
        dsl.insertInto(
                EMAIL_ACCOUNT,
                EMAIL_ACCOUNT.USER_ID,
                EMAIL_ACCOUNT.EMAIL_ADDRESS,
                EMAIL_ACCOUNT.TENANT_ID,
                EMAIL_ACCOUNT.AI_ENABLED)
            .values(uid, "invariant-" + nano + "@test.local", tenantId, true)
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
                "<thread-invar-" + nano + ">",
                msgId,
                "sender@example.com",
                false,
                false,
                contentId,
                tenantId)
            .returning(EMAIL_MESSAGE.ID)
            .fetchOne()
            .getId();
    return new long[] {uid, accId, envId};
  }

  /**
   * §3 FTS 검색 불변식:
   *
   * <ul>
   *   <li>양성 대조: 계정 A는 본문에 "needle-xyzzy" 가 있는 메일을 query="xyzzy" 로 검색하면 결과를 반환받는다.
   *   <li>음성 대조: 계정 B는 같은 테넌트이지만 해당 content 의 envelope 를 보유하지 않으므로 결과가 비어야 한다.
   * </ul>
   *
   * <p>teeth: listByAccount 검색 분기에서 EMAIL_MESSAGE.ACCOUNT_ID 필터를 제거하면 음성 단언이 FAIL 된다.
   */
  @Test
  void search_onlyReturnsOwnedMail_andSearchesBody() {
    long nano = System.nanoTime();
    String msgIdA = "<srch-" + nano + "@corp>";

    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                // 1. content 에 "needle-xyzzy" 본문 삽입
                ParsedMessage pm =
                    new ParsedMessage(
                        nano,
                        msgIdA,
                        "<thread-srch-" + nano + ">",
                        null,
                        null,
                        "sender@search.test",
                        "Sender",
                        "recv@search.test",
                        null,
                        "Search Test Subject",
                        Instant.now(),
                        Instant.now(),
                        false,
                        false,
                        null,
                        null,
                        null,
                        List.of());
                long contentId = contentRepo.findOrCreate(1L, pm);
                // 본문에 식별 단어 "needle-xyzzy" 삽입 — FTS 가 이를 색인해야 검색에 걸린다
                contentRepo.updateBody(contentId, "needle-xyzzy in body", null, "snip");

                // 2. 계정 A 전용 envelope 생성
                long[] seedA = seedEnvelopeForUser(1L, contentId, msgIdA);
                long accA = seedA[1];

                // 3. 계정 B 전용 envelope 생성(A 의 content 와 무관한 별도 content)
                String msgIdB = "<srch-b-" + nano + "@corp>";
                ParsedMessage pmB =
                    new ParsedMessage(
                        nano + 1,
                        msgIdB,
                        "<thread-srch-b-" + nano + ">",
                        null,
                        null,
                        "other@search.test",
                        "Other",
                        "recv-b@search.test",
                        null,
                        "Unrelated",
                        Instant.now(),
                        Instant.now(),
                        false,
                        false,
                        null,
                        null,
                        null,
                        List.of());
                long contentIdB = contentRepo.findOrCreate(1L, pmB);
                contentRepo.updateBody(contentIdB, "completely unrelated content", null, "other");
                long[] seedB = seedEnvelopeForUser(1L, contentIdB, msgIdB);
                long accB = seedB[1];

                // ─────────────────────────────────────────────
                // 양성 대조: A 계정으로 "xyzzy" 검색 → 본문 FTS 로 A 의 메일이 반환돼야 한다
                // ─────────────────────────────────────────────
                var aHits =
                    messageRepo.listByAccount(accA, "INBOX", "xyzzy", false, null, false, 20);
                assertThat(aHits).as("양성 대조: 계정 A는 본문 FTS 로 'xyzzy' 메일을 찾아야 한다").isNotEmpty();

                // ─────────────────────────────────────────────
                // 음성 대조: B 계정으로 "xyzzy" 검색 → B 의 envelope 에 해당 content 가 없으므로 빈 결과
                // listByAccount 에서 ACCOUNT_ID 필터 제거 시 이 단언이 FAIL 된다
                // ─────────────────────────────────────────────
                var bHits =
                    messageRepo.listByAccount(accB, "INBOX", "xyzzy", false, null, false, 20);
                assertThat(bHits)
                    .as("음성 대조: 계정 B는 A 의 'xyzzy' 본문을 검색할 수 없어야 한다(계정 격리 불변식)")
                    .isEmpty();

                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * §3 접근 불변식 핵심 검증:
   *
   * <ul>
   *   <li>양성 대조(positive): 사용자 A는 자신의 envelope 를 통해 "SECRET" 본문을 읽을 수 있다.
   *   <li>음성 대조 1(negative): 사용자 B는 같은 테넌트에서 A의 envelopeId 로 상세 조회 시 빈 결과를 받는다.
   *   <li>음성 대조 2(negative): 사용자 B는 AI 컨텍스트 경로로도 A의 본문에 접근할 수 없다.
   * </ul>
   *
   * <p>teeth: findDetailByIdAndUser 또는 findAiContextByIdAndUser 에서 EMAIL_ACCOUNT.USER_ID 소유 조건이
   * 제거되면 음성 단언이 즉시 실패한다.
   */
  @Test
  void userCannotReadAnotherUsersContent_sameTenant() {
    long nano = System.nanoTime();
    String msgIdA = "<invar-a-" + nano + "@corp>";

    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                // 1. email_content 에 본문 "SECRET" 삽입 (사용자 A가 받는 메일 내용)
                ParsedMessage pm =
                    new ParsedMessage(
                        nano,
                        msgIdA,
                        "<thread-invar-" + nano + ">",
                        null,
                        null,
                        "sender@example.com",
                        "Sender",
                        "recv-a@example.com",
                        null,
                        "SECRET-SUBJECT",
                        Instant.now(),
                        Instant.now(),
                        false,
                        false,
                        null,
                        null,
                        null,
                        List.of());
                long contentId = contentRepo.findOrCreate(1L, pm);
                contentRepo.updateBody(contentId, "SECRET", null, "SECRET-SNIP");

                // 2. 사용자 A의 envelope 생성 (content 를 소유·링크)
                long[] seedA = seedEnvelopeForUser(1L, contentId, msgIdA);
                long userA = seedA[0];
                long envA = seedA[2];

                // 3. 사용자 B 생성 (같은 테넌트, 별도 계정 — A의 envelope 와 무관)
                long[] seedB = seedEnvelopeForUser(1L, contentId, "<invar-b-" + nano + "@corp>");
                long userB = seedB[0];

                // ──────────────────────────────────────────────────
                // 양성 대조: A는 자신의 envA 를 통해 "SECRET" 본문을 읽을 수 있어야 한다.
                // ──────────────────────────────────────────────────
                var detailA = messageRepo.findDetailByIdAndUser(userA, envA);
                assertThat(detailA)
                    .as("양성 대조: 사용자 A는 자신의 envelope 를 통해 상세를 읽을 수 있어야 한다")
                    .isPresent();
                assertThat(detailA.get().bodyText())
                    .as("양성 대조: 본문은 email_content.body_text = 'SECRET' 이어야 한다")
                    .isEqualTo("SECRET");

                var aiCtxA = messageRepo.findAiContextByIdAndUser(userA, envA);
                assertThat(aiCtxA).as("양성 대조: 사용자 A는 AI 컨텍스트 경로로도 본문을 읽을 수 있어야 한다").isPresent();
                assertThat(aiCtxA.get().bodyText())
                    .as("양성 대조: AI 컨텍스트 본문은 'SECRET' 이어야 한다")
                    .isEqualTo("SECRET");

                // ──────────────────────────────────────────────────
                // 음성 대조 1: B가 A의 envId 로 상세 조회 → 빈 결과(소유권 검증 실패)
                // EMAIL_ACCOUNT.USER_ID 조건이 제거되면 이 단언이 FAIL 된다.
                // ──────────────────────────────────────────────────
                var detailB = messageRepo.findDetailByIdAndUser(userB, envA);
                assertThat(detailB)
                    .as(
                        "음성 대조: 사용자 B는 A의 envelope ID 로 상세를 읽을 수 없어야 한다 "
                            + "(findDetailByIdAndUser 소유 조건 회귀 가드)")
                    .isEmpty();

                // ──────────────────────────────────────────────────
                // 음성 대조 2: B가 A의 envId 로 AI 컨텍스트 조회 → 빈 결과
                // EMAIL_ACCOUNT.USER_ID 조건이 제거되면 이 단언이 FAIL 된다.
                // ──────────────────────────────────────────────────
                var aiCtxB = messageRepo.findAiContextByIdAndUser(userB, envA);
                assertThat(aiCtxB)
                    .as(
                        "음성 대조: 사용자 B는 AI 컨텍스트 경로로도 A의 본문에 접근할 수 없어야 한다 "
                            + "(findAiContextByIdAndUser 소유 조건 회귀 가드)")
                    .isEmpty();

                // 롤백으로 테스트 데이터 자동 정리 (공유 DB 오염 방지)
                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }
}
