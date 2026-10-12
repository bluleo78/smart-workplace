package com.workplace.issue.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.watcher.service.WatcherService;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-356 — 이슈 검색의 watching=true 필터. 호출자가 워치 중인 이슈만 남기고, 다른 필터·횡단 검색과 함께 쓸 수 있으며 응답은 일반 검색과 같은
 * 모양(담당자·유형 포함)이다.
 */
@Transactional
class IssueSearchServiceWatchingTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueSearchService searchService;
  @Autowired ProjectService projectService;
  @Autowired WatcherService watcherService;

  private Long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // 테넌트#1 ACTIVE 멤버십 — 프로젝트 멤버 추가가 대상의 테넌트 소속을 검증한다(#713).
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return prefix + suffix;
  }

  private static CreateIssueRequest titled(String title, String priority) {
    return new CreateIssueRequest(title, null, priority, null, null, null, null, null);
  }

  @Test
  void watching_returnsOnlyWatchedIssues_combinedWithOtherFilters() {
    Long owner = createUser("w-owner");
    Long viewer = createUser("w-viewer");
    String key = uniqueKey("WS");
    projectService.create(owner, new CreateProjectRequest(key, "Watch", "x"));
    projectService.addMember(owner, key, new AddMemberRequest(viewer, "MEMBER"));
    var high = issueService.create(owner, key, titled("high", "HIGH"));
    var low = issueService.create(owner, key, titled("low", "LOW"));
    issueService.create(owner, key, titled("unwatched", "HIGH"));
    watcherService.watch(viewer, key, high.number());
    watcherService.watch(viewer, key, low.number());

    // 프로젝트 검색 + 워치
    var watched = searchService.search(viewer, key, Map.of("watching", "true"));
    assertThat(watched.items()).extracting(i -> i.title()).containsExactlyInAnyOrder("high", "low");

    // 다른 필터(우선순위)와 AND
    var watchedHigh =
        searchService.search(viewer, key, Map.of("watching", "true", "priority", "HIGH"));
    assertThat(watchedHigh.items()).extracting(i -> i.title()).containsExactly("high");

    // 횡단 검색(/me/issues, projectKey 없음)에서도 같은 필터 — 응답은 일반 검색 모양(유형 포함)
    var mine = searchService.searchMine(viewer, Map.of("watching", "true"));
    assertThat(mine.items()).extracting(i -> i.title()).containsExactlyInAnyOrder("high", "low");
    assertThat(mine.items()).allSatisfy(i -> assertThat(i.type()).isNotNull());
  }

  @Test
  void watching_otherValues_doNotFilter() {
    Long owner = createUser("w2-owner");
    String key = uniqueKey("WT");
    projectService.create(owner, new CreateProjectRequest(key, "Watch2", "x"));
    issueService.create(owner, key, titled("a", null));

    // 생성자는 자동 워처지만, watching 이 true 가 아니면 필터가 걸리지 않는다.
    var all = searchService.search(owner, key, Map.of("watching", "false"));
    assertThat(all.items()).hasSize(1);
  }
}
