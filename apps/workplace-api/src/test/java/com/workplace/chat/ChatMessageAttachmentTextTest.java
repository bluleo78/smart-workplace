package com.workplace.chat;

import static com.workplace.jooq.tables.File.FILE;
import static com.workplace.jooq.tables.FileExtraction.FILE_EXTRACTION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.exception.ChatAttachmentNotFoundException;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageAttachmentService;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/** WP-242: 이슈 챗 첨부 — MIME 정규화, 바인딩 시 추출 요청, 하이드레이션 extraction, 구간 읽기. */
class ChatMessageAttachmentTextTest extends IntegrationTestBase {

  @Autowired ChatMessageService chatMessageService;
  @Autowired ChatMessageAttachmentService attachmentService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatFixtures fx;
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

  private MockMultipartFile mockMultipart(String name, String mime, byte[] bytes) {
    return new MockMultipartFile("files", name, mime, bytes);
  }

  /** 업로드 + 메시지 전송으로 바인딩한 PDF 의 fileId. */
  private long bindPdf(long callerId, long threadId) throws Exception {
    long fileId =
        attachmentService
            .upload(
                callerId,
                threadId,
                List.of(mockMultipart("a.pdf", "application/pdf", "%PDF".getBytes())))
            .get(0)
            .fileId();
    chatMessageService.create(
        callerId, threadId, new CreateChatMessageRequest("본문", List.of(fileId), List.of()));
    return fileId;
  }

  private <T> T inTx(Supplier<T> s) {
    return tx.execute(st -> s.get());
  }

  private void markDone(long fileId, String text) {
    inTx(
        () ->
            dsl.update(FILE_EXTRACTION)
                .set(FILE_EXTRACTION.STATUS, "DONE")
                .set(FILE_EXTRACTION.EXTRACTED_TEXT, text)
                .set(FILE_EXTRACTION.CHAR_COUNT, text.codePointCount(0, text.length()))
                .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                .execute());
  }

  private String statusOf(long fileId) {
    return inTx(
        () ->
            dsl.select(FILE_EXTRACTION.STATUS)
                .from(FILE_EXTRACTION)
                .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                .fetchOne(FILE_EXTRACTION.STATUS));
  }

  private String profileOf(long fileId) {
    return inTx(
        () ->
            dsl.select(FILE_EXTRACTION.PROFILE)
                .from(FILE_EXTRACTION)
                .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                .fetchOne(FILE_EXTRACTION.PROFILE));
  }

  private String mimeOf(long fileId) {
    return inTx(
        () ->
            dsl.select(FILE.MIME_TYPE)
                .from(FILE)
                .where(FILE.ID.eq(fileId))
                .fetchOne(FILE.MIME_TYPE));
  }

  @Test
  void 선업로드만_하면_추출_행이_없고_바인딩하면_TEXT_ONLY_PENDING() throws Exception {
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    long fileId =
        attachmentService
            .upload(
                s.reporterId(),
                threadId,
                List.of(mockMultipart("a.pdf", "application/pdf", "%PDF".getBytes())))
            .get(0)
            .fileId();
    assertThat(statusOf(fileId)).isNull();

    chatMessageService.create(
        s.reporterId(), threadId, new CreateChatMessageRequest("본문", List.of(fileId), List.of()));
    assertThat(statusOf(fileId)).isEqualTo("PENDING");
    assertThat(profileOf(fileId)).isEqualTo("TEXT_ONLY");
  }

  @Test
  void octet_stream_대문자_PDF_는_application_pdf_로_저장() throws Exception {
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    var up =
        attachmentService.upload(
            s.reporterId(),
            threadId,
            List.of(mockMultipart("REPORT.PDF", "application/octet-stream", "%PDF".getBytes())));
    assertThat(up.get(0).mimeType()).isEqualTo("application/pdf");
    assertThat(mimeOf(up.get(0).fileId())).isEqualTo("application/pdf");
  }

  @Test
  void 메시지_응답의_첨부에_extraction_이_붙는다() throws Exception {
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    long fileId =
        attachmentService
            .upload(
                s.reporterId(),
                threadId,
                List.of(mockMultipart("a.png", "image/png", new byte[] {1})))
            .get(0)
            .fileId();
    var resp =
        chatMessageService.create(
            s.reporterId(),
            threadId,
            new CreateChatMessageRequest("본문", List.of(fileId), List.of()));
    var ex = resp.attachments().get(0).extraction();
    assertThat(ex.status()).isEqualTo("SKIPPED");
    assertThat(ex.reasonCode()).isEqualTo("IMAGE");
  }

  @Test
  void 구간_읽기와_다른_스레드_fileId_404_비멤버_403() throws Exception {
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    long fileId = bindPdf(s.reporterId(), threadId);
    markDone(fileId, "abcdef");

    var slice = attachmentService.readText(s.reporterId(), threadId, fileId, 2, 2);
    assertThat(slice.text()).isEqualTo("cd");
    assertThat(slice.nextOffset()).isEqualTo(4);

    // 다른 이슈의 스레드 — fileId 가 그 스레드 첨부가 아니므로 404
    ChatFixtures.Setup other = fx.setup();
    long otherThread =
        threadService
            .getOrCreate(other.reporterId(), other.projectKey(), other.issueNumber())
            .threadId();
    assertThatThrownBy(
            () -> attachmentService.readText(other.reporterId(), otherThread, fileId, 0, 10))
        .isInstanceOf(ChatAttachmentNotFoundException.class);
    // 존재하지 않는 fileId
    assertThatThrownBy(
            () -> attachmentService.readText(s.reporterId(), threadId, 999_999_999L, 0, 10))
        .isInstanceOf(ChatAttachmentNotFoundException.class);
    // 스레드 열람 권한 없음 — 기존 가드(403)
    assertThatThrownBy(() -> attachmentService.readText(s.outsiderId(), threadId, fileId, 0, 10))
        .isInstanceOf(ChatThreadNotMemberException.class);
  }
}
