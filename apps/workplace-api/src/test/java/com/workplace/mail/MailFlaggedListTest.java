package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
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
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
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
 * WP-1742 별표한 메일 모아 보기 — {@code GET /messages?flagged=true} 가 계정의 모든 메일함(받은편지함·보관·사용자 메일함)의 별표 메일을
 * 최신순으로 한 목록에 모으고(원래 메일함 이름 folderName·id folderId·역할 folderRole 포함), 휴지통·별표 아닌 메일은 빼며, 커서·안
 * 읽음·검색어를 함께 적용하는지. 사이드바 unread-counts.flagged 가 같은 범위의 수인지.
 */
@Transactional
class MailFlaggedListTest extends ExternalClientMockedTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired AssistantResolver assistantResolver;

  /** 시각 기준점 — 메일마다 서로 다른 수신 시각을 주어 정렬·커서 검증이 흔들리지 않게 한다. */
  private static final Instant BASE = Instant.parse("2026-11-01T00:00:00Z");

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

  /** 본문까지 받은 메일 한 통을 folderId 에 넣고 별표·읽음·수신 시각(BASE + minutes 분)을 정한다 → envelope id. */
  private long mail(
      long accountId, long folderId, String subject, boolean flagged, boolean seen, int minutes) {
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
            BASE,
            BASE,
            false,
            false,
            null,
            null,
            "스니펫 " + subject,
            List.of());
    long env = messageRepo.insertIgnoreConflict(accountId, folderId, msg).orElseThrow();
    TestFixtures.markMailFetched(dsl, env);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.FLAGGED, flagged)
        .set(EMAIL_MESSAGE.SEEN, seen)
        .set(EMAIL_MESSAGE.RECEIVED_AT, BASE.plusSeconds(60L * minutes).atOffset(ZoneOffset.UTC))
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();
    return env;
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  /**
   * 받은편지함 + 보관(서버 이름 Archive) + 사용자 메일함(프로젝트) + 휴지통을 가진 계정. [user, account, inbox, archive, user,
   * trash].
   */
  private long[] mailboxWithFolders(String prefix) {
    long[] box = TestFixtures.seedMailbox(dsl, prefix + "-" + System.nanoTime() + "@test.local");
    long user = withMembership(box[0]);
    long archive =
        folderRepo
            .upsertServerFolder(box[1], "Archive", null, "Archive", "ARCHIVE", true, 0, 0, null)
            .orElseThrow();
    long project =
        folderRepo
            .upsertServerFolder(box[1], "INBOX/프로젝트", null, "프로젝트", "USER", true, 0, 0, null)
            .orElseThrow();
    long trash =
        folderRepo
            .upsertServerFolder(box[1], "Trash", null, "Trash", "TRASH", true, 0, 0, null)
            .orElseThrow();
    return new long[] {user, box[1], box[2], archive, project, trash};
  }

  @Test
  void flagged_collectsAllMailboxesNewestFirst_withFolderName_excludesTrashAndUnflagged()
      throws Exception {
    long[] b = mailboxWithFolders("flag");
    long inboxFlag = mail(b[1], b[2], "받은 별표", true, true, 10);
    long archiveFlag = mail(b[1], b[3], "보관 별표", true, false, 30);
    long projectFlag = mail(b[1], b[4], "프로젝트 별표", true, true, 20);
    mail(b[1], b[5], "휴지통 별표", true, false, 40); // 휴지통 — 빠진다
    mail(b[1], b[2], "받은 일반", false, false, 50); // 별표 아님 — 빠진다

    call(get("/api/v1/mail/accounts/{a}/messages", b[1]).param("flagged", "true"), b[0])
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(3)))
        .andExpect(jsonPath("$[0].id").value(archiveFlag))
        .andExpect(jsonPath("$[0].folderName").value("보관"))
        .andExpect(jsonPath("$[0].flagged").value(true))
        .andExpect(jsonPath("$[1].id").value(projectFlag))
        .andExpect(jsonPath("$[1].folderName").value("프로젝트"))
        .andExpect(jsonPath("$[2].id").value(inboxFlag))
        .andExpect(jsonPath("$[2].folderName").value("받은편지함"))
        // 화면 판정용 원래 메일함 id·역할 — 받은편지함은 저장된 역할이 없어도 INBOX 로 채운다.
        .andExpect(jsonPath("$[0].folderId").value(b[3]))
        .andExpect(jsonPath("$[0].folderRole").value("ARCHIVE"))
        .andExpect(jsonPath("$[1].folderId").value(b[4]))
        .andExpect(jsonPath("$[1].folderRole").value("USER"))
        .andExpect(jsonPath("$[2].folderId").value(b[2]))
        .andExpect(jsonPath("$[2].folderRole").value("INBOX"));

    // 일반 목록은 그대로 — folderName·folderId·folderRole 은 채우지 않아도 된다(null), 별표 아닌 메일도 보인다.
    call(get("/api/v1/mail/accounts/{a}/messages", b[1]), b[0])
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(2)))
        .andExpect(jsonPath("$[0].folderName").value(nullValue()))
        .andExpect(jsonPath("$[0].folderId").value(nullValue()))
        .andExpect(jsonPath("$[0].folderRole").value(nullValue()));
  }

  /**
   * WP-1742 보낸 메일 — 앱 발송 기록(로컬 SENT 메일함)과 서버 보낸편지함 사본 모두 역할 SENT·이름 「보낸편지함」. 앱 기록은 서버 메일함이 아니라
   * folderId 가 null, 서버 보낸편지함은 그 메일함 id.
   */
  @Test
  void flagged_sentRows_roleSent_appRecordHasNoFolderId() throws Exception {
    long[] b = mailboxWithFolders("flag-sent");
    long appSentFolder = folderRepo.ensureFolder(b[1], EmailFolderRepository.LOCAL_SENT).id();
    long serverSentFolder =
        folderRepo.ensureServerSentFolder(b[1], "Sent Items").orElseThrow().id();
    long appSent = mail(b[1], appSentFolder, "앱 보낸 별표", true, true, 20);
    long serverSent = mail(b[1], serverSentFolder, "서버 보낸 별표", true, true, 10);

    call(get("/api/v1/mail/accounts/{a}/messages", b[1]).param("flagged", "true"), b[0])
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(2)))
        .andExpect(jsonPath("$[0].id").value(appSent))
        .andExpect(jsonPath("$[0].folderName").value("보낸편지함"))
        .andExpect(jsonPath("$[0].folderRole").value("SENT"))
        .andExpect(jsonPath("$[0].folderId").value(nullValue()))
        .andExpect(jsonPath("$[1].id").value(serverSent))
        .andExpect(jsonPath("$[1].folderName").value("보낸편지함"))
        .andExpect(jsonPath("$[1].folderRole").value("SENT"))
        .andExpect(jsonPath("$[1].folderId").value(serverSentFolder));
  }

  @Test
  void flagged_ignoresFolderAndCategoryParams() throws Exception {
    long[] b = mailboxWithFolders("flag-ign");
    long archiveFlag = mail(b[1], b[3], "보관 별표", true, true, 10);
    mail(b[1], b[2], "받은 일반", false, true, 20);

    // folder·folderId·category·needsReply 는 무시하고 별표 모아 보기로 답한다.
    call(
            get("/api/v1/mail/accounts/{a}/messages", b[1])
                .param("flagged", "true")
                .param("folder", "TRASH")
                .param("folderId", String.valueOf(b[2]))
                .param("category", "업무")
                .param("needsReply", "true"),
            b[0])
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(1)))
        .andExpect(jsonPath("$[0].id").value(archiveFlag));
  }

  @Test
  void flagged_cursorPaging() throws Exception {
    long[] b = mailboxWithFolders("flag-page");
    long newest = mail(b[1], b[3], "셋", true, true, 30);
    long middle = mail(b[1], b[2], "둘", true, true, 20);
    long oldest = mail(b[1], b[4], "하나", true, true, 10);

    call(
            get("/api/v1/mail/accounts/{a}/messages", b[1])
                .param("flagged", "true")
                .param("limit", "2"),
            b[0])
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(2)))
        .andExpect(jsonPath("$[0].id").value(newest))
        .andExpect(jsonPath("$[1].id").value(middle));

    call(
            get("/api/v1/mail/accounts/{a}/messages", b[1])
                .param("flagged", "true")
                .param("limit", "2")
                .param("beforeAt", BASE.plusSeconds(60L * 20).toString())
                .param("beforeId", String.valueOf(middle)),
            b[0])
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(1)))
        .andExpect(jsonPath("$[0].id").value(oldest))
        .andExpect(jsonPath("$[0].folderName").value("프로젝트"));
  }

  @Test
  void flagged_withUnreadAndQuery() throws Exception {
    long[] b = mailboxWithFolders("flag-unread");
    mail(b[1], b[2], "읽은 별표", true, true, 10);
    long unreadFlag = mail(b[1], b[3], "안읽은 별표 zq-alpha", true, false, 20);
    long unreadFlag2 = mail(b[1], b[4], "안읽은 별표 둘", true, false, 30);
    mail(b[1], b[2], "안읽은 일반", false, false, 40);

    call(
            get("/api/v1/mail/accounts/{a}/messages", b[1])
                .param("flagged", "true")
                .param("unread", "true"),
            b[0])
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(2)))
        .andExpect(jsonPath("$[0].id").value(unreadFlag2))
        .andExpect(jsonPath("$[1].id").value(unreadFlag));

    // 검색어도 함께 적용된다(검증된 사본이 아니라도 제목 부분 일치는 찾는다 — 여기선 fetched 라 FTS·보낸 사람 규칙)
    call(
            get("/api/v1/mail/accounts/{a}/messages", b[1])
                .param("flagged", "true")
                .param("query", "sender@example"),
            b[0])
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(3)));
  }

  @Test
  void flagged_otherUsersAccount_404() throws Exception {
    long[] b = mailboxWithFolders("flag-own");
    mail(b[1], b[2], "남의 별표", true, true, 10);
    long[] other = TestFixtures.seedMailbox(dsl, "flag-other-" + System.nanoTime() + "@test.local");
    long stranger = withMembership(other[0]);

    call(get("/api/v1/mail/accounts/{a}/messages", b[1]).param("flagged", "true"), stranger)
        .andExpect(status().isNotFound());
  }

  @Test
  void unreadCounts_flagged_countsSameScopeRegardlessOfSeen() throws Exception {
    long[] b = mailboxWithFolders("flag-cnt");
    mail(b[1], b[2], "받은 별표 읽음", true, true, 10);
    mail(b[1], b[3], "보관 별표 안읽음", true, false, 20);
    mail(b[1], b[4], "프로젝트 별표", true, true, 30);
    mail(b[1], b[5], "휴지통 별표", true, false, 40); // 휴지통 — 세지 않음
    mail(b[1], b[2], "일반", false, false, 50); // 별표 아님 — 세지 않음

    call(get("/api/v1/mail/accounts/{a}/unread-counts", b[1]), b[0])
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.flagged").value(3))
        .andExpect(jsonPath("$.inbox").value(1));
  }
}
