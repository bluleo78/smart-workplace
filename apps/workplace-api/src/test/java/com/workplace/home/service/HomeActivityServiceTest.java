package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.service.ChatFixtures;
import com.workplace.home.dto.ActivityEntryResponse;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.support.IntegrationTestBase;
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
}
