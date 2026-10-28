package com.workplace.chat.repository;

import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.share.ProjectMembership;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;

/**
 * 이슈/프로젝트/watcher/assignee 의 read-only 조회. chat 모듈이 issue/project/watcher 모듈을 직접 import 하지 않도록 격리된
 * query helper.
 */
@Component
@RequiredArgsConstructor
public class IssueStakeholderLookup {

  private final DSLContext dsl;

  /** projectKey + number 로 이슈 id/reporter/project_id 조회. 삭제된 이슈는 조회되지 않는다(#621). */
  public Optional<IssueRow> findIssue(String projectKey, int number) {
    return dsl.select(ISSUE.ID, ISSUE.REPORTER_ID, ISSUE.PROJECT_ID)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(
            PROJECT.KEY.eq(projectKey).and(ISSUE.NUMBER.eq(number)).and(ISSUE.DELETED_AT.isNull()))
        .fetchOptional(
            r -> new IssueRow(r.get(ISSUE.ID), r.get(ISSUE.REPORTER_ID), r.get(ISSUE.PROJECT_ID)));
  }

  /**
   * thread_id 로 연결된 이슈가 삭제됐는지 확인. 스레드 자체는 이슈와 별개 row 로 남아있을 수 있으므로(#621), 메시지 전송처럼 threadId 만으로
   * 접근하는 경로에서 원본 이슈의 삭제 상태를 가드하는 데 쓴다. 이슈 row 자체가 없으면(정합성 깨짐) 안전하게 true(삭제된 것으로 간주).
   */
  public boolean isIssueDeletedByThreadId(long threadId) {
    // 살아있는(미삭제) 이슈가 연결돼 있으면 false, 없거나 삭제됐으면 true.
    // deleted_at 은 NULL 이 정상값이라 fetchOptional(mapper) 로 값을 꺼내면 "row 없음"과 "값이 null"을
    // 구별하지 못한다(Optional.ofNullable 붕괴) — WHERE 절 필터 + fetchExists 로 존재만 확인한다.
    return !dsl.fetchExists(
        dsl.selectOne()
            .from(CHAT_THREAD)
            .join(ISSUE)
            .on(ISSUE.ID.eq(CHAT_THREAD.ISSUE_ID))
            .where(CHAT_THREAD.ID.eq(threadId).and(ISSUE.DELETED_AT.isNull())));
  }

  /** 프로젝트 멤버 여부(직접 멤버 또는 멤버로 둔 조직도 부서의 구성원, WP-1057). chat thread 접근 권한 게이트. */
  public boolean isProjectMember(long projectId, long userId) {
    return dsl.fetchValue(
        DSL.select(DSL.field(ProjectMembership.isMember(DSL.val(projectId), DSL.val(userId)))));
  }

  /** 사용자가 AGENT(kind) 인지 — 스레드 경유 이슈 첨부 조회에서 멘션돼 참여한 에이전트만 허용하는 판정용(WP-244). */
  public boolean isAgentUser(long userId) {
    return dsl.fetchExists(
        dsl.selectOne().from(USER).where(USER.ID.eq(userId).and(USER.KIND.eq("AGENT"))));
  }

  /** 이슈의 assignee user.id 목록. */
  public List<Long> findAssignees(long issueId) {
    return dsl.select(ISSUE_ASSIGNEE.USER_ID)
        .from(ISSUE_ASSIGNEE)
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId))
        .fetch(r -> r.get(ISSUE_ASSIGNEE.USER_ID));
  }

  /**
   * 이슈 담당자 중 첫 외부 실행 AI(WP-373 — 작성창 안내 "멘션 없이 보내도 {이름}이 이어받아요"). 담당 지정 순서(created_at, user id)로 첫
   * 사람. 없으면 empty.
   */
  public Optional<UserSummary> findFirstExternalAgent(long issueId) {
    return dsl.select(USER.ID, USER.USERNAME, USER.NAME, USER.KIND)
        .from(ISSUE_ASSIGNEE)
        .join(USER)
        .on(USER.ID.eq(ISSUE_ASSIGNEE.USER_ID))
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId))
        .and(USER.KIND.eq("AGENT"))
        .and(USER.AGENT_RUNTIME.eq("EXTERNAL"))
        .orderBy(ISSUE_ASSIGNEE.CREATED_AT.asc(), USER.ID.asc())
        .limit(1)
        .fetchOptional(r -> new UserSummary(r.value1(), r.value2(), r.value3(), r.value4()));
  }

  /** 이슈의 watcher user.id 목록. */
  public List<Long> findWatchers(long issueId) {
    return dsl.select(ISSUE_WATCHER.USER_ID)
        .from(ISSUE_WATCHER)
        .where(ISSUE_WATCHER.ISSUE_ID.eq(issueId))
        .fetch(r -> r.get(ISSUE_WATCHER.USER_ID));
  }

  /** reporter + assignees + watchers 합집합. chat thread 초기 멤버 시드용. */
  public Set<Long> findInitialStakeholders(IssueRow issue) {
    Set<Long> ids = new HashSet<>();
    ids.add(issue.reporterId());
    ids.addAll(findAssignees(issue.id()));
    ids.addAll(findWatchers(issue.id()));
    return ids;
  }

  /** 이슈 핵심 식별자 묶음 (chat 가 issue 모듈을 import 하지 않기 위한 경량 record). */
  public record IssueRow(long id, long reporterId, long projectId) {}
}
