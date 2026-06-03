package com.workplace.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 수동 add/leave 권한 + non-member 거부 검증. */
@Transactional
class ChatMembershipServiceTest extends IntegrationTestBase {

  @Autowired ChatMembershipService membershipService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatThreadMemberRepository memberRepo;
  @Autowired ChatFixtures fx;

  @Test
  void add_byMember_outsiderRejected() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    // outsider 는 프로젝트 멤버가 아니므로 add 거부.
    assertThatThrownBy(
            () -> membershipService.add(s.reporterId(), thread.threadId(), s.outsiderId()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void leave_self_succeeds() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    membershipService.leave(s.assigneeId(), thread.threadId());

    assertThat(memberRepo.isMember(thread.threadId(), s.assigneeId())).isFalse();
  }

  @Test
  void add_byNonMember_throws() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    assertThatThrownBy(
            () -> membershipService.add(s.outsiderId(), thread.threadId(), s.assigneeId()))
        .isInstanceOf(ChatThreadNotMemberException.class);
  }
}
