package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.exception.InvalidIssueFilterException;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.label.service.LabelService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * #841: 이슈 검색 필터가 라벨·유형 이름과 username 을 해석하고, 해석 불가 값은 조용히 버리지 않고 400(InvalidIssueFilterException)으로
 * 거부하는지 검증한다. 예전엔 숫자가 아닌 토큰을 무시해 "필터가 빠진 결과"를 AI 가 정답으로 보고했다.
 */
@Transactional
class IssueSearchFilterNamesTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueSearchService searchService;
  @Autowired IssueLabelService issueLabelService;
  @Autowired LabelService labelService;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueAssigneeRepository assigneeRepository;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired ProjectService projectService;

  /** 사용자 생성 + 기본 테넌트 멤버십. withMembership=false 면 테넌트 밖 사용자(username 해석 대상 아님). */
  private record TestUser(Long id, String username) {}

  private TestUser createUser(String prefix, boolean withMembership) {
    String username = prefix + "-" + UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, username + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    if (withMembership) {
      dsl.insertInto(MEMBERSHIP)
          .set(MEMBERSHIP.USER_ID, id)
          .set(MEMBERSHIP.TENANT_ID, defaultTenantId())
          .set(MEMBERSHIP.STATUS, "ACTIVE")
          .execute();
    }
    return new TestUser(id, username);
  }

  private ProjectResponse newProject(Long ownerId, String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = (prefix + suffix).substring(0, Math.min(10, prefix.length() + 4));
    return projectService.create(ownerId, new CreateProjectRequest(key, "P-" + prefix, "x"));
  }

  @Test
  void label_name_filter_matches_case_insensitively_with_and_semantics() {
    TestUser owner = createUser("fl", true);
    ProjectResponse p = newProject(owner.id(), "FLA");
    var bug = labelService.create(owner.id(), p.key(), new CreateLabelRequest("Bug", "RED"));
    var docs = labelService.create(owner.id(), p.key(), new CreateLabelRequest("문서", "BLUE"));
    issueRepository.insert(p.id(), 1, "both", null, "MID", null, owner.id());
    issueRepository.insert(p.id(), 2, "bug-only", null, "MID", null, owner.id());
    issueLabelService.replace(owner.id(), p.key(), 1, List.of(bug.id(), docs.id()));
    issueLabelService.replace(owner.id(), p.key(), 2, List.of(bug.id()));

    var byOne = searchService.search(owner.id(), p.key(), Map.of("label", "bug"));
    var byBoth = searchService.search(owner.id(), p.key(), Map.of("label", "BUG,문서"));

    assertThat(byOne.items()).extracting(i -> i.number()).containsExactlyInAnyOrder(1, 2);
    assertThat(byBoth.items()).extracting(i -> i.number()).containsExactly(1);
  }

  @Test
  void unknown_label_name_is_rejected_with_available_names() {
    TestUser owner = createUser("fu", true);
    ProjectResponse p = newProject(owner.id(), "FLU");
    labelService.create(owner.id(), p.key(), new CreateLabelRequest("버그", "RED"));

    assertThatThrownBy(() -> searchService.search(owner.id(), p.key(), Map.of("label", "없는라벨")))
        .isInstanceOf(InvalidIssueFilterException.class)
        .hasMessageContaining("없는라벨")
        .hasMessageContaining("버그")
        .satisfies(
            e -> assertThat(((InvalidIssueFilterException) e).getField()).isEqualTo("label"));
  }

  @Test
  void numeric_label_id_still_passes_through() {
    TestUser owner = createUser("fn", true);
    ProjectResponse p = newProject(owner.id(), "FLN");
    var bug = labelService.create(owner.id(), p.key(), new CreateLabelRequest("버그", "RED"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner.id());
    issueLabelService.replace(owner.id(), p.key(), 1, List.of(bug.id()));

    var resp = searchService.search(owner.id(), p.key(), Map.of("label", String.valueOf(bug.id())));

    assertThat(resp.items()).hasSize(1);
  }

  @Test
  void type_name_filter_resolves_and_unknown_is_rejected() {
    TestUser owner = createUser("ft", true);
    ProjectResponse p = newProject(owner.id(), "FTY");
    var bugType = typeRepository.findByProjectAndName(p.id(), "BUG").orElseThrow();
    issueRepository.insert(p.id(), 1, "a-bug", null, "MID", null, owner.id());
    issueRepository.insert(p.id(), 2, "other", null, "MID", null, owner.id());
    dsl.update(ISSUE)
        .set(ISSUE.TYPE_ID, bugType.id())
        .where(ISSUE.PROJECT_ID.eq(p.id()).and(ISSUE.NUMBER.eq(1)))
        .execute();

    var resp = searchService.search(owner.id(), p.key(), Map.of("type", "bug"));

    assertThat(resp.items()).extracting(i -> i.number()).containsExactly(1);
    assertThatThrownBy(() -> searchService.search(owner.id(), p.key(), Map.of("type", "EPIC-X")))
        .isInstanceOf(InvalidIssueFilterException.class)
        .hasMessageContaining("BUG")
        .satisfies(e -> assertThat(((InvalidIssueFilterException) e).getField()).isEqualTo("type"));
  }

  @Test
  void assignee_and_reporter_resolve_username() {
    TestUser owner = createUser("fo", true);
    TestUser mate = createUser("fm", true);
    ProjectResponse p = newProject(owner.id(), "FAS");
    var mine = issueRepository.insert(p.id(), 1, "by-owner", null, "MID", null, owner.id());
    var mates = issueRepository.insert(p.id(), 2, "by-mate", null, "MID", null, mate.id());
    assigneeRepository.add(mates.id(), mate.id(), owner.id());

    var assigned =
        searchService.search(
            owner.id(), p.key(), Map.of("assignee", mate.username().toUpperCase()));
    var reported = searchService.search(owner.id(), p.key(), Map.of("reporter", owner.username()));

    assertThat(assigned.items()).extracting(i -> i.number()).containsExactly(2);
    assertThat(reported.items()).extracting(i -> i.number()).containsExactly(mine.number());
  }

  @Test
  void case_colliding_usernames_prefer_exact_match_else_reject_as_ambiguous() {
    TestUser owner = createUser("fk", true);
    String base = "case" + UUID.randomUUID().toString().substring(0, 6);
    // username UNIQUE 는 대소문자를 구분하므로 "X"·"x" 공존 가능 — 예전 구현은 여기서 500(중복 키) 이었다.
    TestUser upper = createNamedUser(base.toUpperCase());
    TestUser lower = createNamedUser(base);
    ProjectResponse p = newProject(owner.id(), "FKC");
    var i = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner.id());
    assigneeRepository.add(i.id(), lower.id(), owner.id());

    var exact = searchService.search(owner.id(), p.key(), Map.of("assignee", lower.username()));

    assertThat(exact.items()).extracting(it -> it.number()).containsExactly(1);
    assertThat(upper.id()).isNotEqualTo(lower.id());
    // 대소문자 섞인 제3의 표기는 어느 쪽과도 정확 일치하지 않고 둘 다와 무시 일치 → 모호성 400.
    String mixed = Character.toUpperCase(base.charAt(0)) + base.substring(1);
    assertThatThrownBy(() -> searchService.search(owner.id(), p.key(), Map.of("assignee", mixed)))
        .isInstanceOf(InvalidIssueFilterException.class)
        .hasMessageContaining("여러 구성원");
  }

  /** 지정 username 으로 테넌트 구성원 생성(대소문자 충돌 시나리오용). */
  private TestUser createNamedUser(String username) {
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, username)
            .set(USER.EMAIL, UUID.randomUUID() + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, defaultTenantId())
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return new TestUser(id, username);
  }

  @Test
  void unknown_or_foreign_tenant_username_is_rejected() {
    TestUser owner = createUser("fx", true);
    // 테넌트 멤버십이 없는 사용자 — 전역 user 테이블엔 있어도 해석되면 안 된다(존재 노출 금지).
    TestUser outsider = createUser("fz", false);
    ProjectResponse p = newProject(owner.id(), "FUX");

    assertThatThrownBy(() -> searchService.search(owner.id(), p.key(), Map.of("assignee", "홍길동")))
        .isInstanceOf(InvalidIssueFilterException.class)
        .satisfies(
            e -> assertThat(((InvalidIssueFilterException) e).getField()).isEqualTo("assignee"));
    assertThatThrownBy(
            () ->
                searchService.search(owner.id(), p.key(), Map.of("reporter", outsider.username())))
        .isInstanceOf(InvalidIssueFilterException.class)
        .satisfies(
            e -> assertThat(((InvalidIssueFilterException) e).getField()).isEqualTo("reporter"));
  }

  @Test
  void cross_project_label_name_matches_same_named_labels_in_every_member_project() {
    TestUser caller = createUser("fc", true);
    TestUser stranger = createUser("fs", true);
    ProjectResponse a = newProject(caller.id(), "FCA");
    ProjectResponse b = newProject(caller.id(), "FCB");
    ProjectResponse foreign = newProject(stranger.id(), "FCF");
    var la = labelService.create(caller.id(), a.key(), new CreateLabelRequest("공통", "RED"));
    var lb = labelService.create(caller.id(), b.key(), new CreateLabelRequest("공통", "RED"));
    labelService.create(stranger.id(), foreign.key(), new CreateLabelRequest("외부전용", "RED"));
    var ia = issueRepository.insert(a.id(), 1, "a", null, "MID", null, caller.id());
    var ib = issueRepository.insert(b.id(), 1, "b", null, "MID", null, caller.id());
    assigneeRepository.add(ia.id(), caller.id(), caller.id());
    assigneeRepository.add(ib.id(), caller.id(), caller.id());
    issueLabelService.replace(caller.id(), a.key(), 1, List.of(la.id()));
    issueLabelService.replace(caller.id(), b.key(), 1, List.of(lb.id()));

    // 동명 라벨이 두 프로젝트에 각각 있어도 그룹(OR)으로 풀려 둘 다 잡혀야 한다(AND 였다면 0건).
    var resp = searchService.searchMine(caller.id(), Map.of("assignee", "me", "label", "공통"));

    assertThat(resp.items())
        .extracting(i -> i.projectKey())
        .containsExactlyInAnyOrder(a.key(), b.key());
    // 해석 실패 메시지의 사용 가능 목록에 비멤버 프로젝트 라벨명이 새지 않는다.
    assertThatThrownBy(() -> searchService.searchMine(caller.id(), Map.of("label", "외부전용")))
        .isInstanceOf(InvalidIssueFilterException.class)
        .hasMessageEndingWith("사용 가능: 공통");
  }

  @Test
  void search_mine_with_project_key_is_scoped_to_that_project() {
    TestUser caller = createUser("fp", true);
    ProjectResponse a = newProject(caller.id(), "FPA");
    ProjectResponse b = newProject(caller.id(), "FPB");
    var ia = issueRepository.insert(a.id(), 1, "a", null, "MID", null, caller.id());
    var ib = issueRepository.insert(b.id(), 1, "b", null, "MID", null, caller.id());
    assigneeRepository.add(ia.id(), caller.id(), caller.id());
    assigneeRepository.add(ib.id(), caller.id(), caller.id());

    var resp =
        searchService.searchMine(caller.id(), Map.of("assignee", "me", "projectKey", a.key()));

    // 예전엔 projectKey 가 조용히 무시돼 두 프로젝트 이슈가 모두 반환됐다.
    assertThat(resp.items()).extracting(i -> i.projectKey()).containsExactly(a.key());
    assertThatThrownBy(() -> searchService.searchMine(caller.id(), Map.of("projectKey", "NOPE404")))
        .isInstanceOf(ProjectNotFoundException.class);
  }
}
