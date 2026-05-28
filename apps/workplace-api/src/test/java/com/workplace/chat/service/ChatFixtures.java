package com.workplace.chat.service;

import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.USER;

import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

/**
 * chat 테스트용 데이터 setup. 각 호출마다 unique 프로젝트/이슈/사용자 4명(reporter/assignee/watcher/outsider) 생성. raw
 * USER 인서트를 제외하고 프로젝트/이슈는 production 서비스(ProjectService/IssueRepository)를 통해 만들어 system type 시드 등
 * cross-cutting 셋업 비용을 피한다.
 */
@Component
@RequiredArgsConstructor
public class ChatFixtures {

  private final DSLContext dsl;
  private final ProjectService projectService;
  private final ProjectMemberRepository memberRepository;
  private final IssueRepository issueRepository;

  /** 한 번의 setup 호출에 필요한 모든 row 를 만든다. */
  public Setup setup() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 6).toLowerCase();
    long reporter = insertUser("rep" + suffix);
    long assignee = insertUser("asg" + suffix);
    long watcher = insertUser("wat" + suffix);
    long outsider = insertUser("out" + suffix);

    String projectKey = "C" + suffix.substring(0, 4).toUpperCase();
    // reporter 를 owner 로 → 자동으로 project_member(OWNER) + system types 시드.
    ProjectResponse project =
        projectService.create(reporter, new CreateProjectRequest(projectKey, "P-" + suffix, "x"));
    long projectId = project.id();

    // assignee/watcher 도 project_member 로 등록 (outsider 는 제외).
    memberRepository.insert(projectId, assignee, "MEMBER");
    memberRepository.insert(projectId, watcher, "MEMBER");

    // TASK 타입을 자동 선택하는 7-인자 오버로드 사용.
    var issueRow = issueRepository.insert(projectId, 1, "t-" + suffix, null, "MID", null, reporter);
    long issueId = issueRow.id();

    insertAssignee(issueId, assignee, reporter);
    insertWatcher(issueId, watcher);

    return new Setup(reporter, assignee, watcher, outsider, projectKey, projectId, issueId, 1);
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

  private void insertWatcher(long issueId, long userId) {
    dsl.insertInto(ISSUE_WATCHER)
        .set(ISSUE_WATCHER.ISSUE_ID, issueId)
        .set(ISSUE_WATCHER.USER_ID, userId)
        .execute();
  }

  /** setup 결과를 테스트가 의존하는 모든 식별자 묶음으로 노출. */
  public record Setup(
      long reporterId,
      long assigneeId,
      long watcherId,
      long outsiderId,
      String projectKey,
      long projectId,
      long issueId,
      int issueNumber) {}
}
