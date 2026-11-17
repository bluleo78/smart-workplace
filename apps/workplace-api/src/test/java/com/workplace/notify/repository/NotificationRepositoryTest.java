package com.workplace.notify.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.service.CalendarService;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationType;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
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
  /** 누구나 볼 수 있는 OPEN 프로젝트의 이슈 — 알림 목록이 프로젝트 조회 권한을 따지므로(WP-491) 권한과 무관한 테스트는 OPEN 을 쓴다. */
  private long seedIssue(long ownerId, String title) {
    return seedIssue(ownerId, title, "OPEN");
  }

  private long seedIssue(long ownerId, String title, String projectType) {
    String s = tok();
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "N" + s.substring(0, 5))
            .set(PROJECT.NAME, "P" + s)
            .set(PROJECT.OWNER_ID, ownerId)
            .set(PROJECT.TYPE, projectType)
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
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(projectId, "TODO"))
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

  /**
   * WP-563 — 프로젝트가 삭제되면(소프트삭제, 이슈 행은 그대로) 그 프로젝트 이슈의 알림은 멤버·ADMIN 에게도 목록·안읽음 수에서 빠진다. 남겨 두면 누를 때마다
   * 「프로젝트를 불러올 수 없습니다」로 가고 배지가 줄지 않는다. 새 알림 수신자 거르기(WP-501)도 같은 규칙이다.
   */
  @Test
  void listRecent_hidesIssueNotificationsOfDeletedProject() {
    long recipient = seedUser("HUMAN");
    long actor = seedUser("HUMAN");
    long issueId = seedIssue(actor, "삭제될 프로젝트의 이슈", "TEAM");
    long projectId =
        dsl.select(ISSUE.PROJECT_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(issueId))
            .fetchOne(ISSUE.PROJECT_ID);
    dsl.insertInto(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.PROJECT_ID, projectId)
        .set(PROJECT_MEMBER.USER_ID, recipient)
        .set(PROJECT_MEMBER.ROLE, "MEMBER")
        .execute();
    long eventId = seedEvent(recipient, "일정");
    repo.insertBatch(List.of(recipient), NotificationType.ASSIGNED, actor, issueId, null);
    repo.insertReminder(recipient, eventId);
    assertThat(repo.listRecent(recipient, false, 20, 0)).hasSize(2);
    assertThat(repo.filterCanReadIssue(issueId, List.of(recipient))).containsExactly(recipient);

    // ProjectService.softDelete 와 같이 프로젝트 행에만 deleted_at 을 찍는다.
    dsl.update(PROJECT)
        .set(PROJECT.DELETED_AT, java.time.OffsetDateTime.now())
        .where(PROJECT.ID.eq(projectId))
        .execute();

    assertThat(repo.listRecent(recipient, false, 20, 0))
        .extracting(NotificationResponse::type)
        .containsExactly("REMINDER");
    assertThat(repo.countUnread(recipient, false)).isEqualTo(1);
    assertThat(repo.listRecent(recipient, true, 20, 0)).hasSize(1);
    assertThat(repo.countUnread(recipient, true)).isEqualTo(1);
    assertThat(repo.filterCanReadIssue(issueId, List.of(recipient))).isEmpty();
  }

  /**
   * WP-491 — 프로젝트에서 빠진 사람에게는 그 프로젝트 이슈의 예전 알림을 보이지 않는다(목록·안읽음 수 모두). 남겨 두면 이슈의 현재 제목을 계속 보여 준다.
   * ADMIN 은 비개인 프로젝트를 볼 수 있으므로 그대로 보인다.
   */
  @Test
  void listRecent_hidesIssueNotificationsOfProjectsTheRecipientCannotRead() {
    long recipient = seedUser("HUMAN");
    long actor = seedUser("HUMAN");
    long issueId = seedIssue(actor, "팀 이슈", "TEAM");
    long projectId =
        dsl.select(ISSUE.PROJECT_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(issueId))
            .fetchOne(ISSUE.PROJECT_ID);
    dsl.insertInto(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.PROJECT_ID, projectId)
        .set(PROJECT_MEMBER.USER_ID, recipient)
        .set(PROJECT_MEMBER.ROLE, "MEMBER")
        .execute();
    long eventId = seedEvent(recipient, "일정");
    repo.insertBatch(List.of(recipient), NotificationType.COMMENTED, actor, issueId, 1L);
    repo.insertReminder(recipient, eventId);

    // 멤버일 때는 이슈 알림이 보인다.
    assertThat(repo.listRecent(recipient, false, 20, 0)).hasSize(2);
    assertThat(repo.countUnread(recipient, false)).isEqualTo(2);

    // 프로젝트에서 빠지면 이슈 알림은 사라지고(목록·안읽음 수), 일정 알림은 남는다.
    dsl.deleteFrom(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId), PROJECT_MEMBER.USER_ID.eq(recipient))
        .execute();
    var list = repo.listRecent(recipient, false, 20, 0);
    assertThat(list).extracting(NotificationResponse::type).containsExactly("REMINDER");
    assertThat(repo.countUnread(recipient, false)).isEqualTo(1);

    // ADMIN 은 비개인(TEAM) 프로젝트를 볼 수 있다.
    assertThat(repo.listRecent(recipient, true, 20, 0)).hasSize(2);
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
   * #610 — offset 기반 페이지네이션. 정렬 기준(created_at desc, id desc)이 고정이라 id 오름차순 삽입 시 최신(=마지막 삽입) 건이 먼저
   * 나온다. 5건 중 첫 페이지(limit=2, offset=0)와 다음 페이지(limit=2, offset=2)가 겹치지 않고 이어진다.
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

  /**
   * WP-517 — 일정 알림은 받는 사람이 그 일정을 지금 볼 수 있을 때(주최자 또는 참석자)만 보인다. 참석자에서 빠지면 목록·안읽음 수에서 사라진다 — 남겨 두면
   * 일정의 현재 제목·시각을 계속 보여 준다.
   */
  @Test
  void listRecent_hidesEventNotificationsAfterRecipientLeavesAttendees() {
    long organizer = seedUser("HUMAN");
    long attendee = seedUser("HUMAN");
    long eventId = seedEvent(organizer, "주간 팀 회의");
    dsl.insertInto(EVENT_ATTENDEE)
        .set(EVENT_ATTENDEE.EVENT_ID, eventId)
        .set(EVENT_ATTENDEE.USER_ID, attendee)
        .execute();
    repo.insertEventNotification(attendee, NotificationType.CALENDAR_INVITED, organizer, eventId);
    repo.insertReminder(organizer, eventId);

    assertThat(repo.listRecent(attendee, false, 20, 0)).hasSize(1);
    assertThat(repo.countUnread(attendee, false)).isEqualTo(1);

    dsl.deleteFrom(EVENT_ATTENDEE)
        .where(EVENT_ATTENDEE.EVENT_ID.eq(eventId), EVENT_ATTENDEE.USER_ID.eq(attendee))
        .execute();
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.TITLE, "SECRET 바뀐 제목")
        .where(CALENDAR_EVENT.ID.eq(eventId))
        .execute();

    assertThat(repo.listRecent(attendee, false, 20, 0)).isEmpty();
    assertThat(repo.countUnread(attendee, false)).isZero();
    // 주최자 자신의 리마인더는 그대로 보인다.
    assertThat(repo.listRecent(organizer, false, 20, 0))
        .extracting(NotificationResponse::eventTitle)
        .containsExactly("SECRET 바뀐 제목");
  }

  // ── WP-1689 읽은 알림 보관 ──────────────────────────────────────────────

  /** 받는 사람의 알림 id 를 오래된 것부터(insertBatch 순서). */
  private List<Long> idsOf(long recipient) {
    return dsl.select(NOTIFICATION.ID)
        .from(NOTIFICATION)
        .where(NOTIFICATION.RECIPIENT_ID.eq(recipient))
        .orderBy(NOTIFICATION.ID)
        .fetch(NOTIFICATION.ID);
  }

  /** 알림 하나를 1분 전에 읽은 것으로 — 같은 트랜잭션 안의 시각 차이에 기대지 않게 과거 시각을 직접 넣는다. */
  private java.time.OffsetDateTime readMinuteAgo(long id) {
    var at = java.time.OffsetDateTime.now().minusMinutes(1).withNano(0);
    dsl.update(NOTIFICATION).set(NOTIFICATION.READ_AT, at).where(NOTIFICATION.ID.eq(id)).execute();
    return at;
  }

  /** 읽은 알림만 보관한다 — 안 읽은 알림·남의 알림은 그대로, read_at 은 바뀌지 않고 목록에서 빠진다. 안 읽은 수는 그대로다. */
  @Test
  void archiveRead_archivesOnlyCallersReadNotifications() {
    long a = seedUser("HUMAN");
    long b = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a, a, b), NotificationType.ASSIGNED, null, issueId, null);
    List<Long> aIds = idsOf(a);
    long bId = idsOf(b).get(0);
    var readAt = readMinuteAgo(aIds.get(0));
    readMinuteAgo(bId);

    List<Long> archived = repo.archiveRead(a, false);

    assertThat(archived).containsExactly(aIds.get(0));
    assertThat(repo.listRecent(a, 20, 0))
        .extracting(NotificationResponse::id)
        .containsExactly(aIds.get(1));
    assertThat(repo.countUnread(a)).isEqualTo(1);
    var row = dsl.selectFrom(NOTIFICATION).where(NOTIFICATION.ID.eq(aIds.get(0))).fetchOne();
    assertThat(row.getReadAt().toInstant()).isEqualTo(readAt.toInstant());
    assertThat(row.getArchivedAt()).isNotNull();
    // 남의 읽은 알림은 그대로 목록에 있다.
    assertThat(repo.listRecent(b, 20, 0)).extracting(NotificationResponse::id).containsExactly(bId);
    // 다시 불러도 보관할 것이 없다.
    assertThat(repo.archiveRead(a, false)).isEmpty();
  }

  /** 「모두 읽음」 직후 「읽은 알림 보관」 — 같은 트랜잭션 안에서 이어 불러도 방금 읽은 알림까지 보관돼 목록이 빈다. */
  @Test
  void markAllRead_then_archiveRead_emptiesList() {
    long a = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a, a), NotificationType.ASSIGNED, null, issueId, null);

    repo.markAllRead(a);
    assertThat(repo.archiveRead(a, false)).hasSize(2);

    assertThat(repo.listRecent(a, 20, 0)).isEmpty();
    assertThat(repo.countUnread(a)).isZero();
  }

  /** 되돌리기 — 내 것이면서 보관된 것만 되돌리고, 남의 id·보관 안 된 id 는 소리 없이 무시한다. */
  @Test
  void unarchive_restoresOnlyCallersArchived_andIgnoresOthers() {
    long a = seedUser("HUMAN");
    long b = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a, a, b), NotificationType.ASSIGNED, null, issueId, null);
    List<Long> aIds = idsOf(a);
    long bId = idsOf(b).get(0);
    readMinuteAgo(aIds.get(0));
    readMinuteAgo(bId);
    repo.archiveRead(a, false);
    repo.archiveRead(b, false);

    // b 가 a 의 보관 알림 id 로 되돌리기 → 아무것도 바뀌지 않는다.
    assertThat(repo.unarchive(b, List.of(aIds.get(0)))).isEmpty();
    assertThat(repo.listRecent(a, 20, 0))
        .extracting(NotificationResponse::id)
        .containsExactly(aIds.get(1));

    // a 가 자기 보관 알림 + 보관 안 된 자기 알림 + 남의 보관 알림 → 자기 보관 알림만 돌아온다.
    assertThat(repo.unarchive(a, List.of(aIds.get(0), aIds.get(1), bId)))
        .containsExactly(aIds.get(0));
    assertThat(repo.listRecent(a, 20, 0))
        .extracting(NotificationResponse::id)
        .containsExactlyInAnyOrder(aIds.get(0), aIds.get(1));
    var restored =
        repo.listRecent(a, 20, 0).stream()
            .filter(n -> n.id() == aIds.get(0))
            .findFirst()
            .orElseThrow();
    assertThat(restored.read()).isTrue();
    assertThat(repo.listRecent(b, 20, 0)).isEmpty();
  }

  /** 보관 뒤 같은 이슈에 새 활동이 생기면 새 알림은 늘 새 행이라 목록에 온다. */
  @Test
  void newNotificationAfterArchive_appearsInList() {
    long a = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a), NotificationType.ASSIGNED, null, issueId, null);
    readMinuteAgo(idsOf(a).get(0));
    repo.archiveRead(a, false);
    assertThat(repo.listRecent(a, 20, 0)).isEmpty();

    repo.insertBatch(List.of(a), NotificationType.COMMENTED, null, issueId, 1L);

    assertThat(repo.listRecent(a, 20, 0))
        .extracting(NotificationResponse::type)
        .containsExactly("COMMENTED");
    assertThat(repo.countUnread(a)).isEqualTo(1);
  }

  /**
   * 목록·안 읽은 수는 보관되지 않은 알림만 — countUnread 의 두 갈래(recipientIsAdmin false·true) 모두. 정상 흐름에서는 읽은 알림만
   * 보관되지만 쿼리가 archived_at 을 직접 거르는지 고정하려고 안 읽은 채 보관된 행을 직접 만든다. 보관된 알림은 읽음 처리도 다시 건드리지 않는다.
   */
  @Test
  void archivedRows_excludedFromListAndBothUnreadBranches_andNotReRead() {
    long a = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a, a), NotificationType.ASSIGNED, null, issueId, null);
    List<Long> ids = idsOf(a);
    dsl.update(NOTIFICATION)
        .set(NOTIFICATION.ARCHIVED_AT, java.time.OffsetDateTime.now())
        .where(NOTIFICATION.ID.eq(ids.get(0)))
        .execute();

    assertThat(repo.listRecent(a, false, 20, 0))
        .extracting(NotificationResponse::id)
        .containsExactly(ids.get(1));
    assertThat(repo.listRecent(a, true, 20, 0))
        .extracting(NotificationResponse::id)
        .containsExactly(ids.get(1));
    assertThat(repo.countUnread(a, false)).isEqualTo(1);
    assertThat(repo.countUnread(a, true)).isEqualTo(1);

    assertThat(repo.markRead(a, ids.get(0))).isZero();
    assertThat(repo.markReadByIssue(a, issueId)).containsExactly(ids.get(1));
    assertThat(
            dsl.select(NOTIFICATION.READ_AT)
                .from(NOTIFICATION)
                .where(NOTIFICATION.ID.eq(ids.get(0)))
                .fetchOne(NOTIFICATION.READ_AT))
        .isNull();
  }

  /** 모두 읽음도 보관된 알림은 건드리지 않는다. */
  @Test
  void markAllRead_skipsArchived() {
    long a = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a, a), NotificationType.ASSIGNED, null, issueId, null);
    dsl.update(NOTIFICATION)
        .set(NOTIFICATION.ARCHIVED_AT, java.time.OffsetDateTime.now())
        .where(NOTIFICATION.ID.eq(idsOf(a).get(0)))
        .execute();

    assertThat(repo.markAllRead(a)).isEqualTo(1);
  }

  /**
   * 목록에 보이지 않는 읽은 알림(지운 이슈·볼 수 없는 프로젝트)은 보관하지 않는다 — 「N개 보관」이 사용자가 본 것과 같게. ADMIN 은 비개인(TEAM) 프로젝트를
   * 볼 수 있으므로 그 알림은 보관된다(목록과 같은 갈래).
   */
  @Test
  void archiveRead_skipsReadNotificationsHiddenFromList() {
    long a = seedUser("HUMAN");
    long actor = seedUser("HUMAN");
    long visibleIssue = seedIssue(actor, "보이는 이슈");
    long deletedIssue = seedIssue(actor, "지운 이슈");
    long teamIssue = seedIssue(actor, "멤버 아닌 팀 이슈", "TEAM");
    repo.insertBatch(List.of(a), NotificationType.ASSIGNED, actor, visibleIssue, null);
    repo.insertBatch(List.of(a), NotificationType.ASSIGNED, actor, deletedIssue, null);
    repo.insertBatch(List.of(a), NotificationType.ASSIGNED, actor, teamIssue, null);
    List<Long> ids = idsOf(a);
    ids.forEach(this::readMinuteAgo);
    dsl.update(ISSUE)
        .set(ISSUE.DELETED_AT, java.time.OffsetDateTime.now())
        .where(ISSUE.ID.eq(deletedIssue))
        .execute();

    assertThat(repo.archiveRead(a, false)).containsExactly(ids.get(0));
    // ADMIN 갈래는 팀 프로젝트 알림도 보이므로 보관된다. 지운 이슈 알림은 여전히 남는다.
    assertThat(repo.archiveRead(a, true)).containsExactly(ids.get(2));
  }

  /** 보관 시각을 직접 정한다 — 보관함 정렬(최근 보관순) 검증용. */
  private void archiveAt(long id, int minutesAgo) {
    dsl.update(NOTIFICATION)
        .set(NOTIFICATION.ARCHIVED_AT, java.time.OffsetDateTime.now().minusMinutes(minutesAgo))
        .where(NOTIFICATION.ID.eq(id))
        .execute();
  }

  /** WP-1690: 보관함은 최근 보관순이다(만든 순서와 무관) — 보관 안 된 알림은 없다. */
  @Test
  void listArchived_newestArchivedFirst() {
    long a = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a, a, a, a), NotificationType.ASSIGNED, null, issueId, null);
    List<Long> ids = idsOf(a);
    archiveAt(ids.get(0), 30);
    archiveAt(ids.get(1), 10);
    archiveAt(ids.get(2), 20);

    assertThat(repo.listArchived(a, false, 20, 0))
        .extracting(NotificationResponse::id)
        .containsExactly(ids.get(1), ids.get(2), ids.get(0));
  }

  /** WP-1690: 남의 보관 알림·지운 이슈·빠진 프로젝트의 보관 알림은 보관함에 없다(목록과 같은 보이기 조건). */
  @Test
  void listArchived_onlyMineAndReadable() {
    long a = seedUser("HUMAN");
    long b = seedUser("HUMAN");
    long actor = seedUser("HUMAN");
    long visibleIssue = seedIssue(actor, "보이는 이슈");
    long deletedIssue = seedIssue(actor, "지운 이슈");
    long teamIssue = seedIssue(actor, "멤버 아닌 팀 이슈", "TEAM");
    repo.insertBatch(List.of(a, b), NotificationType.ASSIGNED, actor, visibleIssue, null);
    repo.insertBatch(List.of(a), NotificationType.ASSIGNED, actor, deletedIssue, null);
    repo.insertBatch(List.of(a), NotificationType.ASSIGNED, actor, teamIssue, null);
    List<Long> aIds = idsOf(a);
    long bId = idsOf(b).get(0);
    aIds.forEach(id -> archiveAt(id, 5));
    archiveAt(bId, 5);
    dsl.update(ISSUE)
        .set(ISSUE.DELETED_AT, java.time.OffsetDateTime.now())
        .where(ISSUE.ID.eq(deletedIssue))
        .execute();

    assertThat(repo.listArchived(a, false, 20, 0))
        .extracting(NotificationResponse::id)
        .containsExactly(aIds.get(0));
    // ADMIN 갈래는 팀 프로젝트 알림도 보인다.
    assertThat(repo.listArchived(a, true, 20, 0))
        .extracting(NotificationResponse::id)
        .containsExactlyInAnyOrder(aIds.get(0), aIds.get(2));
  }

  /** WP-1690: limit·offset 페이지네이션 — 경계에서 겹치거나 빠지지 않는다. */
  @Test
  void listArchived_pagesWithOffset() {
    long a = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a, a, a), NotificationType.ASSIGNED, null, issueId, null);
    List<Long> ids = idsOf(a);
    archiveAt(ids.get(0), 3);
    archiveAt(ids.get(1), 2);
    archiveAt(ids.get(2), 1);

    var first = repo.listArchived(a, false, 2, 0);
    var second = repo.listArchived(a, false, 2, 2);

    assertThat(first).hasSize(2);
    assertThat(second).hasSize(1);
    assertThat(first.get(0).id()).isEqualTo(ids.get(2));
    assertThat(second.get(0).id()).isEqualTo(ids.get(0));
  }

  /** 알림 1건을 insert 하고 read_at·archived_at 을 지금 기준 일수 전으로 직접 정한다(null 이면 비움). id 반환. */
  private long seedAged(long recipient, Integer readHoursAgo, Integer archivedHoursAgo) {
    repo.insertAccountNotice(recipient, NotificationType.PERSONAL_ASSISTANT_REVOKED, recipient);
    long id = idsOf(recipient).get(idsOf(recipient).size() - 1);
    var now = java.time.OffsetDateTime.now();
    dsl.update(NOTIFICATION)
        .set(NOTIFICATION.READ_AT, readHoursAgo == null ? null : now.minusHours(readHoursAgo))
        .set(
            NOTIFICATION.ARCHIVED_AT,
            archivedHoursAgo == null ? null : now.minusHours(archivedHoursAgo))
        .where(NOTIFICATION.ID.eq(id))
        .execute();
    return id;
  }

  private java.time.OffsetDateTime archivedAtOf(long id) {
    return dsl.select(NOTIFICATION.ARCHIVED_AT)
        .from(NOTIFICATION)
        .where(NOTIFICATION.ID.eq(id))
        .fetchOne(NOTIFICATION.ARCHIVED_AT);
  }

  /** WP-1690: 읽은 지 7일(cutoff = now-7일)을 넘은 알림만 자동 보관 — 7일+1시간 전은 보관, 6일 23시간 전은 그대로. */
  @Test
  void autoArchive_respectsSevenDayBoundary() {
    long a = seedUser("HUMAN");
    long old = seedAged(a, 7 * 24 + 1, null);
    long recent = seedAged(a, 6 * 24 + 23, null);

    int n = repo.autoArchiveReadBefore(java.time.OffsetDateTime.now().minusDays(7), 1000);

    assertThat(n).isEqualTo(1);
    assertThat(archivedAtOf(old)).isNotNull();
    assertThat(archivedAtOf(recent)).isNull();
  }

  /** WP-1690: 안 읽은 알림·이미 보관된 알림은 건드리지 않고 반환 수에도 안 든다(보관 시각 불변). */
  @Test
  void autoArchive_skipsUnreadAndAlreadyArchived() {
    long a = seedUser("HUMAN");
    long unread = seedAged(a, null, null);
    long already = seedAged(a, 9 * 24, 8 * 24);
    var before = archivedAtOf(already);

    int n = repo.autoArchiveReadBefore(java.time.OffsetDateTime.now().minusDays(7), 1000);

    assertThat(n).isZero();
    assertThat(archivedAtOf(unread)).isNull();
    assertThat(archivedAtOf(already)).isEqualTo(before);
  }

  /** WP-1690: 보관 90일 경계 — 91일 전 보관은 지우고 89일 전 보관·보관 안 된 오래된 알림은 남긴다. */
  @Test
  void deleteArchived_respectsNinetyDayBoundary() {
    long a = seedUser("HUMAN");
    long gone = seedAged(a, 100 * 24, 91 * 24);
    long kept = seedAged(a, 100 * 24, 89 * 24);
    long oldUnarchived = seedAged(a, 200 * 24, null);

    int n = repo.deleteArchivedBefore(java.time.OffsetDateTime.now().minusDays(90), 1000);

    assertThat(n).isEqualTo(1);
    assertThat(idsOf(a)).containsExactlyInAnyOrder(kept, oldUnarchived).doesNotContain(gone);
  }

  /**
   * WP-1690: 읽은 지 7일 넘은 알림을 되돌리면 read_at 이 되돌린 시각으로 바뀌어 다음 자동 보관이 곧바로 다시 고르지 않는다. 읽은 상태는 그대로다(안 읽음이
   * 되지 않음).
   */
  @Test
  void unarchive_resetsReadAt_soAutoArchiveDoesNotRepickIt() {
    long a = seedUser("HUMAN");
    long id = seedAged(a, 30 * 24, 20 * 24);

    assertThat(repo.unarchive(a, List.of(id))).containsExactly(id);

    var row = dsl.selectFrom(NOTIFICATION).where(NOTIFICATION.ID.eq(id)).fetchOne();
    assertThat(row.getArchivedAt()).isNull();
    assertThat(row.getReadAt()).isNotNull();
    assertThat(row.getReadAt()).isAfter(java.time.OffsetDateTime.now().minusMinutes(1));
    assertThat(repo.countUnread(a)).isZero();
    assertThat(repo.autoArchiveReadBefore(java.time.OffsetDateTime.now().minusDays(7), 1000))
        .isZero();
    assertThat(archivedAtOf(id)).isNull();
  }

  /** WP-1690: batch 는 한 번에 바꾸는 행 수 상한이다 — 5행 대상에 batch 2 면 2. */
  @Test
  void batchLimitsRowCount() {
    long a = seedUser("HUMAN");
    for (int i = 0; i < 5; i++) seedAged(a, 8 * 24, null);
    assertThat(repo.autoArchiveReadBefore(java.time.OffsetDateTime.now().minusDays(7), 2))
        .isEqualTo(2);

    long b = seedUser("HUMAN");
    for (int i = 0; i < 5; i++) seedAged(b, 100 * 24, 91 * 24);
    assertThat(repo.deleteArchivedBefore(java.time.OffsetDateTime.now().minusDays(90), 2))
        .isEqualTo(2);
  }
}
