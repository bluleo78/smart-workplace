package com.workplace.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.chat.exception.ChatMessageAuthorMismatchException;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageUpdatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;

/** 메시지 CRUD + 권한 + 이벤트 발행 검증. */
@RecordApplicationEvents
class ChatMessageServiceTest extends IntegrationTestBase {

  @Autowired ChatMessageService messageService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatFixtures fx;
  @Autowired ChatThreadMemberRepository memberRepo;
  @Autowired ApplicationEvents events;

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
    var page = messageService.list(s.reporterId(), thread.threadId(), null, 50);
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
  void notifyTyping_publishesTypingEvent() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    messageService.notifyTyping(s.reporterId(), thread.threadId());

    var typing = events.stream(ChatThreadTypingEvent.class).toList();
    assertThat(typing).hasSize(1);
    assertThat(typing.get(0).threadId()).isEqualTo(thread.threadId());
    assertThat(typing.get(0).actor().id()).isEqualTo(s.reporterId());
  }
}
