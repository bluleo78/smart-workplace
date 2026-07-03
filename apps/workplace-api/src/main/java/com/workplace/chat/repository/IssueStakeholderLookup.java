package com.workplace.chat.repository;

import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;

import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
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

  /** 프로젝트 멤버 여부. chat thread 접근 권한 게이트. */
  public boolean isProjectMember(long projectId, long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(PROJECT_MEMBER)
            .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId))));
  }

  /**
   * 프로젝트가 OPEN 유형인지 — 채팅 스레드 조회 개방 판정용. chat 모듈이 project 도메인을 import 하지 않도록 jOOQ 로 직접 조회한다(모듈 경계
   * 유지). 조회 개방일 뿐, 메시지 작성은 여전히 스레드 멤버십(ChatMessageService.ensureMember)으로 제어된다.
   */
  public boolean isOpenProject(long projectId) {
    return dsl.fetchExists(
        dsl.selectOne().from(PROJECT).where(PROJECT.ID.eq(projectId).and(PROJECT.TYPE.eq("OPEN"))));
  }

  /** 이슈의 assignee user.id 목록. */
  public List<Long> findAssignees(long issueId) {
    return dsl.select(ISSUE_ASSIGNEE.USER_ID)
        .from(ISSUE_ASSIGNEE)
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId))
        .fetch(r -> r.get(ISSUE_ASSIGNEE.USER_ID));
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
