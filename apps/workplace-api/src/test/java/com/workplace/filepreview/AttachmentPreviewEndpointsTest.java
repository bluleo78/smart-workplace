package com.workplace.filepreview;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_PREVIEW;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageAttachmentService;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.file.storage.FileStore;
import com.workplace.filepreview.outbound.ConvertOutcome;
import com.workplace.filepreview.outbound.ConverterClient;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.service.HomeAttachmentService;
import com.workplace.home.service.HomeSessionService;
import com.workplace.issue.service.IssueAttachmentService;
import com.workplace.issue.service.IssueDriveLinkService;
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
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 첨부·드라이브 링크·메인 AI 첨부의 문서 미리보기 엔드포인트(WP-1457) — 각 콘텐츠 경로 옆 {@code GET …/preview} 가 {@code /content}
 * 와 같은 권한으로 file id 를 풀어 드라이브 미리보기와 같은 응답 계약({@link PreviewResponses})을 내는지 본다.
 *
 * <p>클래스 트랜잭션으로 돌려 MockMvc 요청이 테스트 트랜잭션에 합류한다. 그래서 선점 행이 커밋되지 않아 대화형 실행기 작업은 리스 갱신(UPDATE)에서 행을 못
 * 보고 그친다 — 여기서는 202 까지만 본다(변환·200 은 DriveFilePreviewTest 가 본다). 변환 서비스는 켜 둔다(DriveFilePreviewTest 와
 * 같은 컨텍스트 키).
 */
@Transactional
@TestPropertySource(properties = "workplace.converter.enabled=true")
class AttachmentPreviewEndpointsTest extends ExternalClientMockedTestBase {

  private static final long T = 1L;
  private static final String DOCX =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  private static final String XLSX =
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  private static final String PPTX =
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  private static final byte[] BYTES = "PK fake office".getBytes(StandardCharsets.UTF_8);

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ChatFixtures fx;
  @Autowired FileStore fileStore;
  @Autowired IssueAttachmentService issueAttachmentService;
  @Autowired IssueDriveLinkService issueDriveLinkService;
  @Autowired HomeSessionService homeSessionService;
  @Autowired HomeAttachmentService homeAttachmentService;
  @Autowired ChatThreadService chatThreadService;
  @Autowired ChatMessageService chatMessageService;
  @Autowired ChatMessageAttachmentService chatAttachmentService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired MessageAttachmentService messageAttachmentService;
  @Autowired ConverterClient converter;

  @BeforeEach
  void setUp() {
    TenantContext.set(T);
    // 실행기 작업이 만에 하나 변환까지 가도 실패로 굳지 않게 성공을 돌려준다(보통은 리스 갱신에서 그친다).
    when(converter.convertPdf(any(), anyString()))
        .thenReturn(new ConvertOutcome.Success("%PDF-1.7".getBytes(StandardCharsets.UTF_8), 1));
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  // ── 출처마다 DOCX 는 변환 중(202) ─────────────────────────

  /** 7개 경로 모두 DOCX 첫 열람(start=true)이 변환을 선점해 202 CONVERTING 을 내고 file_preview 행이 생긴다. */
  @Test
  void docx_출처마다_202_CONVERTING() throws Exception {
    var s = fx.setup();
    member(s.reporterId());

    // 이슈 첨부
    long issueFile = issueUpload(s, "보고서.docx", DOCX);
    expectConverting(issueAttachmentUrl(s, issueFile), s.reporterId(), issueFile);

    // 이슈 드라이브 링크
    long issueDf = driveFile(s.reporterId(), "링크.docx", DOCX);
    issueDriveLinkService.add(s.reporterId(), s.projectKey(), s.issueNumber(), issueDf);
    expectConverting(
        "/api/v1/projects/"
            + s.projectKey()
            + "/issues/"
            + s.issueNumber()
            + "/drive-links/"
            + issueDf
            + "/preview",
        s.reporterId(),
        coreFileId(issueDf));

    // 이슈챗 메시지 첨부
    long threadId = thread(s);
    long chatFile = chatUpload(s.reporterId(), threadId, "대화.docx", DOCX);
    long chatMsg = chatMessage(s.reporterId(), threadId, List.of(chatFile), List.of());
    expectConverting(chatAttachmentUrl(threadId, chatMsg, chatFile), s.reporterId(), chatFile);

    // 이슈챗 메시지 드라이브 링크
    long chatDf = driveFile(s.reporterId(), "대화링크.docx", DOCX);
    long chatLinkMsg = chatMessage(s.reporterId(), threadId, List.of(), List.of(chatDf));
    expectConverting(
        "/api/v1/chat/threads/"
            + threadId
            + "/messages/"
            + chatLinkMsg
            + "/drive-links/"
            + chatDf
            + "/preview",
        s.reporterId(),
        coreFileId(chatDf));

    // 팀 채팅 메시지 첨부
    long owner = user();
    long ch = channel(owner);
    long msgFile = channelUpload(owner, ch, "채널.docx", DOCX);
    long msg = channelMessage(owner, ch, List.of(msgFile), List.of());
    expectConverting(channelAttachmentUrl(ch, msg, msgFile), owner, msgFile);

    // 팀 채팅 메시지 드라이브 링크
    long chDf = driveFile(owner, "채널링크.docx", DOCX);
    long linkMsg = channelMessage(owner, ch, List.of(), List.of(chDf));
    expectConverting(
        "/api/v1/messaging/channels/"
            + ch
            + "/messages/"
            + linkMsg
            + "/drive-links/"
            + chDf
            + "/preview",
        owner,
        coreFileId(chDf));

    // 메인 AI 첨부
    UUID sid = homeSessionService.create(owner).id();
    long homeFile =
        homeAttachmentService.upload(owner, List.of(file("홈.docx", DOCX))).get(0).fileId();
    homeAttachmentService.appendUserMessage(owner, sid, "봐 줘", List.of(homeFile));
    expectConverting(
        "/api/v1/home/sessions/" + sid + "/attachments/" + homeFile + "/preview", owner, homeFile);
  }

  /** HWP·PPTX 도 이슈 첨부 경로에서 202 — DOCX 만이 아니라 변환 대상 표 전체가 같은 경로를 탄다. */
  @Test
  void hwp_pptx_도_202() throws Exception {
    var s = fx.setup();
    member(s.reporterId());
    long hwp = issueUpload(s, "문서.hwp", "application/x-hwp");
    long pptx = issueUpload(s, "발표.pptx", PPTX);

    expectConverting(issueAttachmentUrl(s, hwp), s.reporterId(), hwp);
    expectConverting(issueAttachmentUrl(s, pptx), s.reporterId(), pptx);
  }

  /** XLSX 는 웹 시트 표로 보므로 변환 대상이 아니다 — 404 NOT_APPLICABLE, 변환기·행 없음. */
  @Test
  void xlsx_는_404_NOT_APPLICABLE() throws Exception {
    var s = fx.setup();
    member(s.reporterId());
    long issueFile = issueUpload(s, "표.xlsx", XLSX);
    long owner = user();
    long ch = channel(owner);
    long msgFile = channelUpload(owner, ch, "표.xlsx", XLSX);
    long msg = channelMessage(owner, ch, List.of(msgFile), List.of());

    preview(issueAttachmentUrl(s, issueFile), s.reporterId())
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.status").value("NOT_APPLICABLE"));
    preview(channelAttachmentUrl(ch, msg, msgFile), owner)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.status").value("NOT_APPLICABLE"));
    verifyNoInteractions(converter);
    assertThat(previewRowExists(issueFile)).isFalse();
    assertThat(previewRowExists(msgFile)).isFalse();
  }

  /** octet-stream 으로 저장된 대문자 확장자 DOCX(팀 채팅은 브라우저 mime 원문 저장)도 확장자 폴백으로 202. */
  @Test
  void octet_stream_대문자_확장자_docx_도_202() throws Exception {
    long owner = user();
    long ch = channel(owner);
    long msgFile = channelUpload(owner, ch, "보고서.DOCX", "application/octet-stream");
    long msg = channelMessage(owner, ch, List.of(msgFile), List.of());

    expectConverting(channelAttachmentUrl(ch, msg, msgFile), owner, msgFile);
  }

  // ── 권한: /content 와 같은 상태로 거절 ─────────────────────

  /** 볼 수 없는 사용자는 출처마다 /content 와 같은 4xx 로 막히고, 변환기를 부르지 않으며 행도 생기지 않는다. */
  @Test
  void 볼_수_없는_사용자는_content_와_같은_상태로_거절() throws Exception {
    var s = fx.setup();
    member(s.reporterId());
    member(s.outsiderId());

    // 이슈 첨부 — 프로젝트 비멤버
    long issueFile = issueUpload(s, "보고서.docx", DOCX);
    assertSameRejection(issueAttachmentUrl(s, issueFile), s.outsiderId());

    // 이슈챗 — 스레드를 읽을 수 없는 사용자
    long threadId = thread(s);
    long chatFile = chatUpload(s.reporterId(), threadId, "대화.docx", DOCX);
    long chatMsg = chatMessage(s.reporterId(), threadId, List.of(chatFile), List.of());
    assertSameRejection(chatAttachmentUrl(threadId, chatMsg, chatFile), s.outsiderId());

    // 팀 채팅 — 채널 비멤버(403)
    long owner = user();
    long stranger = user();
    long ch = channel(owner);
    long msgFile = channelUpload(owner, ch, "채널.docx", DOCX);
    long msg = channelMessage(owner, ch, List.of(msgFile), List.of());
    assertThat(assertSameRejection(channelAttachmentUrl(ch, msg, msgFile), stranger))
        .isEqualTo(403);

    // 메인 AI — 남의 세션(404)
    UUID sid = homeSessionService.create(owner).id();
    long homeFile =
        homeAttachmentService.upload(owner, List.of(file("홈.docx", DOCX))).get(0).fileId();
    homeAttachmentService.appendUserMessage(owner, sid, "봐 줘", List.of(homeFile));
    assertThat(
            assertSameRejection(
                "/api/v1/home/sessions/" + sid + "/attachments/" + homeFile + "/preview", stranger))
        .isEqualTo(404);

    verify(converter, never()).convertPdf(any(), anyString());
    assertThat(
            dsl.fetchCount(
                FILE_PREVIEW, FILE_PREVIEW.FILE_ID.in(issueFile, chatFile, msgFile, homeFile)))
        .isZero();
  }

  /** 삭제된 이슈챗 메시지의 첨부는 /content 와 같은 4xx — 지운 메시지의 파일을 미리보기로 되살리지 않는다. */
  @Test
  void 삭제된_메시지의_첨부는_content_와_같은_상태() throws Exception {
    var s = fx.setup();
    member(s.reporterId());
    long threadId = thread(s);
    long chatFile = chatUpload(s.reporterId(), threadId, "대화.docx", DOCX);
    long chatMsg = chatMessage(s.reporterId(), threadId, List.of(chatFile), List.of());
    chatMessageService.delete(s.reporterId(), chatMsg);

    assertSameRejection(chatAttachmentUrl(threadId, chatMsg, chatFile), s.reporterId());
    verify(converter, never()).convertPdf(any(), anyString());
    assertThat(previewRowExists(chatFile)).isFalse();
  }

  /** 다른 메시지의 msgId 로 바꿔 부르면 /content 와 같은 4xx — 메시지 단위 가드가 살아 있다. */
  @Test
  void 다른_메시지의_fileId_는_거절() throws Exception {
    var s = fx.setup();
    member(s.reporterId());
    long threadId = thread(s);
    long chatFile = chatUpload(s.reporterId(), threadId, "대화.docx", DOCX);
    chatMessage(s.reporterId(), threadId, List.of(chatFile), List.of());
    long otherMsg = chatMessage(s.reporterId(), threadId, List.of(), List.of());

    assertSameRejection(chatAttachmentUrl(threadId, otherMsg, chatFile), s.reporterId());
    assertThat(previewRowExists(chatFile)).isFalse();
  }

  /** 원본 blob 이 사라졌으면 NOT_APPLICABLE 이 아닌 예외 봉투 404 — 웹이 「미지원」 대신 오류 화면을 보인다. */
  @Test
  void 원본_blob_이_없으면_예외_봉투_404() throws Exception {
    var s = fx.setup();
    member(s.reporterId());
    long issueFile = issueUpload(s, "보고서.docx", DOCX);
    String storagePath =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(issueFile))
            .fetchOne(FILE.STORAGE_PATH);
    fileStore.deleteWithDerived(storagePath, null);

    preview(issueAttachmentUrl(s, issueFile), s.reporterId())
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.status").value(404));
    verify(converter, never()).convertPdf(any(), anyString());
  }

  // ── 헬퍼 ─────────────────────────────────────────────

  /** start=true 첫 열람이 202 CONVERTING 이고 그 core file id 의 file_preview 행이 생겼는지 본다. */
  private void expectConverting(String url, long uid, long coreFileId) throws Exception {
    preview(url, uid)
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.status").value("CONVERTING"));
    assertThat(previewRowExists(coreFileId)).as(url).isTrue();
  }

  /** /content 와 /preview 를 같은 사용자로 불러 상태 코드가 같고 4xx 인지 보고 그 코드를 돌려준다. */
  private int assertSameRejection(String previewUrl, long uid) throws Exception {
    int contentStatus = statusOf(get(previewUrl.replace("/preview", "/content")), uid);
    int previewStatus = statusOf(get(previewUrl).param("start", "true"), uid);
    assertThat(previewStatus).as(previewUrl).isEqualTo(contentStatus).isBetween(400, 499);
    return previewStatus;
  }

  private ResultActions preview(String url, long uid) throws Exception {
    return http(get(url).param("start", "true").header("Authorization", bearer(uid)));
  }

  private boolean previewRowExists(long coreFileId) {
    return dsl.fetchExists(FILE_PREVIEW, FILE_PREVIEW.FILE_ID.eq(coreFileId));
  }

  private static String issueAttachmentUrl(ChatFixtures.Setup s, long fileId) {
    return "/api/v1/projects/"
        + s.projectKey()
        + "/issues/"
        + s.issueNumber()
        + "/attachments/"
        + fileId
        + "/preview";
  }

  private static String chatAttachmentUrl(long threadId, long msgId, long fileId) {
    return "/api/v1/chat/threads/"
        + threadId
        + "/messages/"
        + msgId
        + "/attachments/"
        + fileId
        + "/preview";
  }

  private static String channelAttachmentUrl(long ch, long msgId, long fileId) {
    return "/api/v1/messaging/channels/"
        + ch
        + "/messages/"
        + msgId
        + "/attachments/"
        + fileId
        + "/preview";
  }

  private static MockMultipartFile file(String name, String mime) {
    return new MockMultipartFile("files", name, mime, BYTES);
  }

  private long issueUpload(ChatFixtures.Setup s, String name, String mime) {
    return issueAttachmentService
        .upload(s.reporterId(), s.projectKey(), s.issueNumber(), List.of(file(name, mime)))
        .get(0)
        .fileId();
  }

  private long thread(ChatFixtures.Setup s) {
    return chatThreadService
        .getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber())
        .threadId();
  }

  private long chatUpload(long uid, long threadId, String name, String mime) throws Exception {
    return chatAttachmentService.upload(uid, threadId, List.of(file(name, mime))).get(0).fileId();
  }

  private long chatMessage(long uid, long threadId, List<Long> fileIds, List<Long> driveFileIds) {
    return chatMessageService
        .create(uid, threadId, new CreateChatMessageRequest("본문", fileIds, driveFileIds))
        .id();
  }

  private long channelUpload(long uid, long ch, String name, String mime) throws Exception {
    return messageAttachmentService.upload(uid, ch, List.of(file(name, mime))).get(0).fileId();
  }

  private long channelMessage(long uid, long ch, List<Long> fileIds, List<Long> driveFileIds) {
    return messageService
        .create(uid, ch, new CreateMessageRequest("x", null, fileIds, driveFileIds))
        .id();
  }

  /** owner 가 가입한 공개 채널. */
  private long channel(long owner) {
    long ch = channelRepo.insertPublic("pv-" + UUID.randomUUID(), owner);
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
  private ResultActions http(MockHttpServletRequestBuilder rb) throws Exception {
    try {
      return mvc.perform(rb);
    } finally {
      TenantContext.set(T);
    }
  }

  /** 사용자 토큰을 붙여 요청하고 상태 코드만 돌려준다. */
  private int statusOf(MockHttpServletRequestBuilder req, long uid) throws Exception {
    return http(req.header("Authorization", bearer(uid))).andReturn().getResponse().getStatus();
  }

  /** 드라이브 파일의 현재 core file id(미리보기 행의 키). */
  private long coreFileId(long driveFileId) {
    return dsl.select(DRIVE_FILE.FILE_ID)
        .from(DRIVE_FILE)
        .where(DRIVE_FILE.ID.eq(driveFileId))
        .fetchOne(DRIVE_FILE.FILE_ID);
  }

  /** owner 가 OWNER 인 팀 공간 + 실제 바이너리가 있는 core file + drive_file. 업로드 경로를 타지 않아 백그라운드 변환이 걸리지 않는다. */
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
    Path tmp = Files.createTempFile("attachment-preview-", ".bin");
    Files.write(tmp, BYTES);
    tmp.toFile().deleteOnExit();
    long file =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, name)
            .set(FILE.STORED_NAME, "x")
            .set(FILE.MIME_TYPE, mime)
            .set(FILE.SIZE_BYTES, (long) BYTES.length)
            .set(FILE.STORAGE_PATH, tmp.toString())
            .set(FILE.UPLOADED_BY, owner)
            .set(FILE.CREATED_AT, OffsetDateTime.now())
            .returning(FILE.ID)
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
}
