package com.workplace.chat;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.FILE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import com.workplace.chat.dto.ChatMessageAttachmentResponse;
import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.exception.ChatAttachmentNotFoundException;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.exception.EmptyChatMessageException;
import com.workplace.chat.exception.InvalidChatAttachmentException;
import com.workplace.chat.repository.ChatMessageAttachmentRepository;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageAttachmentService;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.file.service.StagedUploadService;
import com.workplace.file.storage.FileStore;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.nio.file.Files;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * #358: 이슈 채팅 첨부 업로드→바인딩→하이드레이션 통합 검증.
 *
 * <p>비-Tx 통합 테스트 — 서비스가 자체 트랜잭션을 커밋해야 첨부 조회 가능. fixture 데이터는 @AfterEach 에서 cleanupAll() 로 회수.
 *
 * <p>FilePathBuilder 는 TenantContext 를 읽어 경로를 생성하므로 @BeforeEach 에서 테넌트(1) 를 설정하고 @AfterEach 에서
 * 해제한다.
 */
class ChatMessageAttachmentIntegrationTest extends IntegrationTestBase {

  @Autowired ChatMessageService chatMessageService;
  @Autowired ChatMessageAttachmentService attachmentService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatFixtures fx;
  @Autowired DSLContext dsl;
  @Autowired FileStore fileStore;
  @Autowired StagedUploadService stagedUploadService;

  // SSE / ai-agent 외부 호출 차단 — 실제 네트워크 없이 테스트 가능.
  @MockitoBean SseRegistry sseRegistry;
  @MockitoBean AiAgentEventClient aiAgentEventClient;

  /** FilePathBuilder 가 TenantContext 를 필요로 하므로 테스트 실행 전 테넌트(1) 세팅. */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    // file 행이 user.uploaded_by 를 참조하므로 user 삭제 전에 file 먼저 삭제해야 FK 위반 방지.
    // chat_message_attachment 는 file 를 참조하므로 file 삭제 전에 정션 먼저 정리.
    dsl.execute(
        "DELETE FROM chat_message_attachment cma USING file f"
            + " WHERE cma.file_id = f.id AND f.category = 'ATTACHMENT'");
    dsl.execute("DELETE FROM file WHERE category = 'ATTACHMENT'");
    fx.cleanupAll();
    TenantContext.clear();
  }

  /** MockMultipartFile 생성 헬퍼. */
  private MockMultipartFile mockMultipart(String name, String mime, byte[] bytes) {
    return new MockMultipartFile("files", name, mime, bytes);
  }

  @Test
  void 첨부_업로드_후_메시지_생성하면_응답에_첨부가_하이드레이트된다() throws Exception {
    // given: 스레드 + 멤버(reporter) 픽스처 생성.
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    long threadId = thread.threadId();
    long callerId = s.reporterId();

    // 파일 선업로드.
    var uploaded =
        attachmentService.upload(
            callerId, threadId, List.of(mockMultipart("a.txt", "text/plain", "hi".getBytes())));
    assertThat(uploaded).hasSize(1);
    long fileId = uploaded.get(0).fileId();

    // when: fileIds 동봉 메시지 생성.
    var resp =
        chatMessageService.create(
            callerId, threadId, new CreateChatMessageRequest("본문", List.of(fileId), List.of()));

    // then: 응답에 첨부 1건, 파일명 일치.
    assertThat(resp.attachments()).hasSize(1);
    assertThat(resp.attachments().get(0).originalName()).isEqualTo("a.txt");
  }

  /** 스레드를 열고 이미지 하나만 붙인 메시지를 보낸다 — 붙여넣기 전송과 같은 모양(본문 없음). */
  private ChatMessageResponse sendImage(ChatFixtures.Setup s, String name) throws Exception {
    long callerId = s.reporterId();
    long threadId = threadService.getOrCreate(callerId, s.projectKey(), s.issueNumber()).threadId();
    long fileId =
        attachmentService
            .upload(callerId, threadId, List.of(mockMultipart(name, "image/png", "png".getBytes())))
            .get(0)
            .fileId();
    return chatMessageService.create(
        callerId, threadId, new CreateChatMessageRequest("", List.of(fileId), List.of()));
  }

  /** 목록에서 id 로 메시지를 찾는다. */
  private static ChatMessageResponse byId(List<ChatMessageResponse> messages, Long id) {
    return messages.stream().filter(m -> id.equals(m.id())).findFirst().orElseThrow();
  }

  /**
   * WP-102: 챗을 다시 열 때 화면은 스레드 응답의 recentMessages 로 첫 목록을 그린다. 여기에 첨부가 빠지면 보냈던 이미지가 다시 연 화면에서
   * 사라진다(운영 WPV-8).
   */
  @Test
  void 스레드를_다시_열면_최근_메시지에_첨부가_하이드레이트된다() throws Exception {
    // given: 이미지를 붙여 보낸 메시지.
    ChatFixtures.Setup s = fx.setup();
    var sent = sendImage(s, "shot.png");

    // when: 스레드를 다시 연다.
    var reopened = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    // then: 최근 메시지의 그 메시지에 보낸 첨부가 그대로 실려 있다.
    assertThat(byId(reopened.recentMessages(), sent.id()).attachments())
        .extracting(
            ChatMessageAttachmentResponse::fileId, ChatMessageAttachmentResponse::originalName)
        .containsExactly(tuple(sent.attachments().get(0).fileId(), "shot.png"));
  }

  /** 소프트 삭제라 첨부 행이 남아 있어도, 삭제된 메시지로는 지운 파일 정보를 내려주지 않는다. */
  @Test
  void 삭제된_메시지는_첨부를_내려주지_않는다() throws Exception {
    // given: 이미지를 붙여 보낸 뒤 지운 메시지.
    ChatFixtures.Setup s = fx.setup();
    long callerId = s.reporterId();
    var sent = sendImage(s, "x.png");
    chatMessageService.delete(callerId, sent.id());

    // when: 스레드를 다시 열고, 메시지 목록도 읽는다.
    var recent =
        threadService.getOrCreate(callerId, s.projectKey(), s.issueNumber()).recentMessages();
    var page = chatMessageService.list(callerId, sent.threadId(), null, null, false, 50).items();

    // then: 두 경로 모두 삭제 표시만 있고 첨부는 비어 있다.
    for (var list : List.of(recent, page)) {
      var m = byId(list, sent.id());
      assertThat(m.deleted()).isTrue();
      assertThat(m.attachments()).isEmpty();
    }
  }

  /**
   * WP-681: 삭제된 메시지의 첨부는 내려받기(/content)·텍스트(/text)·보기(/view) 경로로도 열리지 않는다(팀 채팅 WP-366 과 같은 기준). 예전엔
   * 목록에서만 감추고 원본은 그대로 내려받혔다.
   */
  @Test
  void 삭제된_메시지의_첨부는_내려받기_텍스트_경로로도_열리지_않는다() throws Exception {
    ChatFixtures.Setup s = fx.setup();
    long callerId = s.reporterId();
    var sent = sendImage(s, "secret.png");
    long fileId = sent.attachments().get(0).fileId();
    // 지우기 전에는 열린다.
    assertThat(attachmentService.resolveViewFileId(callerId, sent.threadId(), fileId))
        .isEqualTo(fileId);

    chatMessageService.delete(callerId, sent.id());

    assertThatThrownBy(
            () -> attachmentService.download(callerId, sent.threadId(), sent.id(), fileId))
        .isInstanceOf(InvalidChatAttachmentException.class);
    assertThatThrownBy(() -> attachmentService.resolveViewFileId(callerId, sent.threadId(), fileId))
        .isInstanceOf(ChatAttachmentNotFoundException.class);
  }

  @Test
  void 업로드_storage_path_가_상대경로_형식이다() throws Exception {
    // given: 스레드 + 멤버.
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    long threadId = thread.threadId();
    long callerId = s.reporterId();

    // when: 파일 선업로드.
    var uploaded =
        attachmentService.upload(
            callerId, threadId, List.of(mockMultipart("rel.txt", "text/plain", "data".getBytes())));
    long fileId = uploaded.get(0).fileId();

    // then: STORAGE_PATH 가 상대경로(tenant-1/chat/... 형식) 임을 DB 에서 직접 검증.
    String storagePath =
        dsl.select(com.workplace.jooq.tables.File.FILE.STORAGE_PATH)
            .from(com.workplace.jooq.tables.File.FILE)
            .where(com.workplace.jooq.tables.File.FILE.ID.eq(fileId))
            .fetchOne(0, String.class);

    assertThat(storagePath).startsWith("tenant-1/chat/");
    // 절대경로면 "/" 로 시작하므로 상대경로임을 이중 확인
    assertThat(storagePath).doesNotStartWith("/");
  }

  @Test
  void 업로드_후_바인딩하면_다운로드_round_trip_이_성공한다() throws Exception {
    // given: 스레드 + 멤버.
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    long threadId = thread.threadId();
    long callerId = s.reporterId();
    byte[] content = "round-trip-content".getBytes();

    // when: 업로드 후 메시지에 바인딩(스테이징 클레임이 영구로 승격).
    var uploaded =
        attachmentService.upload(
            callerId, threadId, List.of(mockMultipart("rt.txt", "text/plain", content)));
    long fileId = uploaded.get(0).fileId();
    var msg =
        chatMessageService.create(
            callerId, threadId, new CreateChatMessageRequest("body", List.of(fileId), List.of()));
    long messageId = msg.id();

    // then: download() 가 절대경로를 반환하고, 실제 파일 바이트가 일치한다.
    ChatMessageAttachmentRepository.StoredFileRow row =
        attachmentService.download(callerId, threadId, messageId, fileId);

    assertThat(java.nio.file.Path.of(row.path()).isAbsolute())
        .isTrue(); // 절대경로여야 FileSystemResource 가 동작
    byte[] actual = Files.readAllBytes(java.nio.file.Path.of(row.path()));
    assertThat(actual).isEqualTo(content);
  }

  /**
   * WP-423: 이미 영구가 된 파일(이슈 첨부 등)의 id 로는 챗 메시지를 만들 수 없다 — 400 이고 메시지도 남지 않는다(바인딩 실패가 메시지 생성 트랜잭션을
   * 되돌린다).
   */
  @Test
  void 영구_파일_id_로_메시지를_만들면_400_메시지도_생기지_않음() throws Exception {
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    long callerId = s.reporterId();
    long fileId =
        attachmentService
            .upload(
                callerId, threadId, List.of(mockMultipart("p.txt", "text/plain", "x".getBytes())))
            .get(0)
            .fileId();
    // 다른 기능에 묶여 영구가 된 파일을 흉내 낸다.
    dsl.update(FILE).setNull(FILE.EXPIRES_AT).where(FILE.ID.eq(fileId)).execute();

    assertThatThrownBy(
            () ->
                chatMessageService.create(
                    callerId,
                    threadId,
                    new CreateChatMessageRequest("본문", List.of(fileId), List.of())))
        .isInstanceOf(InvalidChatAttachmentException.class);

    assertThat(dsl.fetchCount(CHAT_MESSAGE, CHAT_MESSAGE.THREAD_ID.eq(threadId))).isZero();
  }

  /** WP-423: 공용 스테이징 업로드로 올린 파일도 챗 메시지에 묶이고 영구가 된다. */
  @Test
  void 본문_없이_첨부만_보내도_응답_본문은_빈_문자열이다() throws Exception {
    // WP-717: 본문을 생략(null)한 첨부 메시지가 null 본문으로 내려가면 웹 대화 화면이 깨진다 — 웹이 보내는 '' 와 같게 맞춘다.
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    long fileId = stagedUploadService.createText(s.reporterId(), "only.md", "# 메모").fileId();

    var resp =
        chatMessageService.create(
            s.reporterId(),
            threadId,
            new CreateChatMessageRequest(null, List.of(fileId), List.of()));

    assertThat(resp.body()).isEmpty();
    assertThat(resp.attachments()).hasSize(1);
  }

  @Test
  void 스테이징_파일로도_메시지를_만들_수_있다() throws Exception {
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    long callerId = s.reporterId();
    long fileId = stagedUploadService.createText(callerId, "staged.md", "# 메모").fileId();

    var resp =
        chatMessageService.create(
            callerId, threadId, new CreateChatMessageRequest("본문", List.of(fileId), List.of()));

    assertThat(resp.attachments()).hasSize(1);
    assertThat(resp.attachments().get(0).originalName()).isEqualTo("staged.md");
    assertThat(
            dsl.select(FILE.EXPIRES_AT)
                .from(FILE)
                .where(FILE.ID.eq(fileId))
                .fetchOne(FILE.EXPIRES_AT))
        .isNull();
  }

  @Test
  void 본문도_첨부도_없으면_EmptyChatMessageException() {
    // given: 스레드 + 멤버 픽스처.
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    long threadId = thread.threadId();
    long callerId = s.reporterId();

    // when/then: body=null, fileIds 빈 목록 → EmptyChatMessageException(400).
    assertThatThrownBy(
            () ->
                chatMessageService.create(
                    callerId, threadId, new CreateChatMessageRequest(null, List.of(), List.of())))
        .isInstanceOf(EmptyChatMessageException.class);
  }

  @Test
  void 보이지_않는_글자만_있고_첨부가_없으면_EmptyChatMessageException() {
    // WP-777: 제로폭 문자·점자 빈칸만 있는 본문은 공백만 있는 본문처럼 거절한다.
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    long threadId = thread.threadId();
    long callerId = s.reporterId();

    assertThatThrownBy(
            () ->
                chatMessageService.create(
                    callerId,
                    threadId,
                    new CreateChatMessageRequest("\u200B\u2800", List.of(), List.of())))
        .isInstanceOf(EmptyChatMessageException.class);
  }

  @Test
  void 첨부만_있고_본문이_빈문자열이어도_생성된다() throws Exception {
    // ⚠️ 프로덕션 경로는 본문 없는 첨부를 body="" 로 보낸다(프론트 trim).
    //    V82 마이그레이션이 BETWEEN 1 AND 4000 제약을 올바르게 교체했는지 검증한다.
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    long threadId = thread.threadId();
    long callerId = s.reporterId();

    var uploaded =
        attachmentService.upload(
            callerId, threadId, List.of(mockMultipart("b.txt", "text/plain", "x".getBytes())));

    // body="" + 첨부 있음 → 생성 성공, 첨부 하이드레이트 확인.
    var resp =
        chatMessageService.create(
            callerId,
            threadId,
            new CreateChatMessageRequest("", List.of(uploaded.get(0).fileId()), List.of()));
    assertThat(resp.attachments()).hasSize(1);
    assertThat(resp.attachments().get(0).originalName()).isEqualTo("b.txt");
  }

  @Test
  void 비멤버는_업로드_불가() {
    // given: 스레드 + 비멤버(outsider) 픽스처.
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    long threadId = thread.threadId();
    long nonMemberId = s.outsiderId();

    // when/then: thread 비멤버 → ChatThreadNotMemberException(403).
    assertThatThrownBy(
            () ->
                attachmentService.upload(
                    nonMemberId,
                    threadId,
                    List.of(mockMultipart("c.txt", "text/plain", "x".getBytes()))))
        .isInstanceOf(ChatThreadNotMemberException.class);
  }
}
