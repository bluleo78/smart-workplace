package com.workplace.notify.push;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** 푸시 문구 조립용 표시 정보 조회. issue/project/calendar_event 는 RLS 대상 → 테넌트 GUC 가 주입된 트랜잭션 안에서 호출해야 한다. */
@Repository
@RequiredArgsConstructor
public class PushContentRepository {

  private final DSLContext dsl;

  /** 이슈 표시 정보(삭제된 이슈 제외). */
  public record IssueInfo(String projectKey, int number, String title) {}

  /** 이슈 표시 정보 조회 — 삭제됐으면 empty(호출측이 푸시 스킵 판단에 사용). */
  public Optional<IssueInfo> findIssue(long issueId) {
    return dsl.select(PROJECT.KEY, ISSUE.NUMBER, ISSUE.TITLE)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(ISSUE.ID.eq(issueId))
        .and(ISSUE.DELETED_AT.isNull())
        .fetchOptional(
            r -> new IssueInfo(r.get(PROJECT.KEY), r.get(ISSUE.NUMBER), r.get(ISSUE.TITLE)));
  }

  // calendar_event 는 soft-delete 컬럼이 없어(#865 조사) 별도 삭제 필터 없이 존재 여부만 확인한다.
  /** 일정 제목 조회 — 존재하지 않으면 empty. */
  public Optional<String> findEventTitle(long eventId) {
    return dsl.select(CALENDAR_EVENT.TITLE)
        .from(CALENDAR_EVENT)
        .where(CALENDAR_EVENT.ID.eq(eventId))
        .fetchOptional(CALENDAR_EVENT.TITLE);
  }

  /** 사용자 표시 이름 조회 — 행위자 문구(actor + label) 조립에 쓴다. */
  public Optional<String> findUserName(long userId) {
    return dsl.select(USER.NAME).from(USER).where(USER.ID.eq(userId)).fetchOptional(USER.NAME);
  }
}
