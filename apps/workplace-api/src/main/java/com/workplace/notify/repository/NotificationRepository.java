package com.workplace.notify.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE;

import com.workplace.global.share.ProjectMembership;
import com.workplace.global.share.WikiShareTargets;
import com.workplace.global.share.WikiSpaceMembership;
import com.workplace.global.util.SingleLineTitles;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationType;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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

  /**
   * 주어진 id 중 존재하는 HUMAN 사용자만(입력 순서 무관, 중복 없이 id 오름차순). 멘션 토큰처럼 검증 전 id 를 거를 때 쓴다(WP-650). 종류 조회는
   * {@link #findKinds} 한 곳에서 한다 — 없는 사용자는 결과에서 빠진다(알림 설정 판정은 없는 사용자를 사람으로 보지만, 여기서는 「존재하는 사람」만).
   */
  public List<Long> filterHumanIds(Collection<Long> userIds) {
    if (userIds == null || userIds.isEmpty()) return List.of();
    return findKinds(userIds).entrySet().stream()
        .filter(e -> "HUMAN".equals(e.getValue()))
        .map(Map.Entry::getKey)
        .sorted()
        .toList();
  }

  /** 사용자 id → kind(HUMAN·AGENT). 없는 사용자는 결과에 없다. 알림 수신자·행위자 종류 판정이 모두 이것을 쓴다(WP-913). */
  public Map<Long, String> findKinds(Collection<Long> userIds) {
    Map<Long, String> out = new HashMap<>();
    if (userIds.isEmpty()) return out;
    dsl.select(USER.ID, USER.KIND)
        .from(USER)
        .where(USER.ID.in(userIds))
        .forEach(r -> out.put(r.get(USER.ID), r.get(USER.KIND)));
    return out;
  }

  /** 수신자별 1행씩 batch insert. created_at 은 DB default, read_at 은 null(안읽음). */
  public void insertBatch(
      List<Long> recipientIds, NotificationType type, Long actorId, long issueId, Long commentId) {
    insertBatch(recipientIds, type, actorId, issueId, commentId, null, null);
  }

  /**
   * 위 + 상태 이름(WP-869)·AI 작업 상태(WP-913). STATUS_CHANGED 알림은 그때의 새 상태 이름을 남겨, 나중에 상태 이름이 바뀌거나 지워져도 알림
   * 문구가 「그때 바꾼 상태」를 가리키게 한다. AI 작업 상태로 생긴 알림은 원인 상태(REVIEW·FAILED·AUTH_REQUIRED 등)를 남겨, 인박스·푸시가 상태별
   * 문구를 고르게 한다. 상태 이름(statusName)과는 다른 칸이다 — 섞이면 웹이 「상태를 'REVIEW'(으)로 변경」처럼 보인다.
   */
  public void insertBatch(
      List<Long> recipientIds,
      NotificationType type,
      Long actorId,
      long issueId,
      Long commentId,
      String statusName,
      String agentWorkState) {
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
                            .set(NOTIFICATION.COMMENT_ID, commentId)
                            .set(NOTIFICATION.STATUS_NAME, statusName)
                            .set(NOTIFICATION.AGENT_WORK_STATE, agentWorkState))
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

  /**
   * 노트 공유 알림 1건 insert(WP-579) — actor 있음, wiki_page_id 사용, message 는 WIKI_SHARED 의 보낸 사람 메시지(없으면
   * null). 노트가 지워지면 FK CASCADE 로 행도 함께 사라진다.
   */
  public void insertWikiShareNotification(
      long recipientId, NotificationType type, long actorId, long pageId, String message) {
    dsl.insertInto(NOTIFICATION)
        .set(NOTIFICATION.RECIPIENT_ID, recipientId)
        .set(NOTIFICATION.ACTOR_ID, actorId)
        .set(NOTIFICATION.TYPE, type.name())
        .set(NOTIFICATION.WIKI_PAGE_ID, pageId)
        .set(NOTIFICATION.MESSAGE, message)
        .execute();
  }

  /**
   * 일정 변경·취소 알림 1건 insert(WP-712) — 그때의 일정 제목·시작 시각을 함께 남긴다. 취소면 eventId 가 null(가리킬 일정이 없다)이고
   * 목록·푸시는 남긴 제목·시각을 보인다.
   */
  public void insertEventNotice(
      long recipientId,
      NotificationType type,
      long actorId,
      Long eventId,
      String eventTitle,
      OffsetDateTime eventStartsAt) {
    dsl.insertInto(NOTIFICATION)
        .set(NOTIFICATION.RECIPIENT_ID, recipientId)
        .set(NOTIFICATION.ACTOR_ID, actorId)
        .set(NOTIFICATION.TYPE, type.name())
        .set(NOTIFICATION.EVENT_ID, eventId)
        .set(NOTIFICATION.EVENT_TITLE, eventTitle)
        .set(NOTIFICATION.EVENT_STARTS_AT, eventStartsAt)
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
   * 최신순 알림 — issue·project(LEFT, 이슈 알림용), calendar_event(LEFT, REMINDER 용), wiki_page(LEFT, 노트 공유
   * 알림의 제목), user(actor, LEFT) 조인으로 표시 필드 합성. 이슈/리마인더가 섞여 있으므로 issue 는 INNER 가 아닌 LEFT JOIN. 이슈가
   * 소프트삭제되면(#618) notification 행은 CASCADE 없이 남지만 issue_id 가 가리키는 이슈는 죽은 링크이므로 목록에서 제외한다 (issue_id 가
   * null 인 리마인더/캘린더 알림은 LEFT JOIN 매치가 없어 이 조건에 영향받지 않는다). offset 은 무한스크롤 페이지네이션(#610)용 — 정렬
   * 기준(created_at desc, id desc)이 고정이라 페이지 경계에서 안정적이다.
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
            EVENT_TITLE,
            EVENT_STARTS_AT,
            NOTIFICATION.WIKI_PAGE_ID,
            WIKI_PAGE.TITLE,
            NOTIFICATION.MESSAGE,
            NOTIFICATION.STATUS_NAME,
            NOTIFICATION.AGENT_WORK_STATE,
            NOTIFICATION.READ_AT,
            NOTIFICATION.CREATED_AT)
        .from(NOTIFICATION)
        .leftJoin(ISSUE)
        .on(ISSUE.ID.eq(NOTIFICATION.ISSUE_ID))
        .leftJoin(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .leftJoin(CALENDAR_EVENT)
        .on(CALENDAR_EVENT.ID.eq(NOTIFICATION.EVENT_ID))
        .leftJoin(WIKI_PAGE)
        .on(WIKI_PAGE.ID.eq(NOTIFICATION.WIKI_PAGE_ID))
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
              OffsetDateTime eventStart = r.get(EVENT_STARTS_AT);
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
                  r.get(EVENT_TITLE),
                  eventStart == null ? null : eventStart.toInstant(),
                  r.get(NOTIFICATION.WIKI_PAGE_ID),
                  // 제목을 비워 둔 노트는 「제목 없음」 — 빈 이름이 「노트 「」을 공유했습니다」로 보였다(WP-1069). 노트 알림이 아니면 null
                  r.get(NOTIFICATION.WIKI_PAGE_ID) == null
                      ? null
                      : SingleLineTitles.orUntitled(r.get(WIKI_PAGE.TITLE)),
                  r.get(NOTIFICATION.MESSAGE),
                  r.get(NOTIFICATION.STATUS_NAME),
                  r.get(NOTIFICATION.AGENT_WORK_STATE),
                  r.get(NOTIFICATION.READ_AT) != null,
                  created == null ? null : created.toInstant());
            });
  }

  /**
   * 알림에 보일 일정 제목·시작 시각 — 알림에 남긴 값(변경·취소 알림, WP-712)이 있으면 그것, 없으면(초대·응답·리마인더) 지금 일정 행의 값. 취소 알림은 일정
   * 행이 없어 남긴 값만 있다.
   */
  private static final org.jooq.Field<String> EVENT_TITLE =
      DSL.coalesce(NOTIFICATION.EVENT_TITLE, CALENDAR_EVENT.TITLE).as("event_title_shown");

  private static final org.jooq.Field<OffsetDateTime> EVENT_STARTS_AT =
      DSL.coalesce(NOTIFICATION.EVENT_STARTS_AT, CALENDAR_EVENT.STARTS_AT)
          .as("event_starts_at_shown");

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
   * 전원, TEAM 은 멤버 또는 ADMIN, PERSONAL 은 멤버(소유자)만. 쿼리는 ISSUE·PROJECT 를 LEFT JOIN 해야 한다.
   *
   * <p>일정 알림(초대·리마인더 등)이면 받는 사람이 그 일정을 지금 볼 수 있어야 한다(WP-517) — 주최자이거나 참석자. 참석자에서 빠진 사람에게 예전 초대 알림이
   * 일정의 현재 제목·시각을 계속 보여 주지 않게 한다(캘린더 조회의 accessibleBy 와 같은 규칙).
   */
  private Condition readableByRecipient(long recipientId, boolean recipientIsAdmin) {
    Condition issueReadable =
        NOTIFICATION
            .ISSUE_ID
            .isNull()
            .or(
                projectReadableBy(
                    // 멤버 = 직접 멤버 또는 멤버로 둔 조직도 부서의 구성원(WP-1057).
                    ProjectMembership.isMember(ISSUE.PROJECT_ID, DSL.val(recipientId)),
                    recipientIsAdmin ? DSL.trueCondition() : DSL.falseCondition()));
    Condition eventReadable =
        NOTIFICATION
            .EVENT_ID
            .isNull()
            .or(
                DSL.exists(
                    DSL.selectOne()
                        .from(CALENDAR_EVENT.as("ev"))
                        .where(CALENDAR_EVENT.as("ev").ID.eq(NOTIFICATION.EVENT_ID))
                        .and(
                            CALENDAR_EVENT
                                .as("ev")
                                .OWNER_ID
                                .eq(recipientId)
                                .or(
                                    DSL.exists(
                                        DSL.selectOne()
                                            .from(EVENT_ATTENDEE)
                                            .where(
                                                EVENT_ATTENDEE.EVENT_ID.eq(NOTIFICATION.EVENT_ID))
                                            .and(EVENT_ATTENDEE.USER_ID.eq(recipientId)))))));
    return issueReadable.and(eventReadable).and(wikiReadableByRecipient(recipientId));
  }

  /**
   * 노트 공유 알림이면 받는 사람이 그 노트를 지금도 열 수 있어야 한다(WP-579, WP-491·517 과 같은 방식으로 못 열면 목록·안읽음 수에서 뺀다) — 지정에서
   * 빠지거나 공유가 해제·만료돼도 예전 알림이 노트의 현재(바뀐) 제목을 계속 보여 주지 않게 한다. 열 수 있는 경우: 노트 스페이스의 멤버(직접 멤버이거나 멤버로 둔
   * 조직도 부서·하위 부서의 구성원 — 공용 {@link WikiSpaceMembership#isMember}, WP-1052)이거나, 이 노트를 지금 덮는(자기 공유 또는
   * 하위 포함 조상 공유) 만료 전 공유에 받는 사람이 지정한 사람으로 들어 있거나, 지정한 조직도 부서(하위 부서 포함)의 구성원이다(WP-1023). 조상 공유는 그
   * 사이(노트 포함)에 상속이 멈추는 페이지(상위 공유 제외 표시·따로 켠 공유, WP-987)가 없을 때만 덮는다 — {@code WikiShareAccess} 의 범위
   * 판정과 같은 규칙.
   *
   * <p>알림을 누르면 가는 입구({@code WikiShareAccess#entry} — 멤버 또는 {@code
   * WikiShareRepository#findCoveringTokens} 가 찾은 지정 공유 토큰)와 <b>같은 규칙</b>이어야 한다. 워크스페이스 전체 공유는 입구가
   * 토큰을 주지 않으므로(토큰을 페이지 id 로 캐낼 수 없게) 여기서도 열 수 있음으로 보지 않는다 — 보이는데 누르면 「열 수 없음」이 되지 않게. 지정 목록은 대상이
   * PEOPLE 이 아니게 되면 비워진다. 둘이 같은지는 WikiShareNotificationTest.notification_visibility_matches_entry 가
   * 지킨다. 조상 체인은 자기 포함 재귀로 구해 이동도 즉시 반영한다. 대상 판정(지정한 사람·지정한 부서 구성원, WP-1023)은 공용 {@link
   * WikiShareTargets#listedOn} 을 그대로 끼워 쓴다 — 입구({@code WikiShareRepository})와 같은 조건이라 갈라지지 않고,
   * notify 가 wiki 패키지를 import 하지 않는다. 그 안의 「내 부서와 그 상위 부서」 부분 질의는 바깥 행을 보지 않아 목록 조회당 한 번만 계산된다. 쿼리는
   * NOTIFICATION 을 별칭 없이 써야 한다.
   */
  private static Condition wikiReadableByRecipient(long recipientId) {
    return NOTIFICATION
        .WIKI_PAGE_ID
        .isNull()
        .or(
            DSL.condition(
                """
                exists (
                  select 1 from wiki_page wp
                  where wp.id = notification.wiki_page_id
                    and (
                      ({0})
                      or exists (
                        with recursive chain(id, parent_id, depth) as (
                          select id, parent_id, 0 from wiki_page where id = notification.wiki_page_id
                          union
                          select p.id, p.parent_id, c.depth + 1 from wiki_page p join chain c on p.id = c.parent_id
                          where c.depth < 1000
                        )
                        select 1 from wiki_page_share s
                        join chain sc on sc.id = s.page_id
                        where (sc.depth = 0 or s.include_children)
                          and (s.expires_at is null or s.expires_at > now())
                          and {1}
                          and not exists (
                            select 1 from chain b
                            where b.depth < sc.depth
                              and (exists (select 1 from wiki_page_share_exclusion e where e.page_id = b.id)
                                   or exists (select 1 from wiki_page_share s2 where s2.page_id = b.id
                                              and (s2.expires_at is null or s2.expires_at > now())))
                          )
                      )
                    )
                )
                """,
                // 스페이스 멤버 판정(직접 멤버 또는 멤버로 둔 조직도 부서의 구성원, WP-1052)도 입구와 같은 한 규칙 — 별칭 wp 의 스페이스 열.
                WikiSpaceMembership.isMember(
                    DSL.field(DSL.name("wp", "space_id"), Long.class), DSL.val(recipientId)),
                // 대상 판정(지정한 사람·지정한 부서 구성원)은 입구 판정과 같은 한 규칙(WP-1023) — 별칭 s 의 공유 id 열과 받는 사람 값.
                WikiShareTargets.listedOn(
                    DSL.field(DSL.name("s", "id"), Long.class), DSL.val(recipientId))));
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
    // 멤버 = 직접 멤버 또는 멤버로 둔 조직도 부서의 구성원(WP-1057). 사람이 바깥 열(USER.ID)이라 상위 부서 재귀를 수신자마다 돌지 않게, 직접 멤버는
    // (프로젝트, 사람) 조인으로 보고 부서 쪽은 이 이슈 프로젝트의 부서 구성원을 후보로 좁혀 한 번만 구한다(같은 규칙 — 공용 ProjectMembership).
    var ci = ISSUE.as("nr_ci");
    Field<Long> projectId = DSL.field(DSL.select(ci.PROJECT_ID).from(ci).where(ci.ID.eq(issueId)));
    var dept =
        ProjectMembership.departmentAudience("nr_dept", g -> g.PROJECT_ID.eq(projectId), userIds);
    Condition member =
        PROJECT_MEMBER
            .USER_ID
            .isNotNull()
            .or(USER.ID.in(DSL.select(dept.userId()).from(dept.table())));
    return dsl.select(USER.ID)
        .from(USER)
        .join(ISSUE)
        .on(ISSUE.ID.eq(issueId))
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .leftJoin(PROJECT_MEMBER)
        .on(PROJECT_MEMBER.PROJECT_ID.eq(ISSUE.PROJECT_ID))
        .and(PROJECT_MEMBER.USER_ID.eq(USER.ID))
        .where(USER.ID.in(userIds), projectReadableBy(member, admin))
        .fetch(USER.ID);
  }

  /**
   * ISSUE·PROJECT 가 조인된 쿼리에서 프로젝트 멤버(member)인 사람이 그 프로젝트를 볼 수 있는가 — ProjectAccessGuard.isReadable 과
   * 같은 규칙: OPEN 은 전원, TEAM 은 멤버 또는 ADMIN, PERSONAL 은 멤버(소유자)만. 삭제된 프로젝트는 누구도 볼 수 없다(WP-563) — 프로젝트
   * 삭제는 프로젝트 행에만 deleted_at 을 찍고 이슈는 그대로 두므로, 이슈 삭제(#618) 조건만으로는 그 알림이 목록·안읽음 수에 남는다.
   */
  private static Condition projectReadableBy(Condition member, Condition isAdmin) {
    return PROJECT
        .DELETED_AT
        .isNull()
        .and(PROJECT.TYPE.eq("OPEN").or(PROJECT.TYPE.ne("PERSONAL").and(isAdmin)).or(member));
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

  /** 본인의 한 이슈 알림 중 안 읽은 것을 읽음으로 — 바뀐 알림 id 를 돌려준다(WP-720, AI 가 그 이슈를 처리한 뒤 한 번에). */
  public List<Long> markReadByIssue(long recipientId, long issueId) {
    return dsl.update(NOTIFICATION)
        .set(NOTIFICATION.READ_AT, OffsetDateTime.now())
        .where(
            NOTIFICATION
                .RECIPIENT_ID
                .eq(recipientId)
                .and(NOTIFICATION.ISSUE_ID.eq(issueId))
                .and(NOTIFICATION.READ_AT.isNull()))
        .returning(NOTIFICATION.ID)
        .fetch(NOTIFICATION.ID);
  }

  /** 본인 안읽음 전체 읽음. 영향 행 수 반환. */
  public int markAllRead(long recipientId) {
    return dsl.update(NOTIFICATION)
        .set(NOTIFICATION.READ_AT, OffsetDateTime.now())
        .where(NOTIFICATION.RECIPIENT_ID.eq(recipientId).and(NOTIFICATION.READ_AT.isNull()))
        .execute();
  }
}
