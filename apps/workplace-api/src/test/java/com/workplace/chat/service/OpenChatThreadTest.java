package com.workplace.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.issue.service.OpenScenario;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.TenantScopedIntegrationTest;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * OPEN 프로젝트 이슈 채팅 스레드 개방 통합 테스트.
 *
 * <p>스레드 조회(getOrCreate)는 OPEN 테넌트 전원 허용(reporter/stranger 모두). 단, 메시지 작성은 스레드 멤버만 — reporter 는 초기
 * stakeholder 로 시드되어 작성 가능, stranger 는 비멤버라 작성 시 ChatThreadNotMemberException. @Transactional 롤백 격리
 * + TenantContext 테넌트 1 고정으로 RLS GUC 주입 보장.
 */
@Transactional
class OpenChatThreadTest extends TenantScopedIntegrationTest {

  @Autowired ChatThreadService threadService;
  @Autowired ChatMessageService messageService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired DSLContext dsl;

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

  /** stranger 는 스레드를 볼 수는 있으나 비멤버라 메시지 작성 불가(ensureMember 차단). */
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
