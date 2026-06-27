package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.tables.EmailContent.EMAIL_CONTENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.SummarizeResult;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 머지 게이트(advisor): 같은 테넌트 두 계정이 동일 메일(공유 content)을 받았을 때, 배치 요약을 두 계정에 구동해도 LLM 요약 호출은 정확히 1회여야
 * 한다(N→1 dedup). + content.ai_summary 채워짐 + 두 수신자가 모두 읽는다.
 *
 * <p>실 entry point({@code summarizeRecentUnreadNow}, 스케줄러가 호출하는 동기 본체)를 구동한다 — repo 직접호출 금지. 외부
 * 경계(LLM 클라이언트·비서 해석)만 mock. non-@Transactional: 서비스가 자체 txTemplate 트랜잭션을 열어 seed 가 커밋돼 보여야 한다.
 */
class MailSummaryDedupIntegrationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired MailSummaryBackfillService backfill;

  @MockitoBean AiAgentMailClient mailClient;
  @MockitoBean AssistantResolver assistantResolver;

  private Long userId, accA, accB, fldA, fldB, contentId, envA, envB;

  @AfterEach
  void cleanup() {
    dsl.execute("SELECT set_config('app.tenant_id', '1', false)");
    // FK 순서: envelope(content_id RESTRICT) → content → folder → account → user
    if (envA != null) dsl.deleteFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ID.eq(envA)).execute();
    if (envB != null) dsl.deleteFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ID.eq(envB)).execute();
    if (contentId != null)
      dsl.deleteFrom(EMAIL_CONTENT).where(EMAIL_CONTENT.ID.eq(contentId)).execute();
    if (fldA != null) dsl.deleteFrom(EMAIL_FOLDER).where(EMAIL_FOLDER.ID.eq(fldA)).execute();
    if (fldB != null) dsl.deleteFrom(EMAIL_FOLDER).where(EMAIL_FOLDER.ID.eq(fldB)).execute();
    if (accA != null) dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(accA)).execute();
    if (accB != null) dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(accB)).execute();
    if (userId != null) dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
    TenantContext.clear();
  }

  private long seedAccount(String addr) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, addr)
        .set(EMAIL_ACCOUNT.TENANT_ID, 1L)
        .set(EMAIL_ACCOUNT.AI_ENABLED, true)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  private long seedFolder(long acc) {
    return dsl.insertInto(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.ACCOUNT_ID, acc)
        .set(EMAIL_FOLDER.NAME, "INBOX")
        .set(EMAIL_FOLDER.TENANT_ID, 1L)
        .returning(EMAIL_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  private long seedEnvelope(long acc, long fld, String thread, String msgId) {
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, acc)
        .set(EMAIL_MESSAGE.FOLDER_ID, fld)
        .set(EMAIL_MESSAGE.THREAD_ID, thread)
        .set(EMAIL_MESSAGE.MESSAGE_ID, msgId)
        .set(EMAIL_MESSAGE.FROM_ADDRESS, "sender@example.com")
        .set(EMAIL_MESSAGE.SEEN, false)
        .set(EMAIL_MESSAGE.HAS_ATTACHMENT, false)
        .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
        .set(EMAIL_MESSAGE.TENANT_ID, 1L)
        .set(EMAIL_MESSAGE.FETCHED_AT, java.time.OffsetDateTime.now()) // 본문 적재 완료 → fetchBody skip
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void sharedContent_batchSummarize_callsLlmOnce_andBothReadIt() {
    long nano = System.nanoTime();
    String t = UUID.randomUUID().toString().substring(0, 8);
    String msgId = "<dedup-" + nano + "@corp>";

    // 비서 해석·LLM 호출 mock
    AssistantSpec spec = new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);
    given(assistantResolver.resolve(any(Long.class))).willReturn(spec);
    given(mailClient.summarize(any())).willReturn(new SummarizeResult("DEDUP 요약"));

    TenantContext.set(1L);
    // seed 는 세션 GUC(autocommit)로 커밋 — 서비스의 별도 트랜잭션에서 보이도록.
    dsl.execute("SELECT set_config('app.tenant_id', '1', false)");
    userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "dedup_" + t)
            .set(USER.NAME, "U" + t)
            .set(USER.EMAIL, t + "@example.com")
            .set(USER.PASSWORD, "pw")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    accA = seedAccount("dedup-a-" + nano + "@test.local");
    accB = seedAccount("dedup-b-" + nano + "@test.local");
    fldA = seedFolder(accA);
    fldB = seedFolder(accB);
    // 공유 content 1행 + 본문 적재(빈본문 가드 통과용)
    contentId =
        dsl.insertInto(EMAIL_CONTENT)
            .set(EMAIL_CONTENT.TENANT_ID, 1L)
            .set(EMAIL_CONTENT.MESSAGE_ID, msgId)
            .set(EMAIL_CONTENT.THREAD_ID, "<dedup-" + nano + ">")
            .returning(EMAIL_CONTENT.ID)
            .fetchOne()
            .getId();
    contentRepo.updateBody(contentId, "공유 본문 텍스트", null, "snip");
    envA = seedEnvelope(accA, fldA, "<thread-a-" + nano + ">", msgId);
    envB = seedEnvelope(accB, fldB, "<thread-b-" + nano + ">", msgId);

    // 배치 요약을 두 계정에 구동(스케줄러가 테넌트별로 하는 것과 동일).
    backfill.summarizeRecentUnreadNow(userId, accA);
    backfill.summarizeRecentUnreadNow(userId, accB);

    // [게이트] LLM 요약 호출은 정확히 1회(N→1). 가드 제거 시 2회로 FAIL.
    verify(mailClient, times(1)).summarize(any());

    // content 에 요약 영속.
    String stored =
        dsl.select(EMAIL_CONTENT.AI_SUMMARY)
            .from(EMAIL_CONTENT)
            .where(EMAIL_CONTENT.ID.eq(contentId))
            .fetchOneInto(String.class);
    assertThat(stored).as("content.ai_summary 가 채워져야 한다").isEqualTo("DEDUP 요약");

    // 두 수신자 모두 content 요약을 읽는다.
    assertThat(messageRepo.findAiContextByIdAndUser(userId, envA).orElseThrow().summary())
        .isEqualTo("DEDUP 요약");
    assertThat(messageRepo.findAiContextByIdAndUser(userId, envB).orElseThrow().summary())
        .isEqualTo("DEDUP 요약");
  }
}
