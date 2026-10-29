package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.tenant.WorkspaceActive;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
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

  /** 담당자가 이 워크스페이스에서 활성인가(WP-1080) — 정지·전역 비활성이면 false 라 화면이 「비활성」으로 구분한다. */
  private static final Field<Boolean> ACTIVE = WorkspaceActive.field();

  /** 이슈에 부착된 담당자 요약을 USER 조인으로 조회. name 오름차순. */
  public List<UserSummary> findByIssue(Long issueId) {
    return dsl.select(USER.ID, USER.USERNAME, USER.NAME, USER.KIND, ACTIVE)
        .from(ISSUE_ASSIGNEE)
        .join(USER)
        .on(USER.ID.eq(ISSUE_ASSIGNEE.USER_ID))
        // 멤버십은 RLS 밖 전역 테이블이라 담당 행의 테넌트로 붙인다(WorkspaceActive 참조).
        .leftJoin(MEMBERSHIP)
        .on(WorkspaceActive.join(ISSUE_ASSIGNEE.USER_ID, ISSUE_ASSIGNEE.TENANT_ID))
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId))
        .orderBy(USER.NAME.asc())
        .fetch(IssueAssigneeRepository::toSummary);
  }

  /** issueIds 일괄 — issueId 별 UserSummary 리스트 (N+1 회피). 입력에 있는 모든 id 키를 보장한다. */
  public Map<Long, List<UserSummary>> findByIssueIds(List<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    var rows =
        dsl.select(ISSUE_ASSIGNEE.ISSUE_ID, USER.ID, USER.USERNAME, USER.NAME, USER.KIND, ACTIVE)
            .from(ISSUE_ASSIGNEE)
            .join(USER)
            .on(USER.ID.eq(ISSUE_ASSIGNEE.USER_ID))
            .leftJoin(MEMBERSHIP)
            .on(WorkspaceActive.join(ISSUE_ASSIGNEE.USER_ID, ISSUE_ASSIGNEE.TENANT_ID))
            .where(ISSUE_ASSIGNEE.ISSUE_ID.in(issueIds))
            .orderBy(USER.NAME.asc())
            .fetch();
    Map<Long, List<UserSummary>> result = new HashMap<>();
    for (Long id : issueIds) result.put(id, new ArrayList<>());
    for (var r : rows) {
      result.get(r.get(ISSUE_ASSIGNEE.ISSUE_ID)).add(toSummary(r));
    }
    return result;
  }

  /** 담당자 행 → 요약(활성 여부 포함). */
  private static UserSummary toSummary(Record r) {
    return new UserSummary(
        r.get(USER.ID),
        r.get(USER.USERNAME),
        r.get(USER.NAME),
        r.get(USER.KIND),
        Boolean.TRUE.equals(r.get(ACTIVE)));
  }

  /** 그 담당 행을 만든 사람(assigned_by). 담당 행이 없거나 기록이 없으면 비어 있다 — AI 작업 검토 요청·실패 알림(WP-913)의 수신자 후보. */
  public Optional<Long> findAssignedBy(long issueId, long userId) {
    return Optional.ofNullable(
        dsl.select(ISSUE_ASSIGNEE.ASSIGNED_BY)
            .from(ISSUE_ASSIGNEE)
            .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId).and(ISSUE_ASSIGNEE.USER_ID.eq(userId)))
            .fetchOne(ISSUE_ASSIGNEE.ASSIGNED_BY));
  }

  /**
   * 단건 추가. 동일 (issue,user) 충돌 시 no-op. 담당이 된 시각(created_at)은 컬럼 기본값(DB now())으로 둔다 — 「담당이 된 뒤 달린 글」
   * 판정(WP-719)이 DB 기본값으로 찍히는 댓글·이슈 챗 글 시각과 비교하므로 같은 시계여야 한다. 앱 시계로 넣으면 DB 시계가 조금만 늦어도 담당 직후 글이 「맡기
   * 전 글」로 빠진다.
   */
  public void add(Long issueId, Long userId, Long assignedBy) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, assignedBy)
        .onConflictDoNothing()
        .execute();
  }

  /** 단건 제거. */
  public void remove(Long issueId, Long userId) {
    dsl.deleteFrom(ISSUE_ASSIGNEE)
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId).and(ISSUE_ASSIGNEE.USER_ID.eq(userId)))
        .execute();
  }

  /** 담당에서 빠진 (이슈, 사람) 한 쌍. */
  public record Removed(long issueId, long userId) {}

  /**
   * 프로젝트 멤버에서 빠진 사람들을 그 프로젝트 이슈의 담당자에서 한 문장으로 뺀다(#714) — 「담당자는 늘 프로젝트 멤버」를 지킨다. 부서가 빠져 여러 명이 한꺼번에
   * 나가도 사람 수만큼 지우지 않는다(WP-1129).
   *
   * @return 빠진 (이슈, 사람) 쌍 — 사람 id·이슈 id 순(이력을 늘 같은 순서로 남기게)
   */
  public List<Removed> removeByProjectAndUsers(Long projectId, Collection<Long> userIds) {
    if (userIds.isEmpty()) return List.of();
    return dsl
        .deleteFrom(ISSUE_ASSIGNEE)
        .where(
            ISSUE_ASSIGNEE.USER_ID.in(userIds),
            ISSUE_ASSIGNEE.ISSUE_ID.in(
                dsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId))))
        .returning(ISSUE_ASSIGNEE.ISSUE_ID, ISSUE_ASSIGNEE.USER_ID)
        .fetch(r -> new Removed(r.getIssueId(), r.getUserId()))
        .stream()
        .sorted(Comparator.comparingLong(Removed::userId).thenComparingLong(Removed::issueId))
        .toList();
  }

  /** 프로젝트에서 이 사용자가 담당 중인 (삭제되지 않은) 이슈 수 — 멤버 제거 확인창의 영향 안내(WP-488). */
  public int countByProjectAndUser(Long projectId, Long userId) {
    return dsl.fetchCount(
        ISSUE_ASSIGNEE.join(ISSUE).on(ISSUE.ID.eq(ISSUE_ASSIGNEE.ISSUE_ID)),
        ISSUE_ASSIGNEE.USER_ID.eq(userId),
        ISSUE.PROJECT_ID.eq(projectId),
        ISSUE.DELETED_AT.isNull());
  }
}
