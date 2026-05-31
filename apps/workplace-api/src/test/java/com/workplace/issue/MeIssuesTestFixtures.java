package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.USER;

import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
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
    var issueA = issueRepository.insert(projectA.id(), 1, "a-" + suffix, null, "MID", null, caller);
    insertAssignee(issueA.id(), caller, caller);
    setStatus(issueA.id(), "IN_PROGRESS");

    // projectB: caller 가 owner → 자동 멤버. caller 담당 이슈 1건(TODO default).
    String keyB = "B" + suffix.substring(0, 4).toUpperCase();
    ProjectResponse projectB =
        projectService.create(caller, new CreateProjectRequest(keyB, "PB-" + suffix, "x"));
    var issueB = issueRepository.insert(projectB.id(), 1, "b-" + suffix, null, "MID", null, caller);
    insertAssignee(issueB.id(), caller, caller);

    // projectC: other 가 owner → caller 는 비멤버. caller 담당으로 보이는 이슈 1건(멤버십 필터 검증용).
    String keyC = "C" + suffix.substring(0, 4).toUpperCase();
    ProjectResponse projectC =
        projectService.create(other, new CreateProjectRequest(keyC, "PC-" + suffix, "x"));
    var issueC = issueRepository.insert(projectC.id(), 1, "c-" + suffix, null, "MID", null, other);
    insertAssignee(issueC.id(), caller, other);

    return new Setup(caller, keyA, keyB, keyC, issueC.id());
  }

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

  /** 이슈 status 직접 변경 — 시드 편의용(production update 경로 우회). */
  private void setStatus(long issueId, String status) {
    dsl.update(ISSUE).set(ISSUE.STATUS, status).where(ISSUE.ID.eq(issueId)).execute();
  }

  /** twoProjectsOneForeign() 결과 — 테스트가 의존하는 식별자 묶음. */
  public record Setup(
      long callerId,
      String projectAKey,
      String projectBKey,
      String projectCKey,
      long foreignIssueId) {}
}
