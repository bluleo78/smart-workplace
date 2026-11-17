package com.workplace.chat;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.HOME_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.chat.dto.ChatMessageAttachmentResponse;
import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.chat.exception.ChatAttachmentNotFoundException;
import com.workplace.chat.exception.ChatMessageAuthorMismatchException;
import com.workplace.chat.exception.ChatMessageNotFoundException;
import com.workplace.chat.exception.EmptyChatMessageException;
import com.workplace.chat.exception.InvalidChatAttachmentException;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageUpdatedEvent;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageAttachmentService;
import com.workplace.chat.service.ChatMessageAttachmentSourceProvider;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveLinkService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 챗 메시지 수정에서 첨부 빼기(WP-1680) — {@code UpdateChatMessageRequest.keepFileIds} 로 남길 첨부만 고르면 빠진 첨부의
 * 연결만 지우고, 드라이브·다른 「보이는 첨부」 정션이 쓰지 않는 file 에만 만료를 다시 거는지, 거절 규칙(남의 id·빈 결과·작성자·삭제)과 뺀 파일의 읽기 경로 차단을
 * 검증한다. 채널·DM 의 {@code MessageEditRemoveAttachmentTest}(WP-1679)를 chat 도메인에 미러한 것이다.
 *
 * <p>테넌트#1 트랜잭션 안에서 돌고 롤백된다.
 */
@Transactional
@RecordApplicationEvents
class ChatMessageEditRemoveAttachmentTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ChatFixtures fx;
  @Autowired ChatThreadService threadService;
  @Autowired ChatMessageService chatMessageService;
  @Autowired ChatMessageAttachmentService attachmentService;
  @Autowired ChatMessageAttachmentSourceProvider sourceProvider;
  @Autowired DriveLinkService driveLinkService;
  @Autowired DriveFileService driveFileService;
  @Autowired ApplicationEvents events;

  private long author;
  private long other;
  private long threadId;

  /**
   * FilePathBuilder 가 TenantContext 를 읽으므로 테넌트(1)를 세팅하고, 작성자(reporter)·다른 멤버(assignee)·스레드를 만든다.
   */
  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    ChatFixtures.Setup s = fx.setup();
    author = s.reporterId();
    other = s.assigneeId();
    threadId = threadService.getOrCreate(author, s.projectKey(), s.issueNumber()).threadId();
    // 다른 사람도 같은 스레드를 읽을 수 있어야 한다(프로젝트 멤버라 읽기 가능).
    threadService.getOrCreate(other, s.projectKey(), s.issueNumber());
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ─── 빼기 기본 ─────────────────────────────────────────────

  /** a 만 남기면 b 의 연결이 지워지고, b 에만 만료가 다시 걸리며(file 행은 남음), 수정 이벤트가 남은 첨부 목록을 싣는다. */
  @Test
  void keep_one_removesOther_andRearmsExpiry() throws Exception {
    long a = upload("a.txt");
    long b = upload("b.txt");
    long id = send("보고서", a, b);

    ChatMessageResponse res =
        chatMessageService.update(author, id, new UpdateChatMessageRequest("보고서", List.of(a)));

    assertThat(res.attachments())
        .extracting(ChatMessageAttachmentResponse::fileId)
        .containsExactly(a);
    assertThat(res.editedAt()).isNotNull();
    assertThat(fileExpiresAt(b)).isNotNull(); // 만료 재무장
    assertThat(fileExpiresAt(b)).isAfter(OffsetDateTime.now()); // 즉시 지워지지 않게 미래 시각
    assertThat(fileExpiresAt(a)).isNull(); // 남긴 것은 영구 그대로
    assertThat(fileRowExists(b)).isTrue(); // file 행은 지우지 않는다
    assertThat(attachmentsOf(id)).containsExactly(a);
    var ev = events.stream(ChatMessageUpdatedEvent.class).toList().getLast();
    assertThat(ev.attachments())
        .extracting(ChatMessageAttachmentResponse::fileId)
        .containsExactly(a);
  }

  /** keepFileIds 가 없으면 지금처럼 본문만 고친다 — 첨부 그대로, 이벤트에도 첨부 전체가 실린다. */
  @Test
  void keepFileIds_absent_isTextOnlyEdit() throws Exception {
    long a = upload("a.txt");
    long b = upload("b.txt");
    long id = send("원래", a, b);

    ChatMessageResponse res =
        chatMessageService.update(author, id, new UpdateChatMessageRequest("새 본문"));

    assertThat(res.body()).isEqualTo("새 본문");
    assertThat(res.attachments()).hasSize(2);
    assertThat(fileExpiresAt(a)).isNull();
    assertThat(fileExpiresAt(b)).isNull();
    var ev = events.stream(ChatMessageUpdatedEvent.class).toList().getLast();
    assertThat(ev.attachments()).hasSize(2);
  }

  /** 다른 메시지의 첨부 id 를 남기라고 하면 400 — 아무것도 지우지 않는다. */
  @Test
  void keepFileIds_foreignId_400() throws Exception {
    long a = upload("a.txt");
    long b = upload("b.txt");
    long id = send("본문", a, b);
    long c = upload("c.txt");
    send("다른 글", c);

    assertThatThrownBy(
            () ->
                chatMessageService.update(
                    author, id, new UpdateChatMessageRequest("본문", List.of(a, c))))
        .isInstanceOf(InvalidChatAttachmentException.class)
        .hasMessage("이 메시지에 붙은 첨부가 아닙니다")
        .hasMessage("이 메시지에 붙은 첨부가 아닙니다");
    assertThat(attachmentsOf(id)).containsExactlyInAnyOrder(a, b);
  }

  /** 같은 id 가 여러 번 와도 한 번으로 본다 — 400 이 나거나 연결 삭제가 꼬이지 않는다. */
  @Test
  void keepFileIds_duplicates_areCollapsed() throws Exception {
    long a = upload("a.txt");
    long b = upload("b.txt");
    long id = send("본문", a, b);

    ChatMessageResponse res =
        chatMessageService.update(author, id, new UpdateChatMessageRequest("본문", List.of(a, a)));

    assertThat(res.attachments())
        .extracting(ChatMessageAttachmentResponse::fileId)
        .containsExactly(a);
    assertThat(attachmentsOf(id)).containsExactly(a);
  }

  // ─── 빈 결과 판정 ─────────────────────────────────────────────

  /** 첨부만 있던 메시지에서 본문도 비우고 첨부도 모두 빼면 400. */
  @Test
  void emptyBody_and_emptyKeep_400() throws Exception {
    long a = upload("a.txt");
    long id = send(null, a);

    assertThatThrownBy(
            () ->
                chatMessageService.update(author, id, new UpdateChatMessageRequest("", List.of())))
        .isInstanceOf(EmptyChatMessageException.class);
    assertThat(attachmentsOf(id)).containsExactly(a);
  }

  /**
   * 본문을 비우고 파일 하나만 남기면 본문은 NULL 로 저장되고(첨부만 보낸 메시지와 같은 꼴), 응답·목록 어디서도 body 는 "" 다 — NULL 이 새어 500 이
   * 나지 않는다.
   */
  @Test
  void emptyBody_keepOne_savesNullBody() throws Exception {
    long a = upload("a.txt");
    long b = upload("b.txt");
    long id = send("본문", a, b);

    ChatMessageResponse res =
        chatMessageService.update(author, id, new UpdateChatMessageRequest("", List.of(a)));

    assertThat(res.body()).isEmpty();
    assertThat(
            dsl.select(CHAT_MESSAGE.BODY)
                .from(CHAT_MESSAGE)
                .where(CHAT_MESSAGE.ID.eq(id))
                .fetchOne(CHAT_MESSAGE.BODY))
        .isNull();
    var listed =
        chatMessageService.list(author, threadId, null, null, false, 50).items().stream()
            .filter(m -> m.id() == id)
            .findFirst()
            .orElseThrow();
    assertThat(listed.body()).isEmpty();
    var ev = events.stream(ChatMessageUpdatedEvent.class).toList().getLast();
    assertThat(ev.body()).isEmpty();
  }

  /** 드라이브 링크가 남아 있으면 빈 메시지가 아니다 — 본문·첨부를 모두 비워도 200(작성의 빈 메시지 판정과 같다). */
  @Test
  void driveLinkOnly_emptyBody_ok() throws Exception {
    long space = seedDriveSpace(author);
    long x = upload("x.txt");
    send("원본", x);
    long driveFileId = driveLinkService.importAttachment(author, space, null, x).id();
    long a = upload("a.txt");
    long id =
        chatMessageService
            .create(
                author,
                threadId,
                new CreateChatMessageRequest("", List.of(a), List.of(driveFileId)))
            .id();

    ChatMessageResponse res =
        chatMessageService.update(author, id, new UpdateChatMessageRequest("", List.of()));

    assertThat(res.attachments()).isEmpty();
    assertThat(res.driveLinks()).hasSize(1);
  }

  /** 첨부가 없던 메시지: 빈 keep 은 그냥 본문 수정, 남의 id 는 400. */
  @Test
  void keepFileIds_onMessageWithoutAttachments() throws Exception {
    long id = send("본문만");
    long c = upload("c.txt");
    send("다른 글", c);

    assertThat(
            chatMessageService
                .update(author, id, new UpdateChatMessageRequest("x", List.of()))
                .body())
        .isEqualTo("x");
    assertThatThrownBy(
            () ->
                chatMessageService.update(
                    author, id, new UpdateChatMessageRequest("x", List.of(c))))
        .isInstanceOf(InvalidChatAttachmentException.class)
        .hasMessage("이 메시지에 붙은 첨부가 아닙니다");
  }

  // ─── 권한·상태 거절(아무것도 지우지 않음) ─────────────

  /** 남의 메시지는 keep 이 있어도 403 — 첨부를 건드리지 않는다. */
  @Test
  void otherUsersMessage_withKeep_403_nothingRemoved() throws Exception {
    long a = upload("a.txt");
    long b = upload("b.txt");
    long id = send("본문", a, b);

    assertThatThrownBy(
            () ->
                chatMessageService.update(
                    other, id, new UpdateChatMessageRequest("본문", List.of(a))))
        .isInstanceOf(ChatMessageAuthorMismatchException.class);
    assertThat(attachmentsOf(id)).containsExactlyInAnyOrder(a, b);
  }

  /** 삭제된 메시지는 keep 이 있어도 없는 메시지와 같게 404. */
  @Test
  void deletedMessage_withKeep_404() throws Exception {
    long a = upload("a.txt");
    long id = send("본문", a);
    chatMessageService.delete(author, id);

    assertThatThrownBy(
            () ->
                chatMessageService.update(
                    author, id, new UpdateChatMessageRequest("본문", List.of(a))))
        .isInstanceOf(ChatMessageNotFoundException.class);
  }

  /** 먼저 들어온 수정이 b 를 뺀 뒤, 옛 화면 상태로 b 를 남기라는 요청은 400 — 뺀 첨부를 조용히 되살리지 않는다. */
  @Test
  void concurrentEdit_staleKeep_rejected() throws Exception {
    long a = upload("a.txt");
    long b = upload("b.txt");
    long id = send("본문", a, b);

    chatMessageService.update(author, id, new UpdateChatMessageRequest("본문", List.of(a)));

    assertThatThrownBy(
            () ->
                chatMessageService.update(
                    author, id, new UpdateChatMessageRequest("본문", List.of(b))))
        .isInstanceOf(InvalidChatAttachmentException.class)
        .hasMessage("이 메시지에 붙은 첨부가 아닙니다");
    assertThat(attachmentsOf(id)).containsExactly(a);
  }

  // ─── 뺀 파일의 읽기 경로 ─────────────────────────────────────────

  /** 뺀 파일은 그 메시지의 다운로드·미리 보기·텍스트·보기 경로에서 404, 첨부 모아보기·가져오기 인가에서도 빠진다. 남긴 파일은 그대로 열린다. */
  @Test
  void removedFile_goneFromReadPaths() throws Exception {
    long a = upload("a.txt");
    long b = upload("b.txt");
    long id = send("본문", a, b);
    chatMessageService.update(author, id, new UpdateChatMessageRequest("본문", List.of(a)));

    assertThatThrownBy(() -> attachmentService.download(other, threadId, id, b))
        .isInstanceOf(ChatAttachmentNotFoundException.class);
    assertThatThrownBy(() -> attachmentService.resolveContentFileId(other, threadId, id, b))
        .isInstanceOf(ChatAttachmentNotFoundException.class);
    assertThatThrownBy(() -> attachmentService.readText(other, threadId, b, 0, 10))
        .isInstanceOf(ChatAttachmentNotFoundException.class);
    assertThatThrownBy(() -> attachmentService.resolveViewFileId(other, threadId, b))
        .isInstanceOf(ChatAttachmentNotFoundException.class);
    assertThat(attachmentService.download(other, threadId, id, a).originalName())
        .isEqualTo("a.txt");

    assertThat(sourceProvider.list(other, null, null, 50))
        .extracting(e -> e.fileId())
        .contains(a)
        .doesNotContain(b);
    assertThat(sourceProvider.canAccessFile(other, b)).isFalse();

    // HTTP 로도 404 — 웹·MCP 가 「없는 첨부」로 다룬다.
    String base = "/api/v1/chat/threads/" + threadId + "/messages/" + id + "/attachments/" + b;
    for (String suffix : List.of("/content", "/preview")) {
      mvc.perform(get(base + suffix).header("Authorization", "Bearer " + tokenFor(other)))
          .andExpect(status().isNotFound());
    }
    mvc.perform(
            get("/api/v1/chat/threads/" + threadId + "/attachments/" + b + "/text")
                .header("Authorization", "Bearer " + tokenFor(other)))
        .andExpect(status().isNotFound());
  }

  /** 드라이브로 가져간 파일은 메시지에서 빼도 만료를 걸지 않는다 — 그 file 의 수명은 드라이브가 맡는다. */
  @Test
  void removedFile_importedToDrive_keepsFileAlive() throws Exception {
    long space = seedDriveSpace(author);
    long a = upload("a.txt");
    long b = upload("b.txt");
    long id = send("본문", a, b);
    driveLinkService.importAttachment(author, space, null, b);

    chatMessageService.update(author, id, new UpdateChatMessageRequest("본문", List.of(a)));

    assertThat(attachmentsOf(id)).containsExactly(a);
    assertThat(fileExpiresAt(b)).isNull();
  }

  /** 드라이브 휴지통에 있는 파일도 드라이브가 쓰는 것으로 본다 — 영구 삭제 전까지 복원할 수 있어야 하므로 만료를 걸지 않는다. */
  @Test
  void removedFile_driveTrash_keepsFileAlive() throws Exception {
    long space = seedDriveSpace(author);
    long a = upload("a.txt");
    long b = upload("b.txt");
    long id = send("본문", a, b);
    long driveFileId = driveLinkService.importAttachment(author, space, null, b).id();
    driveFileService.delete(author, driveFileId); // 휴지통으로

    chatMessageService.update(author, id, new UpdateChatMessageRequest("본문", List.of(a)));

    assertThat(attachmentsOf(id)).containsExactly(a);
    assertThat(fileExpiresAt(b)).isNull();
  }

  /**
   * 다른 「보이는 첨부」 정션(여기서는 메인 AI 채팅 메시지 첨부)에도 묶인 파일은 메시지에서 빼도 만료를 걸지 않는다 — 만료 스윕이 file 행을 지우면 그 정션 행이
   * CASCADE 로 함께 사라져 다른 곳의 첨부가 조용히 없어진다(WP-1399 와 같은 규칙).
   */
  @Test
  void removedFile_visiblyBoundElsewhere_keepsFileAlive() throws Exception {
    long a = upload("a.txt");
    long b = upload("b.txt");
    long id = send("본문", a, b);
    bindToHomeMessage(b);

    chatMessageService.update(author, id, new UpdateChatMessageRequest("본문", List.of(a)));

    assertThat(attachmentsOf(id)).containsExactly(a);
    assertThat(fileExpiresAt(b)).isNull();
  }

  // ─── HTTP 요청 검증 ─────────────────────────────────────────────

  /** keepFileIds 원소 null 은 400, keep 없이 빈 본문은 지금처럼 400, 정상 keep 은 200. */
  @Test
  void patch_keepFileIds_validation() throws Exception {
    long a = upload("a.txt");
    long b = upload("b.txt");
    long id = send("본문", a, b);
    String url = "/api/v1/chat/messages/" + id;

    mvc.perform(
            patch(url)
                .header("Authorization", "Bearer " + tokenFor(author))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"x\",\"keepFileIds\":[null]}"))
        .andExpect(status().isBadRequest());
    mvc.perform(
            patch(url)
                .header("Authorization", "Bearer " + tokenFor(author))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"\"}"))
        .andExpect(status().isBadRequest());
    assertThat(attachmentsOf(id)).containsExactlyInAnyOrder(a, b);
    mvc.perform(
            patch(url)
                .header("Authorization", "Bearer " + tokenFor(author))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"x\",\"keepFileIds\":[" + a + "]}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.attachments.length()").value(1))
        .andExpect(jsonPath("$.attachments[0].fileId").value(a));
  }

  // ─── 헬퍼 ─────────────────────────────────────────────────

  /** 작성자 이름으로 임시 첨부를 올린다(전송 전 선업로드). */
  private long upload(String name) throws Exception {
    return attachmentService
        .upload(
            author,
            threadId,
            List.of(new MockMultipartFile("files", name, "text/plain", ("내용-" + name).getBytes())))
        .get(0)
        .fileId();
  }

  /** 작성자가 본문과 첨부로 메시지를 보낸다. */
  private long send(String body, long... fileIds) {
    List<Long> ids = java.util.Arrays.stream(fileIds).boxed().toList();
    return chatMessageService
        .create(author, threadId, new CreateChatMessageRequest(body, ids, List.of()))
        .id();
  }

  private OffsetDateTime fileExpiresAt(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }

  private boolean fileRowExists(long fileId) {
    return dsl.fetchExists(FILE, FILE.ID.eq(fileId));
  }

  /** fileId 를 작성자의 메인 AI 채팅(홈) 메시지 첨부로도 묶는다 — 「보이는 첨부」 정션 중 가장 적은 준비로 만들 수 있는 것. */
  private void bindToHomeMessage(long fileId) {
    var sessionId =
        dsl.insertInto(HOME_SESSION)
            .set(HOME_SESSION.USER_ID, author)
            .returning(HOME_SESSION.ID)
            .fetchOne()
            .getId();
    long homeMessageId =
        dsl.insertInto(HOME_MESSAGE)
            .set(HOME_MESSAGE.SESSION_ID, sessionId)
            .set(HOME_MESSAGE.ROLE, "USER")
            .set(HOME_MESSAGE.CONTENT, "첨부")
            .returning(HOME_MESSAGE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(HOME_MESSAGE_ATTACHMENT)
        .set(HOME_MESSAGE_ATTACHMENT.FILE_ID, fileId)
        .set(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID, homeMessageId)
        .set(HOME_MESSAGE_ATTACHMENT.ATTACHED_BY, author)
        .execute();
  }

  /** 메시지에 지금 연결된 첨부 file id. */
  private List<Long> attachmentsOf(long messageId) {
    return dsl.select(CHAT_MESSAGE_ATTACHMENT.FILE_ID)
        .from(CHAT_MESSAGE_ATTACHMENT)
        .where(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID.eq(messageId))
        .fetch(CHAT_MESSAGE_ATTACHMENT.FILE_ID);
  }

  /** 가져오기 대상 드라이브 팀 스페이스 — owner 를 EDITOR 로 넣는다(DriveVirtualAttachmentMoreSourcesTest 와 같은 꼴). */
  private long seedDriveSpace(long owner) {
    long space =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "ER-" + UUID.randomUUID().toString().substring(0, 6))
            .set(DRIVE_SPACE.OWNER_ID, owner)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, space)
        .set(DRIVE_SPACE_MEMBER.USER_ID, owner)
        .set(DRIVE_SPACE_MEMBER.ROLE, "EDITOR")
        .execute();
    return space;
  }

  private String tokenFor(long uid) {
    return jwtTokenProvider.generateAccessToken(uid, "user-" + uid);
  }
}
