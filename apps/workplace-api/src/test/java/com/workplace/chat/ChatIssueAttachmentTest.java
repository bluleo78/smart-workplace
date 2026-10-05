package com.workplace.chat;

import static com.workplace.jooq.tables.FileExtraction.FILE_EXTRACTION;
import static com.workplace.jooq.tables.User.USER;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.service.IssueAttachmentService;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

/**
 * WP-244: 이슈 챗 스레드 경유 이슈 첨부 조회. 실제 운영처럼 ai-agent 가 {@code Internal + X-On-Behalf-Of} 로, 역할·프로젝트 멤버십
 * 없이 스레드 멤버이기만 한 AGENT 신원으로 비공개(TEAM) 프로젝트 이슈의 첨부 목록·텍스트·원본을 읽을 수 있는지 HTTP 로 검증한다.
 */
class ChatIssueAttachmentTest extends IntegrationTestBase {

  /** application-test.yml 의 workplace.ai-agent.internal-token 값. */
  private static final String INTERNAL_TOKEN = "test-token";

  private static final byte[] PDF_BYTES = "%PDF-1.4 hello".getBytes();

  @Autowired MockMvc mockMvc;
  @Autowired ChatThreadService threadService;
  @Autowired ChatThreadMemberRepository memberRepo;
  @Autowired IssueAttachmentService issueAttachmentService;
  @Autowired ChatFixtures fx;
  @Autowired DSLContext dsl;
  @Autowired TransactionTemplate tx;

  @MockitoBean SseRegistry sseRegistry;
  @MockitoBean AiAgentEventClient aiAgentEventClient;

  private final List<Long> agentIds = new ArrayList<>();

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    // 이 테스트가 올린 이슈 첨부(파일·추출 행)를 먼저 지운다.
    inTx(
        () -> {
          dsl.execute(
              "DELETE FROM file_extraction fe USING file f"
                  + " WHERE fe.file_id = f.id AND f.category = 'ATTACHMENT'");
          dsl.execute(
              "DELETE FROM issue_attachment ia USING file f"
                  + " WHERE ia.file_id = f.id AND f.category = 'ATTACHMENT'");
          dsl.execute("DELETE FROM file WHERE category = 'ATTACHMENT'");
          return null;
        });
    // fixture 회수(이슈 삭제 → 스레드·스레드 멤버 CASCADE) 뒤에야 AGENT 사용자를 지울 수 있다.
    fx.cleanupAll();
    if (!agentIds.isEmpty()) {
      inTx(() -> dsl.deleteFrom(USER).where(USER.ID.in(agentIds)).execute());
    }
    agentIds.clear();
    TenantContext.clear();
  }

  private <T> T inTx(Supplier<T> s) {
    return tx.execute(st -> s.get());
  }

  /** 역할·프로젝트 멤버십이 없는 AGENT 사용자(운영의 멘션된 에이전트와 같은 조건). */
  private long insertAgent() {
    String name = "ai_" + UUID.randomUUID().toString().substring(0, 6);
    long id =
        inTx(
            () ->
                dsl.insertInto(USER)
                    .set(USER.USERNAME, name)
                    .set(USER.PASSWORD, "pw")
                    .set(USER.NAME, name)
                    .set(USER.EMAIL, name + "@example.com")
                    .set(USER.KIND, "AGENT")
                    .returning(USER.ID)
                    .fetchOne()
                    .getId());
    agentIds.add(id);
    return id;
  }

  /** 이슈 작성자(프로젝트 OWNER)가 이슈에 PDF 를 첨부한다. */
  private long uploadIssuePdf(ChatFixtures.Setup s) {
    List<MultipartFile> files =
        List.of(new MockMultipartFile("files", "spec.pdf", "application/pdf", PDF_BYTES));
    return inTx(
        () ->
            issueAttachmentService
                .upload(s.reporterId(), s.projectKey(), s.issueNumber(), files)
                .get(0)
                .fileId());
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

  /** 멘션된 AGENT 가 대화에 추가되는 것과 같이 스레드 멤버로만 등록한다(프로젝트 멤버 아님). */
  private void joinThread(long threadId, long userId) {
    tx.executeWithoutResult(st -> memberRepo.insertIgnoreConflict(threadId, List.of(userId)));
  }

  private long threadOf(ChatFixtures.Setup s) {
    return threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
  }

  /** ai-agent 와 같은 인증 — Internal 토큰 + 대행 사용자. */
  private MockHttpServletRequestBuilder as(long userId, MockHttpServletRequestBuilder req) {
    return req.header("Authorization", "Internal " + INTERNAL_TOKEN)
        .header("X-On-Behalf-Of", String.valueOf(userId));
  }

  @Test
  void 스레드_멤버인_비프로젝트_AGENT_는_스레드로_이슈_첨부_목록_텍스트_원본을_읽는다() throws Exception {
    ChatFixtures.Setup s = fx.setup();
    long threadId = threadOf(s);
    long agentId = insertAgent();
    joinThread(threadId, agentId);
    long fileId = uploadIssuePdf(s);
    markDone(fileId, "abcdef");

    // 기존 이슈 첨부 API 는 그대로 막혀 있다(비멤버·역할 없음) — 권한을 느슨하게 하지 않았다.
    mockMvc
        .perform(
            as(
                agentId,
                get(
                    "/api/v1/projects/{key}/issues/{n}/attachments",
                    s.projectKey(),
                    s.issueNumber())))
        .andExpect(status().isForbidden());

    // 스레드 경유 목록 — 추출 상태 포함, 이슈 첨부 목록과 같은 항목 형태.
    mockMvc
        .perform(as(agentId, get("/api/v1/chat/threads/{id}/issue-attachments", threadId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].fileId").value(fileId))
        .andExpect(jsonPath("$[0].issueId").value(s.issueId()))
        .andExpect(jsonPath("$[0].originalName").value("spec.pdf"))
        .andExpect(jsonPath("$[0].extraction.status").value("READY"));

    // 텍스트 — 기존 스레드 첨부 텍스트 경로가 이슈 첨부 fileId 도 받는다.
    mockMvc
        .perform(
            as(
                agentId,
                get("/api/v1/chat/threads/{id}/attachments/{fileId}/text", threadId, fileId)
                    .param("offset", "2")
                    .param("limit", "2")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.text").value("cd"))
        .andExpect(jsonPath("$.nextOffset").value(4));

    // 원본 다운로드.
    mockMvc
        .perform(
            as(
                agentId,
                get(
                    "/api/v1/chat/threads/{id}/issue-attachments/{fileId}/content",
                    threadId,
                    fileId)))
        .andExpect(status().isOk())
        .andExpect(content().contentType("application/pdf"))
        .andExpect(content().bytes(PDF_BYTES));
  }

  @Test
  void 스레드_멤버도_프로젝트_멤버도_아니면_403() throws Exception {
    ChatFixtures.Setup s = fx.setup();
    long threadId = threadOf(s);
    long fileId = uploadIssuePdf(s);
    long outsider = s.outsiderId();

    mockMvc
        .perform(as(outsider, get("/api/v1/chat/threads/{id}/issue-attachments", threadId)))
        .andExpect(status().isForbidden());
    mockMvc
        .perform(
            as(
                outsider,
                get("/api/v1/chat/threads/{id}/attachments/{fileId}/text", threadId, fileId)))
        .andExpect(status().isForbidden());
    mockMvc
        .perform(
            as(
                outsider,
                get(
                    "/api/v1/chat/threads/{id}/issue-attachments/{fileId}/content",
                    threadId,
                    fileId)))
        .andExpect(status().isForbidden());
  }

  @Test
  void 다른_이슈의_첨부_fileId_는_404() throws Exception {
    ChatFixtures.Setup s = fx.setup();
    long threadId = threadOf(s);
    long agentId = insertAgent();
    joinThread(threadId, agentId);
    // 다른 프로젝트 이슈의 첨부.
    ChatFixtures.Setup other = fx.setup();
    long otherFileId = uploadIssuePdf(other);

    mockMvc
        .perform(
            as(
                agentId,
                get(
                    "/api/v1/chat/threads/{id}/issue-attachments/{fileId}/content",
                    threadId,
                    otherFileId)))
        .andExpect(status().isNotFound());
    mockMvc
        .perform(
            as(
                agentId,
                get("/api/v1/chat/threads/{id}/attachments/{fileId}/text", threadId, otherFileId)))
        .andExpect(status().isNotFound());
    // 다른 이슈 첨부는 목록에도 섞이지 않는다.
    mockMvc
        .perform(as(agentId, get("/api/v1/chat/threads/{id}/issue-attachments", threadId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(0));
  }
}
