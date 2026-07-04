package com.workplace.notify.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.service.CalendarService;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationType;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** NotificationRepository 통합 테스트 — insert/조회/읽음. 직접 호출이라 @Transactional 롤백. */
@Transactional
class NotificationRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationRepository repo;
  @Autowired CalendarService calendarService;

  private String tok() {
    return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
  }

  private long seedUser(String kind) {
    String s = tok();
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "nr_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Nr" + s)
        .set(USER.EMAIL, "nr_" + s + "@example.com")
        .set(USER.KIND, kind)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** project + issue 1건 시드 후 issueId 반환. */
  private long seedIssue(long ownerId, String title) {
    String s = tok();
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "N" + s.substring(0, 5))
            .set(PROJECT.NAME, "P" + s)
            .set(PROJECT.OWNER_ID, ownerId)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    // 새 프로젝트는 V10 백필 대상이 아니므로 issue_type_def 가 없다 → type_id(NOT NULL) 용 유형 1건 시드.
    long typeId =
        dsl.insertInto(ISSUE_TYPE_DEF)
            .set(ISSUE_TYPE_DEF.PROJECT_ID, projectId)
            .set(ISSUE_TYPE_DEF.NAME, "TASK")
            .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
            .set(ISSUE_TYPE_DEF.ICON, "Circle")
            .returning(ISSUE_TYPE_DEF.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(ISSUE)
        .set(ISSUE.PROJECT_ID, projectId)
        .set(ISSUE.NUMBER, 1)
        .set(ISSUE.TITLE, title)
        .set(ISSUE.REPORTER_ID, ownerId)
        .set(ISSUE.TYPE_ID, typeId)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  /** ownerId 의 일정 1건 시드 후 eventId 반환. V104 NOT NULL: calendar_id 필수 — 기본 캘린더 보장. */
  private long seedEvent(long ownerId, String title) {
    long calId = calendarService.ensureDefault(ownerId);
    var now = java.time.OffsetDateTime.now();
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.TITLE, title)
        .set(CALENDAR_EVENT.STARTS_AT, now.plusHours(1))
        .set(CALENDAR_EVENT.ENDS_AT, now.plusHours(2))
        .set(CALENDAR_EVENT.ALL_DAY, false)
        .set(CALENDAR_EVENT.CALENDAR_ID, calId)
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void insertReminder_then_listRecent_joinsEventFields_noIssue() {
    long recipient = seedUser("HUMAN");
    long eventId = seedEvent(recipient, "주간 회의");

    repo.insertReminder(recipient, eventId);

    NotificationResponse n = repo.listRecent(recipient, 20, 0).get(0);
    assertThat(n.type()).isEqualTo("REMINDER");
    assertThat(n.eventId()).isEqualTo(eventId);
    assertThat(n.eventTitle()).isEqualTo("주간 회의");
    assertThat(n.eventStartsAt()).isNotNull();
    assertThat(n.actorId()).isNull();
    assertThat(n.issueId()).isNull();
    assertThat(n.read()).isFalse();
    assertThat(repo.countUnread(recipient)).isEqualTo(1);
  }

  @Test
  void listRecent_mixesIssueAndReminder() {
    long recipient = seedUser("HUMAN");
    long actor = seedUser("HUMAN");
    long issueId = seedIssue(actor, "이슈건");
    long eventId = seedEvent(recipient, "일정건");
    repo.insertBatch(List.of(recipient), NotificationType.ASSIGNED, actor, issueId, null);
    repo.insertReminder(recipient, eventId);

    List<NotificationResponse> list = repo.listRecent(recipient, 20, 0);
    assertThat(list).hasSize(2);
    assertThat(list).extracting(NotificationResponse::type).contains("ASSIGNED", "REMINDER");
  }

  @Test
  void insertBatch_then_listRecent_joinsDisplayFields() {
    long recipient = seedUser("HUMAN");
    long actor = seedUser("AGENT");
    long issueId = seedIssue(actor, "리팩터링");

    repo.insertBatch(List.of(recipient), NotificationType.COMMENTED, actor, issueId, 77L);

    List<NotificationResponse> list = repo.listRecent(recipient, 20, 0);
    assertThat(list).hasSize(1);
    NotificationResponse n = list.get(0);
    assertThat(n.type()).isEqualTo("COMMENTED");
    assertThat(n.actorId()).isEqualTo(actor);
    assertThat(n.actorKind()).isEqualTo("AGENT");
    assertThat(n.issueId()).isEqualTo(issueId);
    assertThat(n.issueTitle()).isEqualTo("리팩터링");
    assertThat(n.issueNumber()).isEqualTo(1);
    assertThat(n.projectKey()).isNotBlank();
    assertThat(n.commentId()).isEqualTo(77L);
    assertThat(n.read()).isFalse();
    assertThat(n.createdAt()).isNotNull();
  }

  /** #618 — 이슈가 소프트삭제되면 해당 이슈를 참조하는 알림은 listRecent/countUnread 에서 제외된다. */
  @Test
  void listRecent_excludesNotificationsForSoftDeletedIssue() {
    long recipient = seedUser("HUMAN");
    long actor = seedUser("HUMAN");
    long issueId = seedIssue(actor, "삭제될 이슈");
    long eventId = seedEvent(recipient, "살아있는 일정");
    repo.insertBatch(List.of(recipient), NotificationType.COMMENTED, actor, issueId, 1L);
    repo.insertReminder(recipient, eventId);

    // 사전 확인: 삭제 전에는 이슈 알림 포함 2건, 안읽음 2건.
    assertThat(repo.listRecent(recipient, 20, 0)).hasSize(2);
    assertThat(repo.countUnread(recipient)).isEqualTo(2);

    // 이슈 소프트삭제(IssueService.softDelete 와 동일하게 deleted_at 세팅, row 는 유지).
    dsl.update(ISSUE)
        .set(ISSUE.DELETED_AT, java.time.OffsetDateTime.now())
        .where(ISSUE.ID.eq(issueId))
        .execute();

    List<NotificationResponse> list = repo.listRecent(recipient, 20, 0);
    assertThat(list).hasSize(1);
    assertThat(list.get(0).type()).isEqualTo("REMINDER");
    assertThat(repo.countUnread(recipient)).isEqualTo(1);
  }

  @Test
  void countUnread_and_markRead_areRecipientScoped() {
    long a = seedUser("HUMAN");
    long b = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a, b), NotificationType.STATUS_CHANGED, null, issueId, null);

    assertThat(repo.countUnread(a)).isEqualTo(1);
    long aNotifId = repo.listRecent(a, 20, 0).get(0).id();

    assertThat(repo.markRead(b, aNotifId)).isZero();
    assertThat(repo.countUnread(a)).isEqualTo(1);

    assertThat(repo.markRead(a, aNotifId)).isEqualTo(1);
    assertThat(repo.countUnread(a)).isZero();
    assertThat(repo.listRecent(a, 20, 0).get(0).read()).isTrue();
  }

  @Test
  void markAllRead_clearsOnlyCallerUnread() {
    long a = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a, a), NotificationType.ASSIGNED, null, issueId, null);
    assertThat(repo.countUnread(a)).isEqualTo(2);

    assertThat(repo.markAllRead(a)).isEqualTo(2);
    assertThat(repo.countUnread(a)).isZero();
  }

  /**
   * #610 — offset 기반 페이지네이션. 정렬 기준(created_at desc, id desc)이 고정이라 id 오름차순 삽입 시 최신(=마지막 삽입) 건이
   * 먼저 나온다. 5건 중 첫 페이지(limit=2, offset=0)와 다음 페이지(limit=2, offset=2)가 겹치지 않고 이어진다.
   */
  @Test
  void listRecent_offsetPaginatesWithoutOverlap() {
    long recipient = seedUser("HUMAN");
    long actor = seedUser("HUMAN");
    long issueId = seedIssue(actor, "페이지네이션 이슈");
    for (int i = 0; i < 5; i++) {
      repo.insertBatch(List.of(recipient), NotificationType.COMMENTED, actor, issueId, (long) i);
    }

    List<NotificationResponse> page1 = repo.listRecent(recipient, 2, 0);
    List<NotificationResponse> page2 = repo.listRecent(recipient, 2, 2);
    List<NotificationResponse> page3 = repo.listRecent(recipient, 2, 4);

    assertThat(page1).hasSize(2);
    assertThat(page2).hasSize(2);
    assertThat(page3).hasSize(1);
    // 최신순(마지막 삽입 comment_id=4 가 최상단) — 페이지 경계 검증.
    assertThat(page1).extracting(NotificationResponse::commentId).containsExactly(4L, 3L);
    assertThat(page2).extracting(NotificationResponse::commentId).containsExactly(2L, 1L);
    assertThat(page3).extracting(NotificationResponse::commentId).containsExactly(0L);
    // 페이지 간 id 중복 없음.
    List<Long> allIds =
        java.util.stream.Stream.of(page1, page2, page3)
            .flatMap(List::stream)
            .map(NotificationResponse::id)
            .toList();
    assertThat(allIds).doesNotHaveDuplicates().hasSize(5);
  }
}
