package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** WP-186 안 읽은 수 — 분류 버킷·업무(미분류 포함)·회신필요·classificationActive·탭 배지 합계. */
@Transactional
class MailUnreadCountsTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EncryptionService encryption;
  @MockitoBean AssistantResolver assistantResolver;

  @BeforeEach
  void noAssistantByDefault() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    when(assistantResolver.resolvePersonalOrEmpty(org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(Optional.empty());
  }

  // fetched(accountId, folderId, category, seen) — Task 1 의 헬퍼에 seen 인자를 더한 것(seen 이면
  // EMAIL_MESSAGE.SEEN=true 로 갱신)
  private long fetched(long accountId, long folderId, String category, boolean seen) {
    ParsedMessage msg =
        new ParsedMessage(
            System.nanoTime(),
            "m-" + System.nanoTime(),
            "t-" + System.nanoTime(),
            null,
            null,
            "sender@example.com",
            null,
            null,
            null,
            "제목",
            Instant.now(),
            Instant.now(),
            false,
            false,
            null,
            null,
            "스니펫",
            List.of());
    long env = messageRepo.insertIgnoreConflict(accountId, folderId, msg).orElseThrow();
    Long content =
        dsl.select(EMAIL_MESSAGE.CONTENT_ID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(env))
            .fetchOneInto(Long.class);
    contentRepo.updateBody(content, "본문", null, "스니펫");
    TestFixtures.markMailFetched(dsl, env);
    if (category != null) {
      dsl.update(EMAIL_CONTENT)
          .set(EMAIL_CONTENT.AI_CATEGORY, category)
          .where(EMAIL_CONTENT.ID.eq(content))
          .execute();
    }
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.SEEN, seen)
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();
    return env;
  }

  private String token(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  @Test
  void counts_bucketsUnread_workIncludesUncategorized() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "cnt-" + System.nanoTime() + "@test.local");
    fetched(box[1], box[2], "업무", false);
    fetched(box[1], box[2], null, false);
    fetched(box[1], box[2], "개인", false);
    fetched(box[1], box[2], "알림", true); // 읽음 — 세지 않음
    when(assistantResolver.resolveWorkspaceOrEmpty())
        .thenReturn(Optional.of(new AssistantSpec(5L, "m", "NORMAL", 8, 60_000)));

    mvc.perform(
            get("/api/v1/mail/accounts/{a}/unread-counts", box[1])
                .header("Authorization", token(box[0])))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.classificationActive").value(true))
        .andExpect(jsonPath("$.inbox").value(3))
        .andExpect(jsonPath("$.byCategory.업무").value(2))
        .andExpect(jsonPath("$.byCategory.개인").value(1))
        .andExpect(jsonPath("$.byCategory.알림").value(0))
        .andExpect(jsonPath("$.byCategory.프로모션").value(0))
        .andExpect(jsonPath("$.byCategory.뉴스레터").value(0))
        .andExpect(jsonPath("$.needsReply").value(0));
  }

  @Test
  void classificationActive_falseWithoutAnyAssistant_personalNeedsAiEnabled() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "cnt2-" + System.nanoTime() + "@test.local");
    when(assistantResolver.resolvePersonalOrEmpty(box[0]))
        .thenReturn(Optional.of(new AssistantSpec(9L, "m", "NORMAL", 8, 60_000)));

    // 개인 비서는 있지만 계정 AI 꺼짐 → false
    mvc.perform(
            get("/api/v1/mail/accounts/{a}/unread-counts", box[1])
                .header("Authorization", token(box[0])))
        .andExpect(jsonPath("$.classificationActive").value(false));

    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.AI_ENABLED, true)
        .where(EMAIL_ACCOUNT.ID.eq(box[1]))
        .execute();
    mvc.perform(
            get("/api/v1/mail/accounts/{a}/unread-counts", box[1])
                .header("Authorization", token(box[0])))
        .andExpect(jsonPath("$.classificationActive").value(true));
  }

  @Test
  void counts_otherUsersAccount_404() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "cnt3-" + System.nanoTime() + "@test.local");
    long other = TestFixtures.createHuman(dsl);
    mvc.perform(
            get("/api/v1/mail/accounts/{a}/unread-counts", box[1])
                .header("Authorization", token(other)))
        .andExpect(status().isNotFound());
  }

  @Test
  void summary_sumsWorkUnread_acrossAccounts_inactiveCountsInbox() throws Exception {
    long[] a = TestFixtures.seedMailbox(dsl, "sum-a-" + System.nanoTime() + "@test.local");
    fetched(a[1], a[2], "업무", false);
    fetched(a[1], a[2], "개인", false);
    // 같은 사용자의 두 번째 계정 — 분류 비활성이므로 받은편지함 안 읽은 수(2) 전부를 센다
    long b = MailTestSupport.insertAccount(accountRepo, encryption, a[0], false);
    long bInbox = folderRepo.ensureFolder(b, "INBOX").id();
    fetched(b, bInbox, "개인", false);
    fetched(b, bInbox, "알림", false);
    when(assistantResolver.resolvePersonalOrEmpty(a[0]))
        .thenReturn(Optional.of(new AssistantSpec(9L, "m", "NORMAL", 8, 60_000)));
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.AI_ENABLED, true)
        .where(EMAIL_ACCOUNT.ID.eq(a[1]))
        .execute();

    mvc.perform(get("/api/v1/mail/unread-summary").header("Authorization", token(a[0])))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.workUnread").value(1 + 2));
  }

  @Test
  void counts_needsReply_usesSinglePredicate_andUnfetchedCountsAsWork() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "cnt4-" + System.nanoTime() + "@test.local");
    long m = fetched(box[1], box[2], "업무", false);
    MailTestSupport.classify(dsl, m, "업무", true);
    // 미적재(fetched_at null) 개인 분류 흔적 — 검증 전이므로 업무로 센다
    long u = fetched(box[1], box[2], "개인", false);
    dsl.update(EMAIL_MESSAGE)
        .setNull(EMAIL_MESSAGE.FETCHED_AT)
        .where(EMAIL_MESSAGE.ID.eq(u))
        .execute();

    mvc.perform(
            get("/api/v1/mail/accounts/{a}/unread-counts", box[1])
                .header("Authorization", token(box[0])))
        .andExpect(jsonPath("$.needsReply").value(1))
        .andExpect(jsonPath("$.byCategory.업무").value(2))
        .andExpect(jsonPath("$.byCategory.개인").value(0))
        .andExpect(jsonPath("$.inbox").value(2));
  }

  @Test
  void summary_excludesDisabledAccounts() throws Exception {
    long[] a = TestFixtures.seedMailbox(dsl, "sum-d-" + System.nanoTime() + "@test.local");
    fetched(a[1], a[2], "업무", false);
    long b = MailTestSupport.insertAccount(accountRepo, encryption, a[0], false);
    long bInbox = folderRepo.ensureFolder(b, "INBOX").id();
    fetched(b, bInbox, "개인", false);
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.DISABLED_AT, java.time.OffsetDateTime.now())
        .where(EMAIL_ACCOUNT.ID.eq(b))
        .execute();

    // a 는 분류 꺼짐(비서 없음) → 받은편지함 안 읽은 수 1, 비활성 b 는 제외
    mvc.perform(get("/api/v1/mail/unread-summary").header("Authorization", token(a[0])))
        .andExpect(jsonPath("$.workUnread").value(1));
  }

  /** WP-210 홈 요약 분류 활성 — 메일 화면과 같은 판정. 공통 비서만 있으면 개인 비서 사용을 꺼도 true, 비서가 없으면 스위치를 켜도 false. */
  @Test
  void homeSummary_classificationActive_matchesMailView() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "home-" + System.nanoTime() + "@test.local");
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .where(EMAIL_ACCOUNT.ID.eq(box[1]))
        .execute();

    // 비서 없음 + 스위치 꺼짐 → false
    mvc.perform(get("/api/v1/me/mail-summary").header("Authorization", token(box[0])))
        .andExpect(jsonPath("$.classificationActive").value(false));

    // 비서 없음 + 스위치 켜짐 → 분류가 돌지 않으므로 false
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.AI_ENABLED, true)
        .where(EMAIL_ACCOUNT.ID.eq(box[1]))
        .execute();
    mvc.perform(get("/api/v1/me/mail-summary").header("Authorization", token(box[0])))
        .andExpect(jsonPath("$.classificationActive").value(false));

    // 공통 비서 있음 + 스위치 꺼짐 → 공통 비서가 분류·회신필요를 판정하므로 true
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .where(EMAIL_ACCOUNT.ID.eq(box[1]))
        .execute();
    when(assistantResolver.resolveWorkspaceOrEmpty())
        .thenReturn(Optional.of(new AssistantSpec(5L, "m", "NORMAL", 8, 60_000)));
    mvc.perform(get("/api/v1/me/mail-summary").header("Authorization", token(box[0])))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.classificationActive").value(true));
  }

  @Test
  void counts_legacyCategory_notInAnyBucket_butInInbox() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "cnt5-" + System.nanoTime() + "@test.local");
    fetched(box[1], box[2], "업무", false);
    fetched(box[1], box[2], "스팸", false); // 옛 분류값 — 업무 보기 술어에 안 걸리므로 목록 업무에도 없다

    mvc.perform(
            get("/api/v1/mail/accounts/{a}/unread-counts", box[1])
                .header("Authorization", token(box[0])))
        .andExpect(jsonPath("$.byCategory.업무").value(1))
        .andExpect(jsonPath("$.inbox").value(2));
  }
}
