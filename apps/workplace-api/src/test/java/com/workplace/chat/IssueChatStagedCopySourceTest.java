package com.workplace.chat;

import static com.workplace.jooq.Tables.FILE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageAttachmentService;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.storage.FileStore;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.ExternalClientMockedTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 스테이징 복사 {@code issue_chat} 출처(WP-1705) 통합 테스트 — 이슈 챗 첨부를 {@code POST /staged-files/copy} 로 복사하고,
 * 다운로드(/content)와 같은 가드로 읽을 수 없는 첨부는 거절되며 FILE 행이 남지 않는지 본다.
 *
 * <p>챗 fixture 는 커밋되는 비-Tx 데이터라 {@code @AfterEach} 에서 첨부·FILE·fixture 를 직접 회수한다.
 */
class IssueChatStagedCopySourceTest extends ExternalClientMockedTestBase {

  private static final byte[] BYTES = "chat-image".getBytes();

  @Autowired ChatMessageService chatMessageService;
  @Autowired ChatMessageAttachmentService attachmentService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatFixtures fx;
  @Autowired DSLContext dsl;
  @Autowired FileStore fileStore;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    dsl.execute(
        "DELETE FROM chat_message_attachment cma USING file f"
            + " WHERE cma.file_id = f.id AND f.category = 'ATTACHMENT'");
    dsl.execute("DELETE FROM file WHERE category = 'ATTACHMENT'");
    fx.cleanupAll();
    TenantContext.clear();
  }

  /** 메시지 id 와 그 첨부 file id. */
  private record Sent(long threadId, long messageId, long fileId) {}

  /** reporter 가 스레드를 열고 첨부 하나를 붙인 메시지를 보낸다. */
  private Sent send(ChatFixtures.Setup s) throws Exception {
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    long fileId =
        attachmentService
            .upload(
                s.reporterId(),
                threadId,
                List.of(new MockMultipartFile("files", "shot.png", "image/png", BYTES)))
            .get(0)
            .fileId();
    var msg =
        chatMessageService.create(
            s.reporterId(), threadId, new CreateChatMessageRequest("", List.of(fileId), List.of()));
    return new Sent(threadId, msg.id(), fileId);
  }

  private String body(ChatFixtures.Setup s, Long messageId, long attachmentId) {
    return "{\"source\":\"issue_chat\",\"issueKey\":\""
        + s.projectKey()
        + "-"
        + s.issueNumber()
        + "\""
        + (messageId == null ? "" : ",\"messageId\":" + messageId)
        + ",\"attachmentId\":"
        + attachmentId
        + "}";
  }

  @Test
  void 이슈_챗_첨부를_복사하면_호출자_소유_임시_파일이_된다() throws Exception {
    var s = fx.setup();
    var sent = send(s);

    mvc.perform(copy(s.reporterId(), body(s, sent.messageId(), sent.fileId())))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.name").value("shot.png"))
        .andExpect(jsonPath("$.expiresAt").isNotEmpty());

    var copy =
        dsl.selectFrom(FILE)
            .where(
                FILE.UPLOADED_BY.eq(s.reporterId()),
                FILE.ID.ne(sent.fileId()),
                FILE.EXPIRES_AT.isNotNull())
            .fetchOne();
    assertThat(copy).isNotNull();
    assertThat(copy.getCategory()).isEqualTo(StagedFileClaimer.CATEGORY_ATTACHMENT);
    assertThat(fileStore.readAllBytes(copy.getStoragePath())).isEqualTo(BYTES);
  }

  @Test
  void 프로젝트를_읽을_수_없는_사용자는_이슈_유무와_스레드_유무에_상관없이_같은_404() throws Exception {
    // 스레드가 있는 이슈(s)와 스레드가 없는 이슈(bare), 없는 이슈 번호 — 볼 수 없는 사람에겐 셋 다 「이슈 없음」 404 여야 존재가 드러나지 않는다.
    var s = fx.setup();
    var sent = send(s);
    var bare = fx.setup();
    int before = dsl.fetchCount(FILE);

    mvc.perform(copy(s.outsiderId(), body(s, sent.messageId(), sent.fileId())))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("이슈를 찾을 수 없습니다: " + s.projectKey() + "#1"));
    mvc.perform(copy(bare.outsiderId(), body(bare, 1L, 1L)))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("이슈를 찾을 수 없습니다: " + bare.projectKey() + "#1"));
    String missing =
        "{\"source\":\"issue_chat\",\"issueKey\":\""
            + s.projectKey()
            + "-999\",\"messageId\":1,\"attachmentId\":1}";
    mvc.perform(copy(s.outsiderId(), missing))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("이슈를 찾을 수 없습니다: " + s.projectKey() + "#999"));
    assertThat(dsl.fetchCount(FILE)).isEqualTo(before);
  }

  @Test
  void 메시지에서_뺀_첨부나_삭제된_메시지의_첨부는_404_행이_생기지_않는다() throws Exception {
    var s = fx.setup();
    var removed = send(s);
    // 첨부를 빼고 본문만 남긴다 — keepFileIds 가 빈 목록이면 그 첨부가 메시지에서 빠진다.
    chatMessageService.update(
        s.reporterId(), removed.messageId(), new UpdateChatMessageRequest("본문", List.of()));
    var deleted = send(s);
    chatMessageService.delete(s.reporterId(), deleted.messageId());
    int before = dsl.fetchCount(FILE);

    // 가드는 그대로 두고 문구로 다음 할 일(이슈 첨부는 source issue)을 알린다 — read_file issue_chat 의 id 를 그대로 넣은 모델용.
    mvc.perform(copy(s.reporterId(), body(s, removed.messageId(), removed.fileId())))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value(containsString("source 'issue'")));
    mvc.perform(copy(s.reporterId(), body(s, deleted.messageId(), deleted.fileId())))
        .andExpect(status().isNotFound());
    assertThat(dsl.fetchCount(FILE)).isEqualTo(before);
  }

  @Test
  void 다른_스레드의_메시지_id_는_400() throws Exception {
    var s = fx.setup();
    var other = fx.setup();
    var sent = send(s);
    var otherSent = send(other);
    int before = dsl.fetchCount(FILE);

    // s 의 이슈 키로 other 스레드의 메시지 id 를 대면 이 스레드 소속이 아니라 400 이다.
    mvc.perform(copy(s.reporterId(), body(s, otherSent.messageId(), sent.fileId())))
        .andExpect(status().isBadRequest());
    assertThat(dsl.fetchCount(FILE)).isEqualTo(before);
  }

  @Test
  void 챗_스레드가_없는_이슈는_404() throws Exception {
    var s = fx.setup();
    int before = dsl.fetchCount(FILE);

    mvc.perform(copy(s.reporterId(), body(s, 1L, 1L))).andExpect(status().isNotFound());
    assertThat(dsl.fetchCount(FILE)).isEqualTo(before);
  }

  @Test
  void messageId_가_없으면_400() throws Exception {
    var s = fx.setup();
    var sent = send(s);

    mvc.perform(copy(s.reporterId(), body(s, null, sent.fileId())))
        .andExpect(status().isBadRequest());
  }

  private MockHttpServletRequestBuilder copy(long userId, String json) {
    return post("/api/v1/staged-files/copy")
        .header(
            "Authorization",
            "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L))
        .contentType(MediaType.APPLICATION_JSON)
        .content(json);
  }
}
