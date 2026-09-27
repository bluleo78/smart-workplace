package com.workplace.action;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.exception.ExternalCalendarWriteInTransactionException;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.exception.IssueCommentNotFoundException;
import com.workplace.issue.service.IssueCommentService;
import com.workplace.issue.service.IssueService;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.exception.ProjectConflictException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * #856 확인 카드 액션 8종 통합 테스트 — 참석자 추가·제거, 프로젝트 멤버 역할 변경·제거, 채널 멤버 초대, 이슈·코멘트·노트 삭제.
 *
 * <p>각 액션에 대해 (1) 사전검증(validate)이 승인 후에야 드러날 실패를 미리 거절하는지, (2) 승인(confirm)이 실제로 반영하는지, (3) 실행 경로가
 * 사전검증과 같은 술어로 막히는지를 고정한다. #852 에서 검증을 validate* 에만 넣고 실행 경로(check*)엔 빠뜨려 무력화된 적이 있어 (3)을 따로 본다.
 */
@Transactional
class ConfirmActionDispatcher856Test extends IntegrationTestBase {

  @Autowired ConfirmActionDispatcher dispatcher;
  @Autowired ObjectMapper objectMapper;
  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired IssueService issueService;
  @Autowired IssueCommentService commentService;
  @Autowired CalendarEventService calendarEventService;
  @Autowired EventAttendeeRepository attendeeRepo;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository channelMemberRepo;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired EncryptionService encryption;

  /** 대부분 액션의 호출자(USER 역할 — calendar:write·project:manage·issue:write 보유). */
  private long owner;

  /** 같은 테넌트의 다른 구성원 — 초대·멤버 대상. */
  private long member;

  /** 테넌트 멤버십이 없는 사용자 — 타 테넌트 대상 거절 재현용. */
  private long foreigner;

  private String projectKey;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    owner = seedHuman("USER");
    member = seedHuman("USER");
    foreigner = TestFixtures.createHuman(dsl);
    projectKey = "PC" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    projectService.create(owner, new CreateProjectRequest(projectKey, "#856 테스트", null));
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /** HUMAN 유저 + 지정 역할 + 테넌트#1 ACTIVE 멤버십. */
  private long seedHuman(String roleName) {
    long id = TestFixtures.createHuman(dsl);
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(roleName)).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private JsonNode params(String json) {
    try {
      return objectMapper.readTree(json);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private long localEvent() {
    var start = OffsetDateTime.parse("2026-07-01T09:00:00Z");
    return calendarEventService
        .create(
            owner,
            new CalendarEventRequest(
                "회의",
                null,
                start,
                start.plusHours(1),
                false,
                null,
                null,
                null,
                null,
                List.of(),
                null))
        .id();
  }

  // ---------------------------------------------------------------- 캘린더 참석자

  @Test
  @DisplayName("calendar.add_attendees — 승인하면 참석자가 되고, 타 테넌트·주최자뿐인 목록은 사전검증에서 거절")
  void addAttendees() {
    long eventId = localEvent();
    assertThatThrownBy(
            () ->
                dispatcher.validate(
                    owner,
                    "calendar.add_attendees",
                    params("{\"id\":" + eventId + ",\"userIds\":[" + foreigner + "]}")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("userId=[" + foreigner + "]");
    assertThatThrownBy(
            () ->
                dispatcher.validate(
                    owner,
                    "calendar.add_attendees",
                    params("{\"id\":" + eventId + ",\"userIds\":[" + owner + "]}")))
        .hasMessageContaining("초대할 참석자가 없습니다");
    // 비주최자는 일정 자체가 보이지 않는다(존재 은닉 404).
    assertThatThrownBy(
            () ->
                dispatcher.validate(
                    member,
                    "calendar.add_attendees",
                    params("{\"id\":" + eventId + ",\"userIds\":[" + owner + "]}")))
        .isInstanceOf(com.workplace.calendar.exception.CalendarEventNotFoundException.class);

    JsonNode ok = params("{\"id\":" + eventId + ",\"userIds\":[" + member + "]}");
    dispatcher.validate(owner, "calendar.add_attendees", ok);
    assertThat(dispatcher.confirm(owner, "calendar.add_attendees", ok))
        .isEqualTo(java.util.Map.of("id", eventId));
    assertThat(attendeeRepo.existsForUser(eventId, member)).isTrue();
    // 이미 참석 중이면 실행해도 알림만 다시 가는 효과 없는 카드라 거절.
    assertThatThrownBy(() -> dispatcher.validate(owner, "calendar.add_attendees", ok))
        .hasMessageContaining("이미 이 일정의 참석자입니다");
  }

  @Test
  @DisplayName("calendar.remove_attendee — 참석자 제거, 주최자 본인·비참석자는 효과 없는 카드라 사전검증에서 거절")
  void removeAttendee() {
    long eventId = localEvent();
    calendarEventService.inviteAttendees(owner, eventId, List.of(member));
    assertThatThrownBy(
            () ->
                dispatcher.validate(
                    owner,
                    "calendar.remove_attendee",
                    params("{\"id\":" + eventId + ",\"userId\":" + owner + "}")))
        .hasMessageContaining("주최자 본인은");
    long stranger = seedHuman("USER");
    assertThatThrownBy(
            () ->
                dispatcher.validate(
                    owner,
                    "calendar.remove_attendee",
                    params("{\"id\":" + eventId + ",\"userId\":" + stranger + "}")))
        .hasMessageContaining("참석자가 아닙니다");

    JsonNode ok = params("{\"id\":" + eventId + ",\"userId\":" + member + "}");
    dispatcher.validate(owner, "calendar.remove_attendee", ok);
    dispatcher.confirm(owner, "calendar.remove_attendee", ok);
    assertThat(attendeeRepo.existsForUser(eventId, member)).isFalse();
  }

  /** 확인 카드 승인은 트랜잭션 안이라 외부 동기화 일정의 참석자 변경은 승인 시 409 로 실패한다 — 그 사유를 카드 만들기 전에 알린다. */
  @Test
  @DisplayName("외부(M365) 동기화 일정은 참석자 추가·제거 모두 사전검증에서 거절")
  void externalEvent_rejectedAtValidate() {
    long accountId =
        dsl.insertInto(EMAIL_ACCOUNT)
            .set(EMAIL_ACCOUNT.USER_ID, owner)
            .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, owner + "@iacloud.kr")
            .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
            .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
            .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("AT"))
            .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
            .set(EMAIL_ACCOUNT.AI_ENABLED, false)
            .set(EMAIL_ACCOUNT.TENANT_ID, 1L)
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();
    long calId =
        dsl.insertInto(CALENDAR)
            .set(CALENDAR.OWNER_ID, owner)
            .set(CALENDAR.NAME, "외부캘린더")
            .set(CALENDAR.COLOR, "blue")
            .set(CALENDAR.IS_DEFAULT, false)
            .set(CALENDAR.POSITION, 0)
            .set(CALENDAR.EXTERNAL_ACCOUNT_ID, accountId)
            .set(CALENDAR.EXTERNAL_ID, "ext-cal-856")
            .set(CALENDAR.IS_READ_ONLY, false)
            .set(CALENDAR.TENANT_ID, 1L)
            .returning(CALENDAR.ID)
            .fetchOne()
            .getId();
    long eventId =
        dsl.insertInto(CALENDAR_EVENT)
            .set(CALENDAR_EVENT.OWNER_ID, owner)
            .set(CALENDAR_EVENT.CALENDAR_ID, calId)
            .set(CALENDAR_EVENT.TITLE, "외부일정")
            .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.parse("2026-07-10T09:00:00Z"))
            .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.parse("2026-07-10T10:00:00Z"))
            .set(CALENDAR_EVENT.ALL_DAY, false)
            .set(CALENDAR_EVENT.EXTERNAL_ID, "EXT-EVT-856")
            .set(CALENDAR_EVENT.TENANT_ID, 1L)
            .returning(CALENDAR_EVENT.ID)
            .fetchOne()
            .getId();
    long agent = createAgentUserWithMembership("pc856agent");
    attendeeRepo.insert(eventId, member, owner, "ATTENDEE", "NEEDS_ACTION");
    attendeeRepo.insert(eventId, agent, owner, "ATTENDEE", "ACCEPTED");

    // 주최자 행이 없으면(비주최자) 실행이 409 로 막히므로 사전검증도 같은 사유로 거절한다.
    assertThatThrownBy(
            () ->
                dispatcher.validate(
                    owner,
                    "calendar.remove_attendee",
                    params("{\"id\":" + eventId + ",\"userId\":" + member + "}")))
        .isInstanceOf(
            com.workplace.calendar.exception.ExternalEventAttendeeNotOrganizerException.class);
    attendeeRepo.insert(eventId, owner, owner, "ORGANIZER", "ACCEPTED");

    assertThatThrownBy(
            () ->
                dispatcher.validate(
                    owner,
                    "calendar.add_attendees",
                    params("{\"id\":" + eventId + ",\"userIds\":[" + seedHuman("USER") + "]}")))
        .isInstanceOf(ExternalCalendarWriteInTransactionException.class);
    assertThatThrownBy(
            () ->
                dispatcher.validate(
                    owner,
                    "calendar.remove_attendee",
                    params("{\"id\":" + eventId + ",\"userId\":" + member + "}")))
        .isInstanceOf(ExternalCalendarWriteInTransactionException.class);
    // 에이전트 참석자 제거는 Graph 없이 로컬만 지우므로 외부 일정이어도 실행이 성공한다 — 사전검증도 통과해야 한다.
    assertThatCode(
            () ->
                dispatcher.validate(
                    owner,
                    "calendar.remove_attendee",
                    params("{\"id\":" + eventId + ",\"userId\":" + agent + "}")))
        .doesNotThrowAnyException();
  }

  // ---------------------------------------------------------------- 프로젝트 멤버

  @Test
  @DisplayName("project.update_member_role·remove_member — 반영되고, 마지막 OWNER 는 사전검증·실행 모두 거절")
  void projectMembers() {
    projectService.addMember(owner, projectKey, new AddMemberRequest(member, "MEMBER"));

    // 마지막 OWNER 강등·제거 — 사전검증과 실행이 같은 술어로 막힌다.
    JsonNode demoteSelf =
        params("{\"key\":\"" + projectKey + "\",\"userId\":" + owner + ",\"role\":\"MEMBER\"}");
    assertThatThrownBy(() -> dispatcher.validate(owner, "project.update_member_role", demoteSelf))
        .isInstanceOf(ProjectConflictException.class);
    assertThatThrownBy(() -> dispatcher.confirm(owner, "project.update_member_role", demoteSelf))
        .isInstanceOf(ProjectConflictException.class);
    JsonNode removeSelf = params("{\"key\":\"" + projectKey + "\",\"userId\":" + owner + "}");
    assertThatThrownBy(() -> dispatcher.validate(owner, "project.remove_member", removeSelf))
        .isInstanceOf(ProjectConflictException.class);
    assertThatThrownBy(() -> dispatcher.confirm(owner, "project.remove_member", removeSelf))
        .isInstanceOf(ProjectConflictException.class);
    // 잘못된 역할 값은 bean-validation 으로 400.
    assertThatThrownBy(
            () ->
                dispatcher.validate(
                    owner,
                    "project.update_member_role",
                    params(
                        "{\"key\":\""
                            + projectKey
                            + "\",\"userId\":"
                            + member
                            + ",\"role\":\"ADMIN\"}")))
        .isInstanceOf(IllegalArgumentException.class);
    // OWNER 가 아닌 멤버는 바꿀 수 없다.
    assertThatThrownBy(
            () ->
                dispatcher.validate(
                    member,
                    "project.remove_member",
                    params("{\"key\":\"" + projectKey + "\",\"userId\":" + owner + "}")))
        .isInstanceOf(ProjectAccessDeniedException.class);

    dispatcher.confirm(
        owner,
        "project.update_member_role",
        params("{\"key\":\"" + projectKey + "\",\"userId\":" + member + ",\"role\":\"OWNER\"}"));
    assertThat(
            dsl.select(PROJECT_MEMBER.ROLE)
                .from(PROJECT_MEMBER)
                .where(PROJECT_MEMBER.USER_ID.eq(member))
                .fetchOne(PROJECT_MEMBER.ROLE))
        .isEqualTo("OWNER");
    dispatcher.confirm(
        owner,
        "project.remove_member",
        params("{\"key\":\"" + projectKey + "\",\"userId\":" + member + "}"));
    assertThat(dsl.fetchCount(PROJECT_MEMBER, PROJECT_MEMBER.USER_ID.eq(member))).isZero();
  }

  // ---------------------------------------------------------------- 채널 멤버

  @Test
  @DisplayName("messaging.add_channel_member — 초대되고, 이미 멤버·타 테넌트·권한 없음은 거절")
  void addChannelMember() {
    long channelId = channelRepo.insertPublic("pc856-" + UUID.randomUUID(), owner);
    channelMemberRepo.add(channelId, owner, "OWNER");
    JsonNode ok = params("{\"id\":" + channelId + ",\"userId\":" + member + "}");

    assertThatThrownBy(
            () ->
                dispatcher.validate(
                    owner,
                    "messaging.add_channel_member",
                    params("{\"id\":" + channelId + ",\"userId\":" + foreigner + "}")))
        .isInstanceOf(ChannelForbiddenException.class);
    // 채널 관리 권한 없는 사용자.
    assertThatThrownBy(() -> dispatcher.validate(member, "messaging.add_channel_member", ok))
        .isInstanceOf(RuntimeException.class);

    dispatcher.validate(owner, "messaging.add_channel_member", ok);
    dispatcher.confirm(owner, "messaging.add_channel_member", ok);
    assertThat(
            dsl.fetchCount(
                CHANNEL_MEMBER,
                CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(member))))
        .isOne();
    // 이미 멤버면 실행은 idempotent 지만 효과 없는 카드라 사전검증에서 거절.
    assertThatThrownBy(() -> dispatcher.validate(owner, "messaging.add_channel_member", ok))
        .hasMessageContaining("이미 채널 멤버");
  }

  // ---------------------------------------------------------------- 이슈·코멘트

  @Test
  @DisplayName("issue.delete — soft-delete 되고, reporter·OWNER 가 아니면 사전검증·실행 모두 거절")
  void deleteIssue() {
    projectService.addMember(owner, projectKey, new AddMemberRequest(member, "MEMBER"));
    int number =
        issueService
            .create(
                owner,
                projectKey,
                new CreateIssueRequest("지울 이슈", null, null, null, null, null, null, null))
            .number();
    JsonNode p = params("{\"key\":\"" + projectKey + "\",\"number\":" + number + "}");

    assertThatThrownBy(() -> dispatcher.validate(member, "issue.delete", p))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThatThrownBy(() -> dispatcher.confirm(member, "issue.delete", p))
        .isInstanceOf(ProjectAccessDeniedException.class);

    dispatcher.validate(owner, "issue.delete", p);
    assertThat(dispatcher.confirm(owner, "issue.delete", p))
        .isEqualTo(java.util.Map.of("deleted", projectKey + "-" + number));
    assertThat(
            dsl.select(ISSUE.DELETED_AT)
                .from(ISSUE)
                .where(ISSUE.NUMBER.eq(number))
                .and(ISSUE.PROJECT_ID.eq(projectService.get(owner, projectKey).id()))
                .fetchOne(ISSUE.DELETED_AT))
        .isNotNull();
  }

  @Test
  @DisplayName("issue.delete_comment — 삭제되고, 다른 이슈의 코멘트 id 는 사전검증·실행(REST 경로 포함) 모두 404")
  void deleteComment() {
    var a =
        issueService.create(
            owner,
            projectKey,
            new CreateIssueRequest("A", null, null, null, null, null, null, null));
    var b =
        issueService.create(
            owner,
            projectKey,
            new CreateIssueRequest("B", null, null, null, null, null, null, null));
    long commentOnB =
        commentService.create(owner, b.id(), new CreateCommentRequest("B 의 코멘트")).id();

    // A 이슈 키에 B 의 코멘트 id — 소속 대조가 없으면 A 기준 권한으로 B 코멘트를 지운다.
    JsonNode mismatch =
        params(
            "{\"key\":\""
                + projectKey
                + "\",\"number\":"
                + a.number()
                + ",\"commentId\":"
                + commentOnB
                + "}");
    assertThatThrownBy(() -> dispatcher.validate(owner, "issue.delete_comment", mismatch))
        .isInstanceOf(IssueCommentNotFoundException.class);
    assertThatThrownBy(() -> commentService.delete(owner, a.id(), commentOnB))
        .isInstanceOf(IssueCommentNotFoundException.class);
    assertThat(
            dsl.select(ISSUE_COMMENT.DELETED_AT)
                .from(ISSUE_COMMENT)
                .where(ISSUE_COMMENT.ID.eq(commentOnB))
                .fetchOne(ISSUE_COMMENT.DELETED_AT))
        .isNull();

    JsonNode ok =
        params(
            "{\"key\":\""
                + projectKey
                + "\",\"number\":"
                + b.number()
                + ",\"commentId\":"
                + commentOnB
                + "}");
    dispatcher.validate(owner, "issue.delete_comment", ok);
    dispatcher.confirm(owner, "issue.delete_comment", ok);
    assertThat(
            dsl.select(ISSUE_COMMENT.DELETED_AT)
                .from(ISSUE_COMMENT)
                .where(ISSUE_COMMENT.ID.eq(commentOnB))
                .fetchOne(ISSUE_COMMENT.DELETED_AT))
        .isNotNull();
  }

  // ---------------------------------------------------------------- 노트

  @Test
  @DisplayName("wiki.delete_page — 하위 페이지까지 삭제되고, 공간 비멤버는 거절")
  void deleteWikiPage() {
    long spaceId = spaceService.createTeamSpace(owner, "#856 공간").id();
    long parent = pageService.create(owner, spaceId, new CreatePageRequest(null, "부모")).id();
    long child = pageService.create(owner, spaceId, new CreatePageRequest(parent, "자식")).id();
    JsonNode p = params("{\"id\":" + parent + "}");

    assertThatThrownBy(() -> dispatcher.validate(member, "wiki.delete_page", p))
        .isInstanceOf(RuntimeException.class);

    dispatcher.validate(owner, "wiki.delete_page", p);
    dispatcher.confirm(owner, "wiki.delete_page", p);
    assertThat(dsl.fetchCount(WIKI_PAGE, WIKI_PAGE.ID.in(parent, child))).isZero();
  }

  // ---------------------------------------------------------------- 공통

  /** 식별자만 받는 액션도 모르는 필드는 조용히 버리지 않고 이름을 짚어 거절한다(#852 교훈). */
  @Test
  @DisplayName("#856 액션은 모르는 필드·빈 참석자 목록을 거절한다")
  void rejectsUnknownFieldsAndEmptyList() {
    long eventId = localEvent();
    assertThatThrownBy(
            () ->
                dispatcher.validate(
                    owner, "wiki.delete_page", params("{\"id\":1,\"cascade\":true}")))
        .hasMessageContaining("알 수 없는 필드 'cascade'");
    assertThatThrownBy(
            () ->
                dispatcher.validate(
                    owner,
                    "calendar.add_attendees",
                    params("{\"id\":" + eventId + ",\"userIds\":[]}")))
        .hasMessageContaining("userIds");
    assertThatCode(
            () ->
                dispatcher.validate(
                    owner,
                    "calendar.add_attendees",
                    params("{\"id\":" + eventId + ",\"userIds\":[" + member + "]}")))
        .doesNotThrowAnyException();
  }
}
