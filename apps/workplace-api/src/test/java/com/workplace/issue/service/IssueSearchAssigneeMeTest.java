package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.service.ChatFixtures;
import com.workplace.support.IntegrationTestBase;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** assignee=me 리터럴이 호출자 ID 로 치환되는지 검증. */
@Transactional
class IssueSearchAssigneeMeTest extends IntegrationTestBase {

  @Autowired IssueSearchService searchService;
  @Autowired ChatFixtures fx;

  @Test
  void assigneeMe_returnsIssuesAssignedToCaller() {
    // fx.setup(): reporter 가 프로젝트/이슈 생성, assignee 사용자가 그 이슈에 배정됨.
    ChatFixtures.Setup s = fx.setup();

    // 배정자(assignee) 관점: assignee=me → 본인이 배정된 이슈 1건.
    var asAssignee = searchService.search(s.assigneeId(), s.projectKey(), Map.of("assignee", "me"));
    assertThat(asAssignee.items()).hasSize(1);

    // reporter 는 그 이슈의 배정자가 아님 → assignee=me 결과 0건.
    var asReporter = searchService.search(s.reporterId(), s.projectKey(), Map.of("assignee", "me"));
    assertThat(asReporter.items()).isEmpty();
  }
}
