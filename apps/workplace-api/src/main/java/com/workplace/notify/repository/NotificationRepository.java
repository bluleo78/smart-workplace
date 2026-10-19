package com.workplace.notify.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;

import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationType;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Query;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** notification jOOQ 리포지토리. 모든 조회/변경은 recipientId 스코프로 격리한다. */
@Repository
@RequiredArgsConstructor
public class NotificationRepository {

  private final DSLContext dsl;

  /**
   * 이슈의 사람(HUMAN) 관계자 id — 보고자 ∪ 담당자 ∪ 워처 중 kind=HUMAN 만(WP-452 AI 질문 알림 수신 후보). AGENT 는 알림을 읽을 사람이
   * 아니라 뺀다. issue·issue_assignee·issue_watcher 는 RLS 대상이라 테넌트 GUC 가 주입된 트랜잭션 안에서 호출해야 한다.
   */
  public List<Long> findHumanStakeholderIds(long issueId) {
    var stakeholders =
        dsl.select(ISSUE.REPORTER_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(issueId))
            .union(
                dsl.select(ISSUE_ASSIGNEE.USER_ID)
                    .from(ISSUE_ASSIGNEE)
                    .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId)))
            .union(
                dsl.select(ISSUE_WATCHER.USER_ID)
                    .from(ISSUE_WATCHER)
                    .where(ISSUE_WATCHER.ISSUE_ID.eq(issueId)));
    return dsl.select(USER.ID)
        .from(USER)
        .where(USER.ID.in(stakeholders).and(USER.KIND.eq("HUMAN")))
        .orderBy(USER.ID)
        .fetch(USER.ID);
  }

  /** 수신자별 1행씩 batch insert. created_at 은 DB default, read_at 은 null(안읽음). */
  public void insertBatch(
      List<Long> recipientIds, NotificationType type, Long actorId, long issueId, Long commentId) {
    List<Query> rows =
        recipientIds.stream()
            .map(
                rid ->
                    (Query)
                        dsl.insertInto(NOTIFICATION)
                            .set(NOTIFICATION.RECIPIENT_ID, rid)
                            .set(NOTIFICATION.ACTOR_ID, actorId)
                            .set(NOTIFICATION.TYPE, type.name())
                            .set(NOTIFICATION.ISSUE_ID, issueId)
                            .set(NOTIFICATION.COMMENT_ID, commentId))
            .toList();
    dsl.batch(rows).execute();
  }

  /**
   * 이벤트 기반 알림 1건 insert — actor 있음, issue_id null, event_id 사용. 초대(CALENDAR_INVITED)/RSVP 변경
   * (CALENDAR_RSVP_CHANGED) 등 캘린더 참석자 알림에 사용.
   */
  public void insertEventNotification(
      long recipientId, NotificationType type, Long actorId, long eventId) {
    dsl.insertInto(NOTIFICATION)
        .set(NOTIFICATION.RECIPIENT_ID, recipientId)
        .set(NOTIFICATION.ACTOR_ID, actorId)
        .set(NOTIFICATION.TYPE, type.name())
        .set(NOTIFICATION.EVENT_ID, eventId)
        .execute();
  }

  /** REMINDER 알림 1건 insert — actor/issue 없음(event_id 만), type=REMINDER, 안읽음. */
  public void insertReminder(long recipientId, long eventId) {
    dsl.insertInto(NOTIFICATION)
        .set(NOTIFICATION.RECIPIENT_ID, recipientId)
        .set(NOTIFICATION.TYPE, NotificationType.REMINDER.name())
        .set(NOTIFICATION.EVENT_ID, eventId)
        .execute();
  }

  /**
   * 최신순 알림 — issue·project(LEFT, 이슈 알림용), calendar_event(LEFT, REMINDER 용), user(actor, LEFT) 조인으로
   * 표시 필드 합성. 이슈/리마인더가 섞여 있으므로 issue 는 INNER 가 아닌 LEFT JOIN. 이슈가 소프트삭제되면(#618) notification 행은
   * CASCADE 없이 남지만 issue_id 가 가리키는 이슈는 죽은 링크이므로 목록에서 제외한다 (issue_id 가 null 인 리마인더/캘린더 알림은 LEFT JOIN
   * 매치가 없어 이 조건에 영향받지 않는다). offset 은 무한스크롤 페이지네이션(#610)용 — 정렬 기준(created_at desc, id desc)이 고정이라
   * 페이지 경계에서 안정적이다.
   */
  public List<NotificationResponse> listRecent(long recipientId, int limit, long offset) {
    return listRecent(recipientId, false, limit, offset);
  }

  /**
   * 받는 사람이 지금 볼 수 있는 이슈의 알림만(WP-491) — 프로젝트에서 빠진 사람에게 예전 알림이 이슈의 현재 제목을 계속 보여 주지 않게 한다.
   * recipientIsAdmin 은 ADMIN 의 비개인 프로젝트 우회(ProjectAccessGuard 와 같은 규칙)를 위해 호출측이 넘긴다.
   */
  public List<NotificationResponse> listRecent(
      long recipientId, boolean recipientIsAdmin, int limit, long offset) {
    return dsl.select(
            NOTIFICATION.ID,
            NOTIFICATION.TYPE,
            NOTIFICATION.ACTOR_ID,
            USER.NAME,
            USER.KIND,
            NOTIFICATION.ISSUE_ID,
            PROJECT.KEY,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            NOTIFICATION.COMMENT_ID,
            NOTIFICATION.EVENT_ID,
            CALENDAR_EVENT.TITLE,
            CALENDAR_EVENT.STARTS_AT,
            NOTIFICATION.READ_AT,
            NOTIFICATION.CREATED_AT)
        .from(NOTIFICATION)
        .leftJoin(ISSUE)
        .on(ISSUE.ID.eq(NOTIFICATION.ISSUE_ID))
        .leftJoin(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .leftJoin(CALENDAR_EVENT)
        .on(CALENDAR_EVENT.ID.eq(NOTIFICATION.EVENT_ID))
        .leftJoin(USER)
        .on(USER.ID.eq(NOTIFICATION.ACTOR_ID))
        .where(
            NOTIFICATION
                .RECIPIENT_ID
                .eq(recipientId)
                .and(ISSUE.DELETED_AT.isNull())
                .and(readableByRecipient(recipientId, recipientIsAdmin)))
        .orderBy(NOTIFICATION.CREATED_AT.desc(), NOTIFICATION.ID.desc())
        .limit(limit)
        .offset(offset)
        .fetch(
            r -> {
              OffsetDateTime created = r.get(NOTIFICATION.CREATED_AT);
              OffsetDateTime eventStart = r.get(CALENDAR_EVENT.STARTS_AT);
              return new NotificationResponse(
                  r.get(NOTIFICATION.ID),
                  r.get(NOTIFICATION.TYPE),
                  r.get(NOTIFICATION.ACTOR_ID),
                  r.get(USER.NAME),
                  r.get(USER.KIND),
                  r.get(NOTIFICATION.ISSUE_ID),
                  r.get(PROJECT.KEY),
                  r.get(ISSUE.NUMBER),
                  r.get(ISSUE.TITLE),
                  r.get(NOTIFICATION.COMMENT_ID),
                  r.get(NOTIFICATION.EVENT_ID),
                  r.get(CALENDAR_EVENT.TITLE),
                  eventStart == null ? null : eventStart.toInstant(),
                  r.get(NOTIFICATION.READ_AT) != null,
                  created == null ? null : created.toInstant());
            });
  }

  /** 안읽음 수. listRecent() 와 동일하게 소프트삭제된 이슈를 참조하는 알림은 제외한다(#618, 뱃지-목록 카운트 불일치 방지). */
  public long countUnread(long recipientId) {
    return countUnread(recipientId, false);
  }

  /** 안읽음 수 — 목록과 같은 조건(볼 수 없는 프로젝트의 이슈 알림 제외, WP-491)이라 뱃지와 목록이 어긋나지 않는다. */
  public long countUnread(long recipientId, boolean recipientIsAdmin) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(NOTIFICATION)
            .leftJoin(ISSUE)
            .on(ISSUE.ID.eq(NOTIFICATION.ISSUE_ID))
            .leftJoin(PROJECT)
            .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
            .where(
                NOTIFICATION
                    .RECIPIENT_ID
                    .eq(recipientId)
                    .and(NOTIFICATION.READ_AT.isNull())
                    .and(ISSUE.DELETED_AT.isNull())
                    .and(readableByRecipient(recipientId, recipientIsAdmin))));
  }

  /**
   * 이슈 알림이면 받는 사람이 그 프로젝트를 지금 볼 수 있어야 한다(WP-491) — ProjectAccessGuard.isReadable 과 같은 규칙: OPEN 은
   * 전원, TEAM 은 멤버 또는 ADMIN, PERSONAL 은 멤버(소유자)만. 이슈가 없는 알림(리마인더·캘린더)은 그대로 둔다. 쿼리는 ISSUE·PROJECT 를
   * LEFT JOIN 해야 한다.
   */
  private Condition readableByRecipient(long recipientId, boolean recipientIsAdmin) {
    return NOTIFICATION
        .ISSUE_ID
        .isNull()
        .or(
            projectReadableBy(
                DSL.val(recipientId),
                recipientIsAdmin ? DSL.trueCondition() : DSL.falseCondition()));
  }

  /**
   * 이슈 알림을 새로 만들 수신자 중 그 이슈의 프로젝트를 지금 볼 수 있는 사람만 남긴다(WP-501). 규칙은 목록 숨김(WP-491)과 같다 — 빠진 사람에게 알림 행을
   * 만들면 웹 푸시가 생성 시점의 이슈 제목을 그대로 실어 보낸다.
   */
  public List<Long> filterCanReadIssue(long issueId, Collection<Long> userIds) {
    if (userIds.isEmpty()) return List.of();
    Condition admin =
        DSL.exists(
            DSL.selectOne()
                .from(USER_ROLE)
                .join(ROLE)
                .on(ROLE.ID.eq(USER_ROLE.ROLE_ID))
                .where(USER_ROLE.USER_ID.eq(USER.ID), ROLE.NAME.eq("ADMIN")));
    return dsl.select(USER.ID)
        .from(USER)
        .join(ISSUE)
        .on(ISSUE.ID.eq(issueId))
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(USER.ID.in(userIds), projectReadableBy(USER.ID, admin))
        .fetch(USER.ID);
  }

  /**
   * ISSUE·PROJECT 가 조인된 쿼리에서 userId 가 그 프로젝트를 볼 수 있는가 — ProjectAccessGuard.isReadable 과 같은 규칙: OPEN
   * 은 전원, TEAM 은 멤버 또는 ADMIN, PERSONAL 은 멤버(소유자)만.
   */
  private static Condition projectReadableBy(Field<Long> userId, Condition isAdmin) {
    Condition member =
        DSL.exists(
            DSL.selectOne()
                .from(PROJECT_MEMBER)
                .where(
                    PROJECT_MEMBER.PROJECT_ID.eq(ISSUE.PROJECT_ID),
                    PROJECT_MEMBER.USER_ID.eq(userId)));
    return PROJECT.TYPE.eq("OPEN").or(PROJECT.TYPE.ne("PERSONAL").and(isAdmin)).or(member);
  }

  /** 단건 읽음 — recipient 스코프 + 이미 읽은 건 제외. 영향 행 수 반환(타인 id 면 0). */
  public int markRead(long recipientId, long id) {
    return dsl.update(NOTIFICATION)
        .set(NOTIFICATION.READ_AT, OffsetDateTime.now())
        .where(
            NOTIFICATION
                .ID
                .eq(id)
                .and(NOTIFICATION.RECIPIENT_ID.eq(recipientId))
                .and(NOTIFICATION.READ_AT.isNull()))
        .execute();
  }

  /** 본인 안읽음 전체 읽음. 영향 행 수 반환. */
  public int markAllRead(long recipientId) {
    return dsl.update(NOTIFICATION)
        .set(NOTIFICATION.READ_AT, OffsetDateTime.now())
        .where(NOTIFICATION.RECIPIENT_ID.eq(recipientId).and(NOTIFICATION.READ_AT.isNull()))
        .execute();
  }
}
