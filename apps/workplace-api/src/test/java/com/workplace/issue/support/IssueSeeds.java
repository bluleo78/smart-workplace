package com.workplace.issue.support;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.ProjectStatusRow;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.ProjectStatusRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import org.jooq.DSLContext;

/**
 * 테스트 이슈 시드 헬퍼(WP-937) — 예전에 운영 {@link IssueRepository} 에 있던 범주 전용 insert(7인자)·updateAll(9인자) 호환
 * 오버로드를 테스트 쪽으로 옮겼다. 운영 코드는 상태 id 를 받는 정식 insert/updateAll 만 쓰므로, 테스트 편의(유형 TASK·범주 기본 상태 자동 결정)를
 * 운영 API 에 남겨 둘 이유가 없다.
 *
 * <p>인자 순서는 옛 오버로드와 같아 호출부의 의미가 바뀌지 않는다 — 앞에 리포지토리와 DSLContext 만 더 받는다.
 */
public final class IssueSeeds {

  private IssueSeeds() {}

  /**
   * TASK 유형·할 일(TODO) 기본 상태로 이슈를 만든다 — 옛 7인자 insert 와 같다. 부모·시작일·마일스톤은 비운다. 응답 행의 상태 이름·색도 옛 경로처럼
   * 채운다(INSERT RETURNING 에 조인 컬럼이 없어 정식 insert 가 받아서 채운다).
   */
  public static IssueRow insert(
      IssueRepository issues,
      DSLContext dsl,
      Long projectId,
      int number,
      String title,
      String body,
      String priority,
      LocalDate dueDate,
      Long reporterId) {
    Long taskTypeId =
        dsl.select(ISSUE_TYPE_DEF.ID)
            .from(ISSUE_TYPE_DEF)
            .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(projectId).and(ISSUE_TYPE_DEF.NAME.eq("TASK")))
            .fetchOptional(ISSUE_TYPE_DEF.ID)
            .orElseThrow(
                () -> new IllegalStateException("프로젝트에 TASK 유형이 없음: projectId=" + projectId));
    // 할 일 범주의 기본 상태 — 운영과 같은 규칙(findDefault)으로 고르고 이름·색까지 정식 insert 에 넘긴다
    ProjectStatusRow status =
        defaultStatus(dsl, projectId, IssueStatuses.TODO)
            .orElseThrow(() -> new IllegalStateException("프로젝트에 TODO 범주 상태가 없음"));
    return issues.insert(
        projectId,
        number,
        title,
        body,
        priority,
        dueDate,
        reporterId,
        taskTypeId,
        null,
        null,
        null,
        IssueStatuses.TODO,
        status.id(),
        status.name(),
        status.color(),
        null);
  }

  /** 범주만으로 모든 변경 가능 필드를 갱신한다 — 옛 9인자 updateAll 과 같다. 이미 그 범주면 지금 상태를 유지하고, 아니면 그 범주의 기본 상태로 간다. */
  public static void updateAll(
      IssueRepository issues,
      DSLContext dsl,
      Long id,
      String title,
      String body,
      String status,
      String priority,
      LocalDate dueDate,
      LocalDate startDate,
      Long milestoneId,
      Instant closedAt) {
    // 범주는 필수다 — null 이면 비교·기본 상태 조회가 엉뚱한 오류로 새지 않게 이유를 밝혀 거절한다
    if (status == null) {
      throw new IllegalArgumentException("updateAll: 상태 범주(status)는 null 일 수 없습니다: issue " + id);
    }
    var current =
        dsl.select(ISSUE.PROJECT_ID, ISSUE.STATUS, ISSUE.STATUS_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(id))
            .fetchOptional()
            .orElseThrow(() -> new IllegalStateException("이슈 없음: " + id));
    long statusId =
        status.equals(current.value2())
            ? current.value3()
            : defaultStatus(dsl, current.value1(), status)
                .map(ProjectStatusRow::id)
                .orElseThrow(() -> new IllegalStateException("프로젝트에 " + status + " 범주 상태가 없음"));
    issues.updateAll(
        id, title, body, status, statusId, priority, dueDate, startDate, milestoneId, closedAt);
  }

  /**
   * 범주의 기본 상태 — 운영 {@link ProjectStatusRepository#findDefault} 를 그대로 쓴다(규칙의 주인은 운영 쪽). 호출자가 넘긴
   * DSLContext(테넌트 범위)로 읽도록 그 컨텍스트로 리포지토리를 만든다.
   */
  private static Optional<ProjectStatusRow> defaultStatus(
      DSLContext dsl, Long projectId, String category) {
    return new ProjectStatusRepository(dsl).findDefault(projectId, category);
  }
}
