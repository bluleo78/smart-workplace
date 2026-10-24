package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.PROJECT_STATUS;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;

import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

/**
 * 7c: /me/issues 프로젝트 횡단 검색 테스트용 데이터 setup. caller 가 멤버인 두 프로젝트(A/B)와 비멤버 프로젝트(C)를 만들고, 세 프로젝트 모두에서
 * caller 를 담당자(ISSUE_ASSIGNEE)로 배정한다 — 멤버십 EXISTS 필터가 비멤버 프로젝트(C)를 누락시키는지 검증하기 위함. ChatFixtures 패턴을
 * 미러한다(USER 는 raw INSERT, 프로젝트/이슈는 production 서비스/리포지토리 경유).
 */
@Component
@RequiredArgsConstructor
public class MeIssuesTestFixtures {

  private final DSLContext dsl;
  private final ProjectService projectService;
  private final IssueRepository issueRepository;

  /**
   * caller 1명 + projectA/B(caller 멤버, 각 caller 담당 이슈 1건) + projectC(caller 비멤버, 그러나 caller 담당으로 보이는
   * 이슈 1건). projectA 이슈는 status=IN_PROGRESS, projectB 이슈는 status=TODO(default). projectC 는 다른
   * 사용자(owner)가 만들어 caller 를 멤버로 넣지 않는다.
   */
  public Setup twoProjectsOneForeign() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 6).toLowerCase();
    long caller = insertUser("me" + suffix);
    long other = insertUser("ot" + suffix);

    // projectA: caller 가 owner → 자동 project_member(OWNER) + system types 시드. caller 담당 이슈
    // 1건(IN_PROGRESS).
    String keyA = "A" + suffix.substring(0, 4).toUpperCase();
    ProjectResponse projectA =
        projectService.create(caller, new CreateProjectRequest(keyA, "PA-" + suffix, "x"));
    var issueA =
        IssueSeeds.insert(
            issueRepository, dsl, projectA.id(), 1, "a-" + suffix, null, "MID", null, caller);
    insertAssignee(issueA.id(), caller, caller);
    setStatus(issueA.id(), "IN_PROGRESS");

    // projectB: caller 가 owner → 자동 멤버. caller 담당 이슈 1건(TODO default).
    String keyB = "B" + suffix.substring(0, 4).toUpperCase();
    ProjectResponse projectB =
        projectService.create(caller, new CreateProjectRequest(keyB, "PB-" + suffix, "x"));
    var issueB =
        IssueSeeds.insert(
            issueRepository, dsl, projectB.id(), 1, "b-" + suffix, null, "MID", null, caller);
    insertAssignee(issueB.id(), caller, caller);

    // projectC: other 가 owner → caller 는 비멤버. caller 담당으로 보이는 이슈 1건(멤버십 필터 검증용).
    String keyC = "C" + suffix.substring(0, 4).toUpperCase();
    ProjectResponse projectC =
        projectService.create(other, new CreateProjectRequest(keyC, "PC-" + suffix, "x"));
    var issueC =
        IssueSeeds.insert(
            issueRepository, dsl, projectC.id(), 1, "c-" + suffix, null, "MID", null, other);
    insertAssignee(issueC.id(), caller, other);

    return new Setup(caller, keyA, keyB, keyC, issueC.id());
  }

  // ---------------------------------------------------------------- WP-915 프로젝트 묶음 정렬 시드

  /** MockMvc(JWT) 로 부를 수 있는 사용자 — USER 역할까지 넣는다(역할이 없으면 인증 필터가 거절한다). */
  public long loginUser(String prefix) {
    long id = insertUser(prefix + UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8));
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  /** owner 가 소유한(자동 멤버) 새 프로젝트 — 키는 무작위라 테스트끼리 겹치지 않는다. */
  public ProjectRef project(long owner, String name) {
    String key =
        "G" + UUID.randomUUID().toString().replaceAll("-", "").substring(0, 5).toUpperCase();
    ProjectResponse p = projectService.create(owner, new CreateProjectRequest(key, name, "x"));
    return new ProjectRef(p.id(), p.key());
  }

  /**
   * 이슈 한 건 시드 — 마감·상태·담당자를 정하고, 수정 시각을 <b>마지막에</b> 직접 쓴다. 테스트 트랜잭션 안에서는 now() 가 고정이라 모든 행의
   * updated_at 이 같아지므로 정렬 검증에 필요한 시각을 명시한다. assignee 가 null 이면 담당자 없음.
   */
  public long issue(
      ProjectRef p,
      String title,
      long reporter,
      Long assignee,
      LocalDate due,
      String status,
      Instant updatedAt) {
    int number =
        dsl.select(org.jooq.impl.DSL.coalesce(org.jooq.impl.DSL.max(ISSUE.NUMBER), 0))
                .from(ISSUE)
                .where(ISSUE.PROJECT_ID.eq(p.id()))
                .fetchOne(0, Integer.class)
            + 1;
    long id =
        IssueSeeds.insert(issueRepository, dsl, p.id(), number, title, null, "MID", due, reporter)
            .id();
    if (assignee != null) insertAssignee(id, assignee, reporter);
    if (status != null) setStatus(id, status);
    dsl.update(ISSUE)
        .set(ISSUE.UPDATED_AT, updatedAt.atOffset(ZoneOffset.UTC))
        .where(ISSUE.ID.eq(id))
        .execute();
    return id;
  }

  /** 시드한 프로젝트의 id·key. */
  public record ProjectRef(long id, String key) {}

  /** USER 테이블에 최소 컬럼만 INSERT (kind/is_active 는 default). 비밀번호는 더미. */
  private long insertUser(String username) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, username)
        .set(USER.EMAIL, username + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private void insertAssignee(long issueId, long userId, long assignedBy) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, assignedBy)
        .execute();
  }

  /**
   * 이슈를 프로젝트의 사용자 정의 상태(WP-807·809)로 옮긴다 — 새 상태 행(이름·범주·색)을 만들고 이슈의 status_id·status(범주)를 함께 바꾼다.
   * 목록 정렬·완료 숨김이 상태 이름이 아니라 범주로 판정하는지, 응답이 상태 이름·색을 조인으로 싣는지(WP-870) 보는 시드다.
   */
  public void moveToCustomStatus(
      long issueId, ProjectRef p, String name, String category, String color) {
    int position =
        dsl.select(org.jooq.impl.DSL.coalesce(org.jooq.impl.DSL.max(PROJECT_STATUS.POSITION), 0))
                .from(PROJECT_STATUS)
                .where(PROJECT_STATUS.PROJECT_ID.eq(p.id()))
                .fetchOne(0, Integer.class)
            + 1;
    long statusId =
        dsl.insertInto(PROJECT_STATUS)
            .set(PROJECT_STATUS.PROJECT_ID, p.id())
            .set(PROJECT_STATUS.NAME, name)
            .set(PROJECT_STATUS.CATEGORY, category)
            .set(PROJECT_STATUS.POSITION, position)
            .set(PROJECT_STATUS.COLOR, color)
            .returning(PROJECT_STATUS.ID)
            .fetchOne()
            .getId();
    dsl.update(ISSUE)
        .set(ISSUE.STATUS_ID, statusId)
        .set(ISSUE.STATUS, category)
        .where(ISSUE.ID.eq(issueId))
        .execute();
  }

  /** 이슈 status 직접 변경 — 시드 편의용(production update 경로 우회). */
  private void setStatus(long issueId, String status) {
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, status)
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, status))
        .where(ISSUE.ID.eq(issueId))
        .execute();
  }

  /** twoProjectsOneForeign() 결과 — 테스트가 의존하는 식별자 묶음. */
  public record Setup(
      long callerId,
      String projectAKey,
      String projectBKey,
      String projectCKey,
      long foreignIssueId) {}
}
