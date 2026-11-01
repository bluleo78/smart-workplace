package com.workplace.fileai.security;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.FILE_SECURITY_CHECK;
import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.BDDMockito.willReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageAttachmentService;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.fileai.outbound.AiAgentDriveClient;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.service.HomeAttachmentService;
import com.workplace.home.service.HomeSessionService;
import com.workplace.issue.service.IssueAttachmentService;
import com.workplace.issue.service.IssueDriveLinkService;
import com.workplace.jooq.tables.File;
import com.workplace.mail.MailTestPorts;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.service.MailAttachmentService;
import com.workplace.mail.service.MailAttachmentService.AttachmentDownload;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageAttachmentService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 출처별 HTML 보안 점검 조회·요청 엔드포인트(WP-1262) — 각 콘텐츠 경로 옆 {@code GET/POST …/security-check} 가 콘텐츠 경로와 같은
 * 권한으로 file id 를 풀어 {@link FileSecurityCheckService} 를 부르는지 본다.
 *
 * <p>클래스 트랜잭션으로 돌려 MockMvc 요청이 테스트 트랜잭션에 합류한다 — 커밋이 없어 요청 뒤 비동기 점검(afterCommit)이 돌지 않으므로 POST 결과가
 * PENDING 으로 고정된다(점검 자체는 FileSecurityCheckPipelineTest 가 본다).
 */
@Transactional
class SecurityCheckEndpointsTest extends ExternalClientMockedTestBase {

  private static final long T = 1L;
  private static final AssistantSpec SPEC =
      new AssistantSpec(1L, "claude-sonnet-4-6", "NORMAL", 1, 60_000);
  private static final String SCRIPT_HTML = "<html><body><script>alert(1)</script></body></html>";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired AssistantResolver assistantResolver;
  @Autowired ChatFixtures fx;
  @Autowired IssueAttachmentService issueAttachmentService;
  @Autowired IssueDriveLinkService issueDriveLinkService;
  @Autowired HomeSessionService homeSessionService;
  @Autowired HomeAttachmentService homeAttachmentService;
  @Autowired ContentAttachmentRepository contentAttachmentRepo;
  @Autowired ChatThreadService chatThreadService;
  @Autowired ChatMessageService chatMessageService;
  @Autowired ChatMessageAttachmentService chatAttachmentService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired MessageAttachmentService messageAttachmentService;
  @Autowired AiAgentDriveClient driveClient;

  /** 공통 spy(IntegrationTestBase) — 원본 내려받기만 스텁해 IMAP 에 붙지 않는다. */
  @Autowired MailAttachmentService mailAttachmentService;

  @BeforeEach
  void setUp() {
    TenantContext.set(T);
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  // ── 드라이브 ──────────────────────────────────────────

  /** 드라이브 파일: 처음엔 행 없음(status null) → POST 로 PENDING → 다시 GET 이 같은 행을 본다. */
  @Test
  void driveFile_getAndPost_returnsView() throws Exception {
    long owner = user();
    long df = driveFile(owner, "page.html", "text/html");
    String url = "/api/v1/drive/files/" + df + "/security-check";

    http(get(url).header("Authorization", bearer(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").doesNotExist())
        .andExpect(jsonPath("$.reason").doesNotExist())
        .andExpect(jsonPath("$.evidence").isArray());
    http(post(url).header("Authorization", bearer(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"));
    http(get(url).header("Authorization", bearer(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"));
  }

  /** 공간 멤버가 아니면 콘텐츠 경로와 같은 상태 코드로 막히고 행도 만들지 않는다. */
  @Test
  void driveFile_whenNotMember_forbidden() throws Exception {
    long owner = user();
    long stranger = user();
    long df = driveFile(owner, "page.html", "text/html");
    int contentStatus = statusOf(get("/api/v1/drive/files/" + df + "/content"), stranger);
    assertThat(contentStatus).isIn(403, 404);

    String url = "/api/v1/drive/files/" + df + "/security-check";
    assertThat(statusOf(get(url), stranger)).isEqualTo(contentStatus);
    assertThat(statusOf(post(url), stranger)).isEqualTo(contentStatus);
    assertThat(dsl.fetchCount(FILE_SECURITY_CHECK)).isZero();
  }

  /** 워크스페이스에 AI 가 없으면 POST 도 행을 만들지 않고 reason NO_AI. */
  @Test
  void noAi_postReturnsNoAiReason() throws Exception {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    long owner = user();
    long df = driveFile(owner, "page.html", "text/html");

    http(post("/api/v1/drive/files/" + df + "/security-check")
            .header("Authorization", bearer(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").doesNotExist())
        .andExpect(jsonPath("$.reason").value("NO_AI"));
    assertThat(dsl.fetchCount(FILE_SECURITY_CHECK)).isZero();
  }

  // ── 이슈 첨부·이슈 드라이브 링크 ─────────────────────────

  /** 이미 끝난(DONE) 점검 행이 이슈 첨부 경로 GET 에 위험도·근거 그대로 보인다. */
  @Test
  void issueAttachment_getReturnsRowCreatedViaService() throws Exception {
    var s = fx.setup();
    member(s.reporterId());
    long fileId =
        issueAttachmentService
            .upload(
                s.reporterId(),
                s.projectKey(),
                s.issueNumber(),
                List.of(
                    new MockMultipartFile(
                        "files", "a.txt", "text/plain", "x".getBytes(StandardCharsets.UTF_8))))
            .get(0)
            .fileId();
    dsl.insertInto(FILE_SECURITY_CHECK)
        .set(FILE_SECURITY_CHECK.FILE_ID, fileId)
        .set(FILE_SECURITY_CHECK.STATUS, "DONE")
        .set(FILE_SECURITY_CHECK.RISK, "CAUTION")
        .set(FILE_SECURITY_CHECK.HEADLINE, "외부 주소로 요청해요")
        .set(
            FILE_SECURITY_CHECK.EVIDENCE,
            JSONB.valueOf("[{\"kind\":\"EXTERNAL_REQUEST\",\"detail\":\"fetch\"}]"))
        .set(FILE_SECURITY_CHECK.CHECKED_AT, OffsetDateTime.now())
        .execute();

    String url =
        "/api/v1/projects/"
            + s.projectKey()
            + "/issues/"
            + s.issueNumber()
            + "/attachments/"
            + fileId
            + "/security-check";
    http(get(url).header("Authorization", bearer(s.reporterId())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("DONE"))
        .andExpect(jsonPath("$.risk").value("CAUTION"))
        .andExpect(jsonPath("$.headline").value("외부 주소로 요청해요"))
        .andExpect(jsonPath("$.evidence[0].kind").value("EXTERNAL_REQUEST"))
        .andExpect(jsonPath("$.checkedAt").exists());
    // 프로젝트 밖 사용자는 콘텐츠 경로와 같은 상태 코드
    String contentUrl = url.replace("/security-check", "/content");
    member(s.outsiderId());
    assertThat(statusOf(get(url), s.outsiderId()))
        .isEqualTo(statusOf(get(contentUrl), s.outsiderId()))
        .isNotEqualTo(200);
    assertThat(dsl.fetchExists(ISSUE_ATTACHMENT, ISSUE_ATTACHMENT.FILE_ID.eq(fileId))).isTrue();
  }

  /** 이슈에 링크된 드라이브 파일은 이슈 조회 권한만으로(드라이브 공간 멤버가 아니어도) 점검을 보고 요청한다 — 키는 그 파일의 현재 core file id. */
  @Test
  void issueDriveLink_whenLinked_returnsView() throws Exception {
    var s = fx.setup();
    member(s.reporterId());
    member(s.assigneeId());
    long df = driveFile(s.reporterId(), "page.html", "text/html");
    issueDriveLinkService.add(s.reporterId(), s.projectKey(), s.issueNumber(), df);
    String url = linkUrl(s.projectKey(), s.issueNumber(), df);

    // assignee 는 프로젝트 멤버지만 드라이브 공간 멤버는 아니다.
    http(post(url).header("Authorization", bearer(s.assigneeId())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"));
    http(get(url).header("Authorization", bearer(s.assigneeId())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"));
    long coreFileId =
        dsl.select(DRIVE_FILE.FILE_ID)
            .from(DRIVE_FILE)
            .where(DRIVE_FILE.ID.eq(df))
            .fetchOne(0, Long.class);
    assertThat(dsl.fetchExists(FILE_SECURITY_CHECK, FILE_SECURITY_CHECK.FILE_ID.eq(coreFileId)))
        .isTrue();
  }

  /** 이 이슈에 링크되지 않은 드라이브 파일은 콘텐츠 경로와 같은 404. */
  @Test
  void issueDriveLink_whenNotLinked_notFound() throws Exception {
    var s = fx.setup();
    member(s.reporterId());
    long df = driveFile(s.reporterId(), "page.html", "text/html");
    String url = linkUrl(s.projectKey(), s.issueNumber(), df);

    http(get(url).header("Authorization", bearer(s.reporterId()))).andExpect(status().isNotFound());
    http(post(url).header("Authorization", bearer(s.reporterId())))
        .andExpect(status().isNotFound());
    assertThat(dsl.fetchCount(FILE_SECURITY_CHECK)).isZero();
  }

  // ── 홈 ───────────────────────────────────────────────

  /** 다른 사용자의 홈 세션 첨부는 콘텐츠 경로와 같은 404. */
  @Test
  void homeAttachment_whenOtherUsersSession_notFound() throws Exception {
    long ownerId = user();
    long otherId = user();
    UUID sid = homeSessionService.create(ownerId).id();
    long fileId =
        homeAttachmentService
            .upload(
                ownerId,
                List.of(new MockMultipartFile("files", "a.txt", "text/plain", "x".getBytes())))
            .get(0)
            .fileId();
    homeAttachmentService.appendUserMessage(ownerId, sid, "봐 줘", List.of(fileId));
    String url = "/api/v1/home/sessions/" + sid + "/attachments/" + fileId + "/security-check";

    http(get(url).header("Authorization", bearer(ownerId))).andExpect(status().isOk());
    assertThat(statusOf(get(url.replace("/security-check", "/content")), otherId)).isEqualTo(404);
    http(get(url).header("Authorization", bearer(otherId))).andExpect(status().isNotFound());
    http(post(url).header("Authorization", bearer(otherId))).andExpect(status().isNotFound());
  }

  // ── 메일 ─────────────────────────────────────────────

  /**
   * 메일 첨부 POST 는 사본 file 을 만들어 content_attachment 에 잇고 그 id 로 점검 행을 만든다(원본은 한 번만 받는다). GET 이 같은 행.
   */
  @Test
  void mailAttachment_post_createsExtractCopyAndChecks() throws Exception {
    MailSeed m = mailSeed("page.html", "text/html");
    willReturn(
            new AttachmentDownload(
                SCRIPT_HTML.getBytes(StandardCharsets.UTF_8), "page.html", "text/html"))
        .given(mailAttachmentService)
        .download(anyLong(), anyLong());
    String url = "/api/v1/mail/attachments/" + m.attachmentId() + "/security-check";

    http(get(url).header("Authorization", bearer(m.userId())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").doesNotExist());
    assertThat(extractFileId(m.caId())).isNull();

    http(post(url).header("Authorization", bearer(m.userId())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"));
    Long copy = extractFileId(m.caId());
    assertThat(copy).isNotNull();
    assertThat(dsl.fetchExists(FILE_SECURITY_CHECK, FILE_SECURITY_CHECK.FILE_ID.eq(copy))).isTrue();
    verify(mailAttachmentService, times(1)).download(m.userId(), m.attachmentId());

    http(get(url).header("Authorization", bearer(m.userId())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"));
    // 다른 사용자는 /content 와 같은 404(존재 은닉)
    long other = user();
    http(get(url).header("Authorization", bearer(other))).andExpect(status().isNotFound());
    http(post(url).header("Authorization", bearer(other))).andExpect(status().isNotFound());
  }

  /** 살아 있는 사본에 끝난(DONE) 점검이 있으면 POST 는 원본을 다시 받지 않고 그 결과를 돌려준다. */
  @Test
  void mailAttachment_whenAlreadyDone_postDoesNotRefetch() throws Exception {
    MailSeed m = mailSeed("page.html", "text/html");
    willReturn(
            new AttachmentDownload(
                SCRIPT_HTML.getBytes(StandardCharsets.UTF_8), "page.html", "text/html"))
        .given(mailAttachmentService)
        .download(anyLong(), anyLong());
    String url = "/api/v1/mail/attachments/" + m.attachmentId() + "/security-check";
    http(post(url).header("Authorization", bearer(m.userId()))).andExpect(status().isOk());
    long copy = extractFileId(m.caId());
    dsl.update(FILE_SECURITY_CHECK)
        .set(FILE_SECURITY_CHECK.STATUS, "DONE")
        .set(FILE_SECURITY_CHECK.RISK, "LOW")
        .where(FILE_SECURITY_CHECK.FILE_ID.eq(copy))
        .execute();

    http(post(url).header("Authorization", bearer(m.userId())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("DONE"))
        .andExpect(jsonPath("$.risk").value("LOW"));
    verify(mailAttachmentService, times(1)).download(m.userId(), m.attachmentId());
  }

  /** 스크립트 없는 메일 HTML 은 요청 스레드에서 판정해 AI 를 부르지 않고 그 자리에서 SKIPPED 로 적는다(원본 바이트를 실행기 큐에 넘기지 않는다). */
  @Test
  void mailAttachment_whenNoScripts_postSkipsWithoutAgent() throws Exception {
    MailSeed m = mailSeed("plain.html", "text/html");
    willReturn(
            new AttachmentDownload(
                "<html><body><p>안녕</p></body></html>".getBytes(StandardCharsets.UTF_8),
                "plain.html",
                "text/html"))
        .given(mailAttachmentService)
        .download(anyLong(), anyLong());
    String url = "/api/v1/mail/attachments/" + m.attachmentId() + "/security-check";

    http(post(url).header("Authorization", bearer(m.userId())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("SKIPPED"));
    verify(driveClient, never()).securityCheck(any());
  }

  /** AI 가 없으면 메일 요청은 원본을 받지 않고 사본도 만들지 않은 채 NO_AI 로 끝난다. */
  @Test
  void mailAttachment_whenNoAi_postDoesNotFetchOrCopy() throws Exception {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    MailSeed m = mailSeed("page.html", "text/html");
    String url = "/api/v1/mail/attachments/" + m.attachmentId() + "/security-check";

    http(post(url).header("Authorization", bearer(m.userId())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").doesNotExist())
        .andExpect(jsonPath("$.reason").value("NO_AI"));
    assertThat(extractFileId(m.caId())).isNull();
    verify(mailAttachmentService, never()).download(anyLong(), anyLong());
  }

  // ── 챗·팀 채팅 ─────────────────────────────────────────

  /** 챗 메시지 첨부 경로 GET 은 200(행 없음). */
  @Test
  void chatAttachment_get_returnsOk() throws Exception {
    var s = fx.setup();
    member(s.reporterId());
    long threadId =
        chatThreadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    long fileId =
        chatAttachmentService.upload(s.reporterId(), threadId, List.of(txtFile())).get(0).fileId();
    long msgId =
        chatMessageService
            .create(
                s.reporterId(),
                threadId,
                new CreateChatMessageRequest("본문", List.of(fileId), List.of()))
            .id();
    String url =
        "/api/v1/chat/threads/"
            + threadId
            + "/messages/"
            + msgId
            + "/attachments/"
            + fileId
            + "/security-check";

    http(get(url).header("Authorization", bearer(s.reporterId())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.evidence").isArray());
  }

  /** 챗 메시지 드라이브 링크 경로 GET 은 200(행 없음). */
  @Test
  void chatDriveLink_get_returnsOk() throws Exception {
    var s = fx.setup();
    member(s.reporterId());
    long threadId =
        chatThreadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    long df = driveFile(s.reporterId(), "page.html", "text/html");
    long msgId =
        chatMessageService
            .create(
                s.reporterId(), threadId, new CreateChatMessageRequest("", List.of(), List.of(df)))
            .id();
    String url =
        "/api/v1/chat/threads/"
            + threadId
            + "/messages/"
            + msgId
            + "/drive-links/"
            + df
            + "/security-check";

    http(get(url).header("Authorization", bearer(s.reporterId())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.evidence").isArray());
  }

  /** 팀 채팅 메시지 첨부 경로 GET 은 200(행 없음). */
  @Test
  void messageAttachment_get_returnsOk() throws Exception {
    long owner = user();
    long ch = channel(owner);
    long fileId = messageAttachmentService.upload(owner, ch, List.of(txtFile())).get(0).fileId();
    long msgId =
        messageService
            .create(owner, ch, new CreateMessageRequest("x", null, List.of(fileId), List.of()))
            .id();
    String url =
        "/api/v1/messaging/channels/"
            + ch
            + "/messages/"
            + msgId
            + "/attachments/"
            + fileId
            + "/security-check";

    http(get(url).header("Authorization", bearer(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.evidence").isArray());
  }

  /** 팀 채팅 메시지 드라이브 링크 경로 GET 은 200(행 없음). */
  @Test
  void messageDriveLink_get_returnsOk() throws Exception {
    long owner = user();
    long ch = channel(owner);
    long df = driveFile(owner, "page.html", "text/html");
    long msgId =
        messageService
            .create(owner, ch, new CreateMessageRequest("x", null, List.of(), List.of(df)))
            .id();
    String url =
        "/api/v1/messaging/channels/"
            + ch
            + "/messages/"
            + msgId
            + "/drive-links/"
            + df
            + "/security-check";

    http(get(url).header("Authorization", bearer(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.evidence").isArray());
  }

  // ── 헬퍼 ─────────────────────────────────────────────

  /** 점검 행이 생기지 않는 평문 첨부. */
  private static MockMultipartFile txtFile() {
    return new MockMultipartFile(
        "files", "a.txt", "text/plain", "x".getBytes(StandardCharsets.UTF_8));
  }

  /** owner 가 가입한 공개 채널. */
  private long channel(long owner) {
    long ch = channelRepo.insertPublic("sc-" + UUID.randomUUID(), owner);
    channelService.join(owner, ch);
    return ch;
  }

  /** HUMAN 사용자 + tenant#1 ACTIVE 멤버십·USER 역할. */
  private long user() {
    long id = TestFixtures.createHuman(dsl);
    member(id);
    return id;
  }

  /** tenant#1 ACTIVE 멤버십 + 시스템 USER 역할(project:read 등 기본 권한). */
  private void member(long userId) {
    TestFixtures.ensureActiveMember(dsl, userId, T);
    TestFixtures.grantRole(dsl, userId, "USER");
  }

  private String bearer(long uid) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(uid, "u" + uid, T);
  }

  /** MockMvc 요청 — JwtAuthenticationFilter 가 finally 에서 지운 테스트 스레드의 TenantContext 를 되돌린다. */
  private ResultActions http(RequestBuilder rb) throws Exception {
    try {
      return mvc.perform(rb);
    } finally {
      TenantContext.set(T);
    }
  }

  /** 사용자 토큰을 붙여 요청하고 상태 코드만 돌려준다. */
  private int statusOf(
      org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder req, long uid)
      throws Exception {
    MvcResult r = http(req.header("Authorization", bearer(uid))).andReturn();
    return r.getResponse().getStatus();
  }

  private static String linkUrl(String key, int number, long df) {
    return "/api/v1/projects/"
        + key
        + "/issues/"
        + number
        + "/drive-links/"
        + df
        + "/security-check";
  }

  /** owner 가 OWNER 인 팀 공간 + 실제 바이너리가 있는 core file + drive_file. 업로드 경로를 타지 않아 자동 점검 행이 생기지 않는다. */
  private long driveFile(long owner, String name, String mime) throws Exception {
    long space =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "S")
            .set(DRIVE_SPACE.OWNER_ID, owner)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, space)
        .set(DRIVE_SPACE_MEMBER.USER_ID, owner)
        .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
        .execute();
    Path tmp = Files.createTempFile("security-check-", ".html");
    Files.writeString(tmp, SCRIPT_HTML);
    tmp.toFile().deleteOnExit();
    var f = File.FILE;
    long file =
        dsl.insertInto(f)
            .set(f.ORIGINAL_NAME, name)
            .set(f.STORED_NAME, "x")
            .set(f.MIME_TYPE, mime)
            .set(f.SIZE_BYTES, (long) SCRIPT_HTML.length())
            .set(f.STORAGE_PATH, tmp.toString())
            .set(f.UPLOADED_BY, owner)
            .set(f.CREATED_AT, OffsetDateTime.now())
            .returning(f.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, space)
        .set(DRIVE_FILE.FILE_ID, file)
        .set(DRIVE_FILE.NAME, name)
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }

  private record MailSeed(long userId, long attachmentId, long caId) {}

  /** 사용자 1명의 메일 계정·폴더·메시지·첨부 + 공유 manifest(content_attachment). MailAttachmentTextTest 와 같은 시드. */
  private MailSeed mailSeed(String filename, String mime) {
    long userId = user();
    long nano = System.nanoTime();
    long acc =
        dsl.insertInto(EMAIL_ACCOUNT)
            .set(EMAIL_ACCOUNT.USER_ID, userId)
            .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "sc-" + nano + "@test.local")
            .set(EMAIL_ACCOUNT.IMAP_HOST, "127.0.0.1")
            .set(EMAIL_ACCOUNT.IMAP_PORT, MailTestPorts.IMAP)
            .set(EMAIL_ACCOUNT.IMAP_SECURITY, "NONE")
            .set(EMAIL_ACCOUNT.IMAP_USERNAME, "sc-" + nano + "@test.local")
            .set(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD, "x")
            .set(EMAIL_ACCOUNT.AI_ENABLED, false)
            .set(EMAIL_ACCOUNT.TENANT_ID, T)
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();
    long fld =
        dsl.insertInto(EMAIL_FOLDER)
            .set(EMAIL_FOLDER.ACCOUNT_ID, acc)
            .set(EMAIL_FOLDER.NAME, "INBOX")
            .set(EMAIL_FOLDER.TENANT_ID, T)
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    String msgId = "<sc-" + nano + "@test.local>";
    long contentId =
        dsl.insertInto(EMAIL_CONTENT)
            .set(EMAIL_CONTENT.MESSAGE_ID, msgId)
            .set(EMAIL_CONTENT.THREAD_ID, msgId)
            .set(EMAIL_CONTENT.TENANT_ID, T)
            .returning(EMAIL_CONTENT.ID)
            .fetchOne()
            .getId();
    long caId = contentAttachmentRepo.findOrCreate(contentId, 0, filename, mime, 100L, null);
    long messageId =
        dsl.insertInto(EMAIL_MESSAGE)
            .set(EMAIL_MESSAGE.ACCOUNT_ID, acc)
            .set(EMAIL_MESSAGE.FOLDER_ID, fld)
            .set(EMAIL_MESSAGE.MESSAGE_ID, msgId)
            .set(EMAIL_MESSAGE.THREAD_ID, msgId)
            .set(EMAIL_MESSAGE.IMAP_UID, 100L)
            .set(EMAIL_MESSAGE.SEEN, false)
            .set(EMAIL_MESSAGE.HAS_ATTACHMENT, true)
            .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
            .set(EMAIL_MESSAGE.TENANT_ID, T)
            .returning(EMAIL_MESSAGE.ID)
            .fetchOne()
            .getId();
    long attId =
        dsl.insertInto(EMAIL_ATTACHMENT)
            .set(EMAIL_ATTACHMENT.MESSAGE_ID, messageId)
            .set(EMAIL_ATTACHMENT.ORDINAL, 0)
            .set(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID, caId)
            .set(EMAIL_ATTACHMENT.TENANT_ID, T)
            .returning(EMAIL_ATTACHMENT.ID)
            .fetchOne()
            .getId();
    return new MailSeed(userId, attId, caId);
  }

  private Long extractFileId(long caId) {
    return dsl.select(CONTENT_ATTACHMENT.EXTRACT_FILE_ID)
        .from(CONTENT_ATTACHMENT)
        .where(CONTENT_ATTACHMENT.ID.eq(caId))
        .fetchOne(CONTENT_ATTACHMENT.EXTRACT_FILE_ID);
  }
}
