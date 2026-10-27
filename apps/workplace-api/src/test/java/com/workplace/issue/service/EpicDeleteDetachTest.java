package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 에픽·프로젝트 삭제가 하위를 지우지 않고 떼는지(WP-1038) 본다. 에픽 하위는 다른 프로젝트에 있을 수 있어, 에픽 삭제는 같은·다른 프로젝트 하위 모두 부모만 떼고
 * PARENT_CHANGED 이력을 남긴다. 일반 이슈 삭제는 예전처럼 하위 태스크를 함께 지운다. 프로젝트 삭제는 다른 프로젝트와 걸린 부모 관계를 두 방향 모두 뗀다.
 */
@Transactional
@RecordApplicationEvents
class EpicDeleteDetachTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired ProjectService projectService;
  @Autowired ApplicationEvents events;

  private Long owner;
  private ProjectResponse a;
  private ProjectResponse b;

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
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private ProjectResponse newProject(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(
        owner, new CreateProjectRequest(prefix + suffix, "P-" + prefix, "x", "TEAM"));
  }

  private long typeId(ProjectResponse p, String name) {
    return typeRepository.findByProjectAndName(p.id(), name).orElseThrow().id();
  }

  private IssueResponse create(
      ProjectResponse p, String title, Long typeId, Integer parentNumber, String parentKey) {
    return issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest(
            title,
            null,
            null,
            null,
            null,
            typeId,
            parentNumber,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            parentKey));
  }

  private IssueResponse epic(ProjectResponse p, String title) {
    return create(p, title, typeId(p, "EPIC"), null, null);
  }

  /** 행을 직접 읽는다 — 부모 id 와 삭제 여부. */
  private org.jooq.Record row(long id) {
    return dsl.select(ISSUE.PARENT_ISSUE_ID, ISSUE.DELETED_AT)
        .from(ISSUE)
        .where(ISSUE.ID.eq(id))
        .fetchOne();
  }

  private List<String> parentHistory(long issueId) {
    return dsl.select(ISSUE_HISTORY.TO_VALUE)
        .from(ISSUE_HISTORY)
        .where(ISSUE_HISTORY.ISSUE_ID.eq(issueId))
        .and(ISSUE_HISTORY.EVENT_TYPE.eq("PARENT_CHANGED"))
        .orderBy(ISSUE_HISTORY.ID.asc())
        .fetch(ISSUE_HISTORY.TO_VALUE);
  }

  @BeforeEach
  void seed() {
    owner = createUser("ed");
    a = newProject("EA");
    b = newProject("EB");
  }

  @Test
  void 에픽을_지우면_같은_프로젝트와_다른_프로젝트_하위가_남고_부모만_떨어진다() {
    var epic = epic(a, "지울 에픽");
    var same = create(a, "같은 프로젝트 하위", null, epic.number(), null);
    var other = create(b, "다른 프로젝트 하위", null, null, a.key() + "-" + epic.number());
    events.clear();

    issueService.softDelete(owner, a.key(), epic.number());

    assertThat(row(epic.id()).get(ISSUE.DELETED_AT)).isNotNull();
    for (var child : List.of(same, other)) {
      assertThat(row(child.id()).get(ISSUE.DELETED_AT)).isNull();
      assertThat(row(child.id()).get(ISSUE.PARENT_ISSUE_ID)).isNull();
      // 마지막 부모 변경 이력: from=지운 에픽(키 포함), to=없음.
      assertThat(parentHistory(child.id()))
          .last()
          .satisfies(
              v -> {
                assertThat(v).doesNotContain("\"to\":{");
                assertThat(v).contains("\"number\":" + epic.number());
                assertThat(v).contains("\"projectKey\":\"" + a.key() + "\"");
              });
    }
    // 다른 프로젝트 하위의 프로젝트에도 실시간 무효화가 나간다.
    assertThat(events.stream(ResourceChangedEvent.class))
        .anyMatch(e -> e.scopeId() == b.id() && e.ids().contains(other.id()));
    // 남은 하위는 상세에서도 부모가 없다.
    assertThat(issueService.get(owner, b.key(), other.number()).summary().parent()).isNull();
  }

  @Test
  void 일반_이슈를_지우면_하위_태스크는_예전처럼_함께_지워진다() {
    var parent = create(a, "부모", null, null, null);
    var sub = create(a, "하위 태스크", typeId(a, "SUBTASK"), parent.number(), null);

    issueService.softDelete(owner, a.key(), parent.number());

    assertThat(row(sub.id()).get(ISSUE.DELETED_AT)).isNotNull();
  }

  @Test
  void 프로젝트를_지우면_다른_프로젝트와_걸린_부모_관계를_두_방향_모두_뗀다() {
    var epicA = epic(a, "A 에픽");
    var epicB = epic(b, "B 에픽");
    // B 하위 → A 에픽, A 하위 → B 에픽, A 안의 관계.
    var bUnderA = create(b, "B 하위", null, null, a.key() + "-" + epicA.number());
    var aUnderB = create(a, "A 하위(B 에픽)", null, null, b.key() + "-" + epicB.number());
    var aUnderA = create(a, "A 하위(A 에픽)", null, epicA.number(), null);
    events.clear();

    projectService.softDelete(owner, a.key());

    assertThat(row(bUnderA.id()).get(ISSUE.PARENT_ISSUE_ID)).isNull();
    assertThat(row(aUnderB.id()).get(ISSUE.PARENT_ISSUE_ID)).isNull();
    assertThat(parentHistory(bUnderA.id())).last().asString().doesNotContain("\"to\":{");
    assertThat(parentHistory(aUnderB.id())).last().asString().doesNotContain("\"to\":{");
    // 지운 프로젝트 안의 관계는 그대로(프로젝트와 함께 사라진다).
    assertThat(row(aUnderA.id()).get(ISSUE.PARENT_ISSUE_ID)).isEqualTo(epicA.id());
    // B 쪽 화면 — 떨어진 B 하위와 하위 수가 줄어든 B 에픽 — 이 갱신된다.
    assertThat(events.stream(ResourceChangedEvent.class))
        .anyMatch(e -> e.scopeId() == b.id() && e.ids().contains(bUnderA.id()));
    assertThat(events.stream(ResourceChangedEvent.class))
        .anyMatch(e -> e.scopeId() == b.id() && e.ids().contains(epicB.id()));
    assertThat(issueService.get(owner, b.key(), epicB.number()).summary().childCount()).isZero();
  }
}
