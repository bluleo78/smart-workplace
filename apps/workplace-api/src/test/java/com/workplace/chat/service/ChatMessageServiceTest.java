package com.workplace.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.chat.exception.ChatMessageAuthorMismatchException;
import com.workplace.chat.exception.ChatThreadIssueDeletedException;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageUpdatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
import com.workplace.chat.outbound.ChatMessageOrigin;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.support.IntegrationTestBase;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/** 메시지 CRUD + 권한 + 이벤트 발행 검증. */
@RecordApplicationEvents
@Transactional
class ChatMessageServiceTest extends IntegrationTestBase {

  @Autowired ChatMessageService messageService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatFixtures fx;
  @Autowired ChatThreadMemberRepository memberRepo;
  @Autowired ApplicationEvents events;
  @Autowired IssueRepository issueRepository;

  @Test
  void create_withAgentMention_addsAgentAsThreadMember() {
    // 6c: 사람이 @AGENT 멘션 메시지를 작성하면 그 AGENT 가 thread 멤버로 자동 추가돼야
    // (AI 가 답을 POST 하려면 멤버여야 함).
    ChatFixtures.AgentSetup s = fx.setupWithAgent();
    var thread =
        threadService.getOrCreate(
            s.base().reporterId(), s.base().projectKey(), s.base().issueNumber());

    assertThat(memberRepo.isMember(thread.threadId(), s.agentId())).isFalse();

    messageService.create(
        s.base().reporterId(),
        thread.threadId(),
        new CreateChatMessageRequest("<@" + s.agentId() + "> 도와줘"));

    assertThat(memberRepo.isMember(thread.threadId(), s.agentId())).isTrue();
  }

  @Test
  void create_byMember_succeedsAndPublishesEvent() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    ChatMessageResponse msg =
        messageService.create(
            s.reporterId(), thread.threadId(), new CreateChatMessageRequest("hi"));

    assertThat(msg.body()).isEqualTo("hi");
    assertThat(msg.authorId().longValue()).isEqualTo(s.reporterId());
    assertThat(events.stream(ChatMessageCreatedEvent.class).count()).isEqualTo(1L);
  }

  @Test
  void create_byNonMember_throws() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    assertThatThrownBy(
            () ->
                messageService.create(
                    s.outsiderId(), thread.threadId(), new CreateChatMessageRequest("hi")))
        .isInstanceOf(ChatThreadNotMemberException.class);
  }

  @Test
  void update_byOther_throws() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    var msg =
        messageService.create(
            s.reporterId(), thread.threadId(), new CreateChatMessageRequest("first"));

    assertThatThrownBy(
            () ->
                messageService.update(
                    s.assigneeId(), msg.id(), new UpdateChatMessageRequest("hacked")))
        .isInstanceOf(ChatMessageAuthorMismatchException.class);
  }

  @Test
  void delete_softMasksBody() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    var msg =
        messageService.create(
            s.reporterId(), thread.threadId(), new CreateChatMessageRequest("byebye"));

    messageService.delete(s.reporterId(), msg.id());
    var page = messageService.list(s.reporterId(), thread.threadId(), null, null, false, 50);
    assertThat(page.items()).hasSize(1);
    assertThat(page.items().get(0).deleted()).isTrue();
    assertThat(page.items().get(0).body()).isEqualTo("(삭제됨)");
  }

  @Test
  void update_publishesUpdatedEvent() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    var msg =
        messageService.create(
            s.reporterId(), thread.threadId(), new CreateChatMessageRequest("first"));

    messageService.update(s.reporterId(), msg.id(), new UpdateChatMessageRequest("new body"));

    var updated = events.stream(ChatMessageUpdatedEvent.class).toList();
    assertThat(updated).hasSize(1);
    assertThat(updated.get(0).messageId()).isEqualTo(msg.id());
    assertThat(updated.get(0).threadId()).isEqualTo(thread.threadId());
    assertThat(updated.get(0).body()).isEqualTo("new body");
  }

  @Test
  void create_afterIssueSoftDeleted_throws() {
    // #621: 이슈 소프트삭제 후에는 기존에 조회해둔 threadId 로도 메시지 전송이 막혀야 한다
    // (스레드 자체는 이슈와 별개 row 로 남아 threadId 조회는 여전히 유효하기 때문).
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    issueRepository.softDelete(s.issueId(), Instant.now());

    assertThatThrownBy(
            () ->
                messageService.create(
                    s.reporterId(), thread.threadId(), new CreateChatMessageRequest("hi")))
        .isInstanceOf(ChatThreadIssueDeletedException.class);
  }

  @Test
  void notifyTyping_publishesTypingEvent() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    messageService.notifyTyping(s.reporterId(), thread.threadId());

    var typing = events.stream(ChatThreadTypingEvent.class).toList();
    assertThat(typing).hasSize(1);
    assertThat(typing.get(0).threadId()).isEqualTo(thread.threadId());
    assertThat(typing.get(0).actor().id()).isEqualTo(s.reporterId());
  }

  @Test
  void createFromReport_는_question_을_저장하고_생성이벤트에_싣고_사람답_이벤트는_내지_않는다() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    ChatMessageResponse msg =
        messageService.createFromReport(s.reporterId(), thread.threadId(), "진행 보고", true);

    assertThat(msg.question()).isTrue();
    var created = events.stream(ChatMessageCreatedEvent.class).toList();
    assertThat(created).hasSize(1);
    assertThat(created.get(0).question()).isTrue();
    // WP-452: 알림이 질문 글을 가려내도록 경로가 이벤트에 실린다.
    assertThat(created.get(0).origin()).isEqualTo(ChatMessageOrigin.REPORT_QUESTION);
    // 보고 경로는 작성자가 사람이어도 "사람의 답"이 아니다.
    assertThat(events.stream(IssueHumanReplyPosted.class).count()).isZero();
  }

  @Test
  void 사람의_일반_create_는_사람답_이벤트를_낸다() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    messageService.create(s.reporterId(), thread.threadId(), new CreateChatMessageRequest("답"));
    assertThat(events.stream(IssueHumanReplyPosted.class).count()).isEqualTo(1L);
    assertThat(events.stream(ChatMessageCreatedEvent.class).findFirst().orElseThrow().question())
        .isFalse();
    assertThat(events.stream(ChatMessageCreatedEvent.class).findFirst().orElseThrow().origin())
        .isEqualTo(ChatMessageOrigin.USER);
  }

  @Test
  void createFromReport_진행보고는_REPORT_경로로_이벤트에_싣는다() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    messageService.createFromReport(s.reporterId(), thread.threadId(), "진행 보고", false);
    var e = events.stream(ChatMessageCreatedEvent.class).findFirst().orElseThrow();
    assertThat(e.origin()).isEqualTo(ChatMessageOrigin.REPORT);
    assertThat(e.question()).isFalse();
  }
}
