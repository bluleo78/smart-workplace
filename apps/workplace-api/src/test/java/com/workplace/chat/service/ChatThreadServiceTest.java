package com.workplace.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.ChatThreadResponse;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.repository.ChatThreadRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.support.IntegrationTestBase;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
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
  @Autowired ChatMessageService messageService;
  @Autowired DSLContext dsl;

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
    // 메시지가 없으면 이어 불러올 이전 페이지도 없다(WP-365).
    assertThat(r.recentHasMore()).isFalse();
    assertThat(r.recentNextCursor()).isNull();
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

  /** WP-365: 최근 메시지 뒤에 더 오래된 메시지가 있으면 다음 페이지 정보를 내려줘, 다시 연 챗에서 이전 대화를 이어 불러올 수 있다. */
  @Test
  void getOrCreate_moreThanRecentLimit_returnsNextPageOfOlderMessages() {
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    List<Long> sentIds = new ArrayList<>();
    for (int i = 0; i < 21; i++) {
      long id =
          messageService
              .create(s.reporterId(), threadId, new CreateChatMessageRequest("m" + i))
              .id();
      // 한 트랜잭션 안이라 created_at 이 모두 같다 — 실제 대화처럼 1초씩 벌려 커서의 시각 비교 경로를 탄다.
      dsl.execute(
          "UPDATE chat_message SET created_at = created_at - make_interval(secs => ?) WHERE id = ?",
          21 - i,
          id);
      sentIds.add(id);
    }

    var reopened = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    // 최근 20개만 실리고, 남은 가장 오래된 1개는 다음 페이지 커서로 이어 불러온다.
    assertThat(reopened.recentMessages()).hasSize(20);
    assertThat(reopened.recentHasMore()).isTrue();
    assertThat(reopened.recentNextCursor()).isNotNull();
    var older =
        messageService.list(s.reporterId(), threadId, reopened.recentNextCursor(), null, false, 20);
    assertThat(older.items()).extracting(ChatMessageResponse::id).containsExactly(sentIds.get(0));
    assertThat(older.hasMore()).isFalse();
  }
}
