package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.service.IssueSearchService;
import com.workplace.support.IntegrationTestBase;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 7c: /me/issues 프로젝트 횡단 필터 검색 — assignee=me 가 여러 프로젝트를 한 번에, 비멤버 프로젝트는 누락. */
@Transactional
class MeIssuesSearchTest extends IntegrationTestBase {

  @Autowired IssueSearchService searchService;
  @Autowired MeIssuesTestFixtures fx;

  @Test
  void assigneeMe_crossesProjects_andRespectsMembership() {
    var s = fx.twoProjectsOneForeign();
    // s.callerId 는 projectA, projectB 의 멤버이며 각 프로젝트의 이슈 1건씩 담당.
    // s.foreignIssue 는 caller 가 멤버가 아닌 projectC 의 이슈(담당자는 caller 라도 누락돼야 함).

    var res = searchService.searchMine(s.callerId(), Map.of("assignee", "me"));

    assertThat(res.items()).hasSize(2);
    assertThat(res.items())
        .extracting(i -> i.projectKey())
        .containsExactlyInAnyOrder(s.projectAKey(), s.projectBKey());
    assertThat(res.items()).noneMatch(i -> i.projectKey().equals(s.projectCKey()));
  }

  @Test
  void statusFilter_appliesAcrossProjects() {
    var s = fx.twoProjectsOneForeign();
    // projectA 이슈만 IN_PROGRESS 로 시드되어 있다(fixture).
    var res =
        searchService.searchMine(s.callerId(), Map.of("assignee", "me", "status", "IN_PROGRESS"));

    assertThat(res.items()).hasSize(1);
    assertThat(res.items().get(0).projectKey()).isEqualTo(s.projectAKey());
  }
}
