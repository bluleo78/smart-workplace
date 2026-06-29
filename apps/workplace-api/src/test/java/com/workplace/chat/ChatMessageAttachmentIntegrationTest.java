package com.workplace.chat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.exception.EmptyChatMessageException;
import com.workplace.chat.repository.ChatMessageAttachmentRepository;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageAttachmentService;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
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

    // when: 업로드 후 메시지에 바인딩(promoteToPermanent 호출됨).
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
