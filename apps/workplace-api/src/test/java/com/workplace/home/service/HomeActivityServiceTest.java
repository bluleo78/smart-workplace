package com.workplace.home.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.service.ChatFixtures;
import com.workplace.home.dto.ActivityEntryResponse;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 내 담당/워치 이슈의 history 교차 조회 + actorKind 필터 + 소유 범위 검증. */
@Transactional
class HomeActivityServiceTest extends IntegrationTestBase {

  @Autowired HomeActivityService activityService;
  @Autowired IssueHistoryRepository historyRepo;
  @Autowired ChatFixtures fx;
  @Autowired DSLContext dsl;

  private long insertAgent(String username) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, username)
        .set(USER.EMAIL, username + "@example.com")
        .set(USER.KIND, "AGENT")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void activity_assignee_seesHistory_filteredByActorKind() {
    ChatFixtures.Setup s = fx.setup(); // 이슈는 assignee 배정됨
    long agentId = insertAgent("agent" + s.issueId());

    historyRepo.insert(s.issueId(), s.reporterId(), "STATUS", "TODO", "IN_PROGRESS"); // HUMAN
    historyRepo.insert(s.issueId(), agentId, "COMMENT", null, null); // AGENT

    List<ActivityEntryResponse> all =
        activityService.recent(s.assigneeId(), null, null, 20).items();
    assertThat(all).hasSize(2);
    assertThat(all.get(0).createdAt()).isAfterOrEqualTo(all.get(1).createdAt());

    List<ActivityEntryResponse> agentOnly =
        activityService.recent(s.assigneeId(), "AGENT", null, 20).items();
    assertThat(agentOnly).hasSize(1);
    assertThat(agentOnly.get(0).actorKind()).isEqualTo("AGENT");

    assertThat(activityService.recent(s.outsiderId(), null, null, 20).items()).isEmpty();
  }

  @Test
  void activity_watcher_seesHistory() {
    ChatFixtures.Setup s = fx.setup(); // 이슈는 watcher 도 워치 등록됨
    long agentId = insertAgent("agent" + s.issueId());

    historyRepo.insert(s.issueId(), s.reporterId(), "STATUS", "TODO", "IN_PROGRESS"); // HUMAN
    historyRepo.insert(s.issueId(), agentId, "COMMENT", null, null); // AGENT

    // 워처 관점에서도 동일 이슈 history 2건이 보인다.
    List<ActivityEntryResponse> watched =
        activityService.recent(s.watcherId(), null, null, 20).items();
    assertThat(watched).hasSize(2);
  }

  /** #622 — 이슈가 소프트삭제되면 해당 이슈의 history 는 활동 피드에서 제외된다(#618 알림·#621 채팅과 동일 패턴). */
  @Test
  void activity_excludesHistoryForSoftDeletedIssue() {
    ChatFixtures.Setup s = fx.setup();
    historyRepo.insert(s.issueId(), s.reporterId(), "STATUS", "TODO", "IN_PROGRESS");

    assertThat(activityService.recent(s.assigneeId(), null, null, 20).items()).hasSize(1);

    dsl.update(ISSUE)
        .set(ISSUE.DELETED_AT, OffsetDateTime.now())
        .where(ISSUE.ID.eq(s.issueId()))
        .execute();

    assertThat(activityService.recent(s.assigneeId(), null, null, 20).items()).isEmpty();
  }
}
