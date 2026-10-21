package com.workplace.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.chat.exception.ChatMessageNotFoundException;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트에서 빠진 사람은 이슈 대화를 더 읽거나 쓸 수 없다 (WP-475).
 *
 * <p>스레드 멤버십은 추가만 되던 기록이라, 멤버십만 보고 통과시키면 제거된 사람이 대화를 계속 읽고 쓰고 파일을 올린다. 사람은 늘 프로젝트 권한으로 판정하고, 스레드
 * 멤버십 예외는 멘션으로 들어온 AGENT(프로젝트 비멤버)에게만 남긴다. 멤버 제거 때는 그 사람의 대화 멤버십도 함께 정리해 실시간 알림 대상에서도 빠지게 한다.
 */
@Transactional
class ChatRemovedProjectMemberAccessTest extends IntegrationTestBase {

  @Autowired ChatMessageService messageService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatMessageAttachmentService attachmentService;
  @Autowired ChatThreadMemberRepository memberRepo;
  @Autowired ProjectMemberRepository projectMemberRepo;
  @Autowired ProjectService projectService;
  @Autowired ChatFixtures fx;

  @Test
  void 스레드_멤버로_남아도_프로젝트에서_빠진_사람은_대화를_읽고_쓰고_올릴_수_없다() {
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    var own =
        messageService.create(s.assigneeId(), threadId, new CreateChatMessageRequest("제거 전 글"));
    assertThat(memberRepo.isMember(threadId, s.assigneeId())).isTrue();

    // 멤버십 정리와 무관하게 가드만으로 막혀야 한다 — 프로젝트 멤버 row 만 지운다.
    projectMemberRepo.delete(s.projectId(), s.assigneeId());
    long removed = s.assigneeId();

    assertThatThrownBy(() -> messageService.list(removed, threadId, null, null, false, null))
        .isInstanceOf(ChatThreadNotMemberException.class);
    assertThatThrownBy(
            () -> messageService.create(removed, threadId, new CreateChatMessageRequest("x")))
        .isInstanceOf(ChatThreadNotMemberException.class);
    assertThatThrownBy(() -> messageService.notifyTyping(removed, threadId))
        .isInstanceOf(ChatThreadNotMemberException.class);
    var file = new MockMultipartFile("files", "a.txt", "text/plain", "hello".getBytes());
    assertThatThrownBy(() -> attachmentService.upload(removed, threadId, List.of(file)))
        .isInstanceOf(ChatThreadNotMemberException.class);
    // 자기 옛 글도 이제 볼 수 없는 대화라 없는 메시지와 같게 404(WP-682).
    assertThatThrownBy(
            () -> messageService.update(removed, own.id(), new UpdateChatMessageRequest("수정")))
        .isInstanceOf(ChatMessageNotFoundException.class);
    assertThatThrownBy(() -> messageService.delete(removed, own.id()))
        .isInstanceOf(ChatMessageNotFoundException.class);
    assertThatThrownBy(() -> threadService.getOrCreate(removed, s.projectKey(), s.issueNumber()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void 프로젝트_멤버를_제거하면_그_프로젝트_이슈_대화의_멤버에서도_빠진다() {
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    assertThat(memberRepo.isMember(threadId, s.assigneeId())).isTrue();

    projectService.removeMember(s.reporterId(), s.projectKey(), s.assigneeId());

    assertThat(memberRepo.isMember(threadId, s.assigneeId())).isFalse();
    // 남은 사람의 멤버십은 그대로다.
    assertThat(memberRepo.isMember(threadId, s.watcherId())).isTrue();
  }

  @Test
  void 멘션으로_들어온_프로젝트_비멤버_AGENT_는_스레드_멤버로_계속_읽고_쓴다() {
    ChatFixtures.AgentSetup a = fx.setupWithAgent();
    ChatFixtures.Setup s = a.base();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    // 멘션 참여와 같은 상태 — 스레드 멤버이지만 프로젝트 멤버는 아니다.
    projectMemberRepo.delete(s.projectId(), a.agentId());
    memberRepo.insertIgnoreConflict(threadId, List.of(a.agentId()));

    assertThatCode(() -> messageService.list(a.agentId(), threadId, null, null, false, null))
        .doesNotThrowAnyException();
    assertThatCode(
            () -> messageService.create(a.agentId(), threadId, new CreateChatMessageRequest("답변")))
        .doesNotThrowAnyException();
  }
}
