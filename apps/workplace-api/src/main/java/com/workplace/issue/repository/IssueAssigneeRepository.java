package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.dto.UserSummary;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** issue_assignee N:M jOOQ 리포지토리. user 조인으로 응답 DTO 직접 구성. */
@Repository
@RequiredArgsConstructor
public class IssueAssigneeRepository {

  private final DSLContext dsl;

  /** 이슈에 부착된 담당자 user_id 목록 (변경 diff 계산용). */
  public List<Long> findUserIdsByIssue(Long issueId) {
    return dsl.select(ISSUE_ASSIGNEE.USER_ID)
        .from(ISSUE_ASSIGNEE)
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId))
        .fetch(ISSUE_ASSIGNEE.USER_ID);
  }

  /** 이슈에 부착된 담당자 요약을 USER 조인으로 조회. name 오름차순. */
  public List<UserSummary> findByIssue(Long issueId) {
    return dsl.select(USER.ID, USER.USERNAME, USER.NAME, USER.KIND)
        .from(ISSUE_ASSIGNEE)
        .join(USER)
        .on(USER.ID.eq(ISSUE_ASSIGNEE.USER_ID))
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId))
        .orderBy(USER.NAME.asc())
        .fetch(
            r ->
                new UserSummary(
                    r.get(USER.ID), r.get(USER.USERNAME), r.get(USER.NAME), r.get(USER.KIND)));
  }

  /** issueIds 일괄 — issueId 별 UserSummary 리스트 (N+1 회피). 입력에 있는 모든 id 키를 보장한다. */
  public Map<Long, List<UserSummary>> findByIssueIds(List<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    var rows =
        dsl.select(ISSUE_ASSIGNEE.ISSUE_ID, USER.ID, USER.USERNAME, USER.NAME, USER.KIND)
            .from(ISSUE_ASSIGNEE)
            .join(USER)
            .on(USER.ID.eq(ISSUE_ASSIGNEE.USER_ID))
            .where(ISSUE_ASSIGNEE.ISSUE_ID.in(issueIds))
            .orderBy(USER.NAME.asc())
            .fetch();
    Map<Long, List<UserSummary>> result = new HashMap<>();
    for (Long id : issueIds) result.put(id, new ArrayList<>());
    for (var r : rows) {
      result
          .get(r.get(ISSUE_ASSIGNEE.ISSUE_ID))
          .add(
              new UserSummary(
                  r.get(USER.ID), r.get(USER.USERNAME), r.get(USER.NAME), r.get(USER.KIND)));
    }
    return result;
  }

  /** 단건 추가. 동일 (issue,user) 충돌 시 no-op. */
  public void add(Long issueId, Long userId, Long assignedBy) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, assignedBy)
        .set(ISSUE_ASSIGNEE.CREATED_AT, OffsetDateTime.now())
        .onConflictDoNothing()
        .execute();
  }

  /** 단건 제거. */
  public void remove(Long issueId, Long userId) {
    dsl.deleteFrom(ISSUE_ASSIGNEE)
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId).and(ISSUE_ASSIGNEE.USER_ID.eq(userId)))
        .execute();
  }

  /**
   * 프로젝트 멤버 제거(#714) 시 호출 — 해당 프로젝트의 이슈들 중 대상 사용자가 담당자로 걸린 매핑을 모두 제거한다. AssigneePolicy 불변식("담당자는 항상
   * 프로젝트 멤버")을 멤버십 철회 시점에도 유지하기 위함 — 정리하지 않으면 제거된 사용자가 담당자로 남아 자신은 접근 불가한 유령 담당자 상태가 된다.
   */
  public void removeByProjectAndUser(Long projectId, Long userId) {
    dsl.deleteFrom(ISSUE_ASSIGNEE)
        .where(
            ISSUE_ASSIGNEE.USER_ID.eq(userId),
            ISSUE_ASSIGNEE.ISSUE_ID.in(
                dsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId))))
        .execute();
  }
}
