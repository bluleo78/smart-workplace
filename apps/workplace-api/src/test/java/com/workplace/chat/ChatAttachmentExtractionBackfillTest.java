package com.workplace.chat;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.service.ChatAttachmentExtractionBackfill;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageAttachmentService;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.fileai.inbound.ExtractionBackfillSource;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/** WP-244: 챗 첨부 백필 SPI — 바인딩된 첨부 중 추출 행이 없는 것만 반환. */
class ChatAttachmentExtractionBackfillTest extends IntegrationTestBase {

  @Autowired ChatMessageService chatMessageService;
  @Autowired ChatMessageAttachmentService attachmentService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatFixtures fx;
  @Autowired ChatAttachmentExtractionBackfill source;
  @Autowired DSLContext dsl;
  @Autowired TransactionTemplate tx;

  @MockitoBean SseRegistry sseRegistry;
  @MockitoBean AiAgentEventClient aiAgentEventClient;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    // file 삭제 CASCADE 로도 지워지지만 명시적으로 먼저 정리한다.
    tx.executeWithoutResult(
        st -> {
          dsl.execute(
              "DELETE FROM file_extraction fe USING file f"
                  + " WHERE fe.file_id = f.id AND f.category = 'ATTACHMENT'");
          dsl.execute(
              "DELETE FROM chat_message_attachment cma USING file f"
                  + " WHERE cma.file_id = f.id AND f.category = 'ATTACHMENT'");
          dsl.execute("DELETE FROM file WHERE category = 'ATTACHMENT'");
        });
    fx.cleanupAll();
    TenantContext.clear();
  }

  /** 업로드 + 메시지 바인딩(추출 행 생성)한 첨부의 fileId. */
  private long bind(String name, String mime) throws Exception {
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    long fileId =
        attachmentService
            .upload(
                s.reporterId(),
                threadId,
                List.of(new MockMultipartFile("files", name, mime, "x".getBytes())))
            .get(0)
            .fileId();
    chatMessageService.create(
        s.reporterId(), threadId, new CreateChatMessageRequest("본문", List.of(fileId), List.of()));
    return fileId;
  }

  /** WP-242 이전 업로드를 흉내: 바인딩이 만든 추출 행을 지운다. */
  private long bindLegacy(String name, String mime) throws Exception {
    long fileId = bind(name, mime);
    dsl.execute("DELETE FROM file_extraction WHERE file_id = ?", fileId);
    return fileId;
  }

  private List<ExtractionBackfillSource.Target> missing(int limit) {
    return tx.execute(st -> source.findMissing(limit));
  }

  @Test
  void 추출_행이_없는_첨부를_돌려준다() throws Exception {
    long fileId = bindLegacy("a.pdf", "application/pdf");
    assertThat(missing(100))
        .contains(new ExtractionBackfillSource.Target(fileId, "application/pdf"));
  }

  @Test
  void 행이_있는_첨부는_제외() throws Exception {
    long fileId = bind("b.pdf", "application/pdf");
    assertThat(missing(100))
        .extracting(ExtractionBackfillSource.Target::fileId)
        .doesNotContain(fileId);
  }

  @Test
  void limit_을_지킨다() throws Exception {
    bindLegacy("c.txt", "text/plain");
    bindLegacy("d.txt", "text/plain");
    assertThat(missing(1)).hasSize(1);
  }
}
