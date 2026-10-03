package com.workplace.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.issue.service.OpenScenario;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/**
 * OPEN 프로젝트 이슈 채팅 스레드 개방 통합 테스트.
 *
 * <p>스레드 조회(getOrCreate)·메시지 목록은 OPEN 테넌트 전원 허용(reporter/stranger 모두). 메시지 작성은 댓글과 같은 권한(WP-213) —
 * reporter 본인은 작성 가능, stranger 는 작성 시 ChatThreadNotMemberException 이고 응답의 canPost 도
 * false. @Transactional 롤백 격리 + TenantContext 테넌트 1 고정으로 RLS GUC 주입 보장.
 */
@Transactional
class OpenChatThreadTest extends IntegrationTestBase {

  @Autowired ChatThreadService threadService;
  @Autowired ChatMessageService messageService;
  @Autowired ChatMessageAttachmentService attachmentService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired DSLContext dsl;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  private OpenScenario.Result openScenario() {
    return OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
  }

  /** OPEN reporter(비멤버)가 스레드를 조회·생성할 수 있다(초기 멤버로 자신이 시드됨). */
  @Test
  void open_reporter_can_get_thread() {
    var s = openScenario();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    assertThat(thread.threadId()).isNotNull();
    assertThat(thread.members()).extracting(m -> m.userId().longValue()).contains(s.reporterId());
  }

  /** 비멤버 stranger 도 OPEN 스레드 조회는 가능(개방). */
  @Test
  void open_stranger_can_get_thread() {
    var s = openScenario();
    var thread = threadService.getOrCreate(s.strangerId(), s.projectKey(), s.issueNumber());
    assertThat(thread.threadId()).isNotNull();
  }

  /** reporter 는 스레드 멤버이므로 메시지 작성 성공. */
  @Test
  void open_reporter_can_post() {
    var s = openScenario();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    var msg =
        messageService.create(
            s.reporterId(), thread.threadId(), new CreateChatMessageRequest("문의드립니다"));
    assertThat(msg.id()).isNotNull();
  }

  /** reporter 는 쓸 수 있고 stranger 는 쓸 수 없다고 화면에 알린다(canPost) — stranger 에겐 입력창 대신 안내. */
  @Test
  void open_canPost_flag_reflects_write_permission() {
    var s = openScenario();
    assertThat(threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).canPost())
        .isTrue();
    assertThat(threadService.getOrCreate(s.strangerId(), s.projectKey(), s.issueNumber()).canPost())
        .isFalse();
  }

  /** stranger 도 과거 메시지 목록은 읽을 수 있다(스레드 조회와 같은 읽기 권한). */
  @Test
  void open_stranger_can_list_messages() {
    var s = openScenario();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    var msg =
        messageService.create(
            s.reporterId(), thread.threadId(), new CreateChatMessageRequest("문의드립니다"));
    var page = messageService.list(s.strangerId(), thread.threadId(), null, 50);
    assertThat(page.items()).extracting(m -> m.id()).contains(msg.id());
  }

  /** stranger 도 읽을 수 있는 메시지의 첨부는 내려받을 수 있다(목록과 같은 읽기 규칙, WP-213). */
  @Test
  void open_stranger_can_download_attachment() throws Exception {
    var s = openScenario();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    var file = new MockMultipartFile("files", "a.txt", "text/plain", "hello".getBytes());
    long fileId =
        attachmentService.upload(s.reporterId(), thread.threadId(), List.of(file)).get(0).fileId();
    var msg =
        messageService.create(
            s.reporterId(),
            thread.threadId(),
            new CreateChatMessageRequest("첨부", List.of(fileId), List.of()));

    var row = attachmentService.download(s.strangerId(), thread.threadId(), msg.id(), fileId);
    assertThat(row.originalName()).isEqualTo("a.txt");
  }

  /** stranger 는 스레드를 볼 수는 있으나 댓글 작성 권한이 없어 메시지 작성 불가. */
  @Test
  void open_stranger_cannot_post() {
    var s = openScenario();
    var thread = threadService.getOrCreate(s.strangerId(), s.projectKey(), s.issueNumber());
    assertThatThrownBy(
            () ->
                messageService.create(
                    s.strangerId(), thread.threadId(), new CreateChatMessageRequest("스팸")))
        .isInstanceOf(ChatThreadNotMemberException.class);
  }
}
