package com.workplace.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.chat.dto.ChatThreadResponse;
import com.workplace.chat.repository.ChatThreadRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.support.IntegrationTestBase;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** lazy 생성 idempotency + 권한 거부 + initial 멤버 채움 검증. */
@Transactional
class ChatThreadServiceTest extends IntegrationTestBase {

  @Autowired ChatThreadService threadService;
  @Autowired ChatThreadRepository threadRepo;
  @Autowired ChatFixtures fx;
  @Autowired IssueRepository issueRepository;

  @Test
  void getOrCreate_firstCall_createsThreadWithInitialMembers() {
    ChatFixtures.Setup s = fx.setup();
    ChatThreadResponse r =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    assertThat(r.threadId()).isNotNull();
    assertThat(r.issueId()).isEqualTo(s.issueId());
    assertThat(r.members())
        .extracting(m -> m.userId().longValue())
        .contains(s.reporterId(), s.assigneeId(), s.watcherId());
  }

  @Test
  void getOrCreate_secondCall_returnsSameThread() {
    ChatFixtures.Setup s = fx.setup();
    var first = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    var second = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    assertThat(second.threadId()).isEqualTo(first.threadId());
    assertThat(threadRepo.findIdByIssueId(s.issueId())).isPresent();
  }

  @Test
  void getOrCreate_nonProjectMember_throws() {
    ChatFixtures.Setup s = fx.setup();
    assertThatThrownBy(
            () -> threadService.getOrCreate(s.outsiderId(), s.projectKey(), s.issueNumber()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void getOrCreate_afterIssueSoftDeleted_throws() {
    // #621: 이슈 소프트삭제 후에는 스레드 조회/생성이 더 이상 성공하면 안 된다.
    ChatFixtures.Setup s = fx.setup();
    // 삭제 전에는 정상 조회되는지 먼저 확인(회귀 방지용 sanity check).
    var before = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    assertThat(before.threadId()).isPositive();

    issueRepository.softDelete(s.issueId(), Instant.now());

    assertThatThrownBy(
            () -> threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
