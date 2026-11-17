package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.hamcrest.Matchers.hasSize;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 휴지통 메일은 다른 화면에서 빠진다(WP-1681) — 안 읽은 휴지통 메일이 있어도 사이드바 안 읽은 수·탭 배지·홈 메일 요약·통합 검색·기본 메일 목록(받은편지함)에
 * 섞이지 않고, {@code folder=TRASH} 목록에서만 보인다. 휴지통 행이 아직 없는 계정의 {@code folder=TRASH} 는 빈 목록이다.
 */
@Transactional
class MailTrashExclusionTest extends ExternalClientMockedTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired AssistantResolver assistantResolver;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    when(assistantResolver.resolvePersonalOrEmpty(org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(Optional.empty());
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 본문까지 받은(fetched) 안 읽은 메일 한 통을 folderId 에 넣는다 → envelope id. */
  private long unreadMail(long accountId, long folderId, String subject) {
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
            subject,
            Instant.now(),
            Instant.now(),
            false,
            false,
            null,
            null,
            "스니펫 " + subject,
            List.of());
    long env = messageRepo.insertIgnoreConflict(accountId, folderId, msg).orElseThrow();
    TestFixtures.markMailFetched(dsl, env);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.SEEN, false)
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORY, "업무")
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(env))
        .and(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .execute();
    return env;
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  @Test
  void trashUnread_notCountedInUnreadOrSummary() throws Exception {
    String word = "zt" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long[] box = TestFixtures.seedMailbox(dsl, "trash-" + System.nanoTime() + "@test.local");
    long user = withMembership(box[0]);
    long trash =
        folderRepo
            .upsertServerFolder(box[1], "Trash", null, "Trash", "TRASH", true, 1, 1, null)
            .orElseThrow();
    long inboxMail = unreadMail(box[1], box[2], "받은 " + word);
    long trashMail = unreadMail(box[1], trash, "지운 " + word);

    // 사이드바 안 읽은 수 — 받은편지함 한 통만
    call(get("/api/v1/mail/accounts/{a}/unread-counts", box[1]), user)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.inbox").value(1));
    // 탭 배지
    call(get("/api/v1/mail/unread-summary"), user)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.workUnread").value(1));
    // 홈 메일 요약
    call(get("/api/v1/me/mail-summary"), user)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.unreadCount").value(1))
        .andExpect(jsonPath("$.recent", hasSize(1)))
        .andExpect(jsonPath("$.recent[0].id").value(inboxMail));
    // 통합 검색
    call(get("/api/v1/search/mail").param("q", word), user)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].id").value(inboxMail));
    // 기본 메일 목록(받은편지함)
    call(get("/api/v1/mail/accounts/{a}/messages", box[1]), user)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(1)))
        .andExpect(jsonPath("$[0].id").value(inboxMail));
    // 휴지통 보기(folder=TRASH)에서만 보인다
    call(get("/api/v1/mail/accounts/{a}/messages", box[1]).param("folder", "TRASH"), user)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(1)))
        .andExpect(jsonPath("$[0].id").value(trashMail));
  }

  @Test
  void trashFolderParam_withoutTrashRow_isEmptyList() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "notrash-" + System.nanoTime() + "@test.local");
    long user = withMembership(box[0]);
    unreadMail(box[1], box[2], "받은 메일");

    call(get("/api/v1/mail/accounts/{a}/messages", box[1]).param("folder", "TRASH"), user)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(0)));
  }
}
