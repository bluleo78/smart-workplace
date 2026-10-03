package com.workplace.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.service.IssueCommentService;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 토크 쓰기 권한 = 댓글 작성 권한 (WP-213).
 *
 * <p>스레드가 만들어진 뒤 프로젝트에 합류했거나 이해관계자가 아닌 프로젝트 멤버도 메시지를 보낼 수 있고, 보내는 순간 대화에 자동 참여한다. 타이핑·첨부 선업로드는 쓰기
 * 권한만 확인하고 참여시키지 않는다. 댓글로 자동 구독되면 열린 대화의 멤버로도 추가된다.
 */
@RecordApplicationEvents
@Transactional
class ChatThreadWriteAccessTest extends IntegrationTestBase {

  @Autowired ChatMessageService messageService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatMessageAttachmentService attachmentService;
  @Autowired IssueCommentService commentService;
  @Autowired ChatFixtures fx;
  @Autowired ChatThreadMemberRepository memberRepo;
  @Autowired ProjectMemberRepository projectMemberRepo;
  @Autowired ApplicationEvents events;

  /** 스레드 생성 후 outsider 를 프로젝트 멤버로 합류시킨다 — 스레드 이해관계자가 아닌 프로젝트 멤버. */
  private long threadWithLateProjectMember(ChatFixtures.Setup s) {
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    projectMemberRepo.insert(s.projectId(), s.outsiderId(), "MEMBER");
    return thread.threadId();
  }

  @Test
  void projectMember_notInThread_canPost_andAutoJoins() {
    ChatFixtures.Setup s = fx.setup();
    long threadId = threadWithLateProjectMember(s);
    assertThat(memberRepo.isMember(threadId, s.outsiderId())).isFalse();
    // 화면 판정 플래그도 쓸 수 있다고 알려야 한다.
    assertThat(threadService.getOrCreate(s.outsiderId(), s.projectKey(), s.issueNumber()).canPost())
        .isTrue();

    var msg = messageService.create(s.outsiderId(), threadId, new CreateChatMessageRequest("hi"));

    assertThat(msg.id()).isNotNull();
    assertThat(memberRepo.isMember(threadId, s.outsiderId())).isTrue();
  }

  @Test
  void projectMember_notInThread_typing_isAllowed_withoutJoining() {
    ChatFixtures.Setup s = fx.setup();
    long threadId = threadWithLateProjectMember(s);

    assertThatCode(() -> messageService.notifyTyping(s.outsiderId(), threadId))
        .doesNotThrowAnyException();

    assertThat(events.stream(ChatThreadTypingEvent.class).count()).isEqualTo(1L);
    assertThat(memberRepo.isMember(threadId, s.outsiderId())).isFalse();
  }

  @Test
  void projectMember_notInThread_canUploadAttachment_withoutJoining() throws Exception {
    ChatFixtures.Setup s = fx.setup();
    long threadId = threadWithLateProjectMember(s);
    var file = new MockMultipartFile("files", "a.txt", "text/plain", "hello".getBytes());

    var uploaded = attachmentService.upload(s.outsiderId(), threadId, List.of(file));

    assertThat(uploaded).hasSize(1);
    assertThat(memberRepo.isMember(threadId, s.outsiderId())).isFalse();
  }

  @Test
  void projectMember_notInThread_canListMessages_andMarkReadIsNoop() {
    ChatFixtures.Setup s = fx.setup();
    long threadId = threadWithLateProjectMember(s);
    var msg = messageService.create(s.reporterId(), threadId, new CreateChatMessageRequest("hi"));

    var page = messageService.list(s.outsiderId(), threadId, null, 50);

    assertThat(page.items()).extracting(m -> m.id()).contains(msg.id());
    assertThatCode(() -> messageService.markRead(s.outsiderId(), threadId, msg.id()))
        .doesNotThrowAnyException();
    assertThat(memberRepo.isMember(threadId, s.outsiderId())).isFalse();
  }

  @Test
  void nonProjectMember_cannotPost_andIsNotJoined() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    assertThatThrownBy(
            () ->
                messageService.create(
                    s.outsiderId(), thread.threadId(), new CreateChatMessageRequest("x")))
        .isInstanceOf(ChatThreadNotMemberException.class);
    assertThatThrownBy(() -> messageService.notifyTyping(s.outsiderId(), thread.threadId()))
        .isInstanceOf(ChatThreadNotMemberException.class);
    assertThat(memberRepo.isMember(thread.threadId(), s.outsiderId())).isFalse();
  }

  @Test
  void commenting_afterThreadExists_addsCommenterAsThreadMember() {
    // WPV-5 재현: 스레드가 생긴 뒤 댓글을 단 사용자는 자동 구독되고, 대화 멤버로도 추가돼야 한다.
    ChatFixtures.Setup s = fx.setup();
    long threadId = threadWithLateProjectMember(s);

    commentService.create(s.outsiderId(), s.issueId(), new CreateCommentRequest("확인했습니다"));

    assertThat(memberRepo.isMember(threadId, s.outsiderId())).isTrue();
  }
}
