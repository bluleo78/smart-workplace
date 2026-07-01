package com.workplace.chat.repository;

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

  /** projectKey + number 로 이슈 id/reporter/project_id 조회. */
  public Optional<IssueRow> findIssue(String projectKey, int number) {
    return dsl.select(ISSUE.ID, ISSUE.REPORTER_ID, ISSUE.PROJECT_ID)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(PROJECT.KEY.eq(projectKey).and(ISSUE.NUMBER.eq(number)))
        .fetchOptional(
            r -> new IssueRow(r.get(ISSUE.ID), r.get(ISSUE.REPORTER_ID), r.get(ISSUE.PROJECT_ID)));
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
