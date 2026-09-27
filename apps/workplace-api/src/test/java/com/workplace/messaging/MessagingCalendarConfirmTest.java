package com.workplace.messaging;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.MESSAGE_ACTION_PROPOSAL;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.ConfirmProposalRequest;
import com.workplace.messaging.dto.CreateProposalRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.exception.ProposalNotDelegatorException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.MessagingProposalService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;

/** 일정 제안 승인(confirmWithBody) 통합 테스트 — 일정 생성 + 결과 메시지 + 편집 override + 멱등/위임자 가드. */
class MessagingCalendarConfirmTest extends IntegrationTestBase {

  @Autowired MessagingProposalService proposalService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired DSLContext dsl;

  // AiAgentMessagingClient 모킹 — MessagingAttentionDispatcher 차단.
  @MockBean com.workplace.messaging.outbound.AiAgentMessagingClient aiClient;

  // 테스트 격리: 생성된 id 추적 → AfterEach 회수.
  private final List<Long> createdUserIds = new ArrayList<>();
  private final List<Long> createdChannelIds = new ArrayList<>();

  private long human;
  private long otherHuman;
  private long agentId;
  private long channelId;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    dsl.execute("set app.tenant_id='1'");
    human = seedUser("calc_human", "HUMAN");
    otherHuman = seedUser("calc_other", "HUMAN");
    agentId = seedUser("calc_agent", "AGENT");
    channelId = channelRepo.insertPublic("calc-ch-" + UUID.randomUUID(), human);
    createdChannelIds.add(channelId);
    memberRepo.add(channelId, human, "MEMBER");
    memberRepo.add(channelId, otherHuman, "MEMBER");
    memberRepo.add(channelId, agentId, "MEMBER");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
    // calendar_event / message / proposal / channel / user 순 회수.
    if (!createdUserIds.isEmpty()) {
      dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.in(createdUserIds)).execute();
    }
    if (!createdChannelIds.isEmpty()) {
      dsl.deleteFrom(MESSAGE_ACTION_PROPOSAL)
          .where(
              com.workplace.jooq.tables.MessageActionProposal.MESSAGE_ACTION_PROPOSAL.CHANNEL_ID.in(
                  createdChannelIds))
          .execute();
      dsl.deleteFrom(MESSAGE).where(MESSAGE.CHANNEL_ID.in(createdChannelIds)).execute();
      dsl.deleteFrom(com.workplace.jooq.Tables.CHANNEL_MEMBER)
          .where(com.workplace.jooq.Tables.CHANNEL_MEMBER.CHANNEL_ID.in(createdChannelIds))
          .execute();
      dsl.deleteFrom(com.workplace.jooq.Tables.CHANNEL)
          .where(com.workplace.jooq.Tables.CHANNEL.ID.in(createdChannelIds))
          .execute();
    }
    if (!createdUserIds.isEmpty()) {
      dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(createdUserIds)).execute();
      dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    }
    createdUserIds.clear();
    createdChannelIds.clear();
  }

  /** UUID suffix 유니크 유저 INSERT. USER_ROLE("USER") 함께 부여. */
  private long seedUser(String prefix, String kind) {
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "_" + suffix + "@example.com")
            .set(USER.KIND, kind)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId =
        dsl.select(com.workplace.jooq.Tables.ROLE.ID)
            .from(com.workplace.jooq.Tables.ROLE)
            .where(com.workplace.jooq.Tables.ROLE.NAME.eq("USER"))
            .fetchOne(com.workplace.jooq.Tables.ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    createdUserIds.add(id);
    return id;
  }

  private long proposeEvent() {
    return proposeEvent(null);
  }

  /** 일정 제안 — attendeeUserIds 는 ai-agent 가 username 을 해석해 보내는 초대 참석자(#852). */
  private long proposeEvent(List<Long> attendeeUserIds) {
    var req =
        new CreateProposalRequest(
            "calendar.create_event",
            "원안 제목",
            null,
            null,
            null,
            human,
            null,
            OffsetDateTime.parse("2026-07-03T09:00:00+09:00"),
            OffsetDateTime.parse("2026-07-03T10:00:00+09:00"),
            false,
            null,
            null,
            null,
            null,
            attendeeUserIds);
    MessageResponse saved = proposalService.propose(agentId, channelId, req);
    return saved.proposal().id();
  }

  @Test
  void confirm_withEdits_createsEventAndPostsResult() {
    long proposalId = proposeEvent();

    // 위임자가 제목·종료시간·장소를 수정해 승인.
    var body =
        new ConfirmProposalRequest(
            null,
            "수정된 제목",
            OffsetDateTime.parse("2026-07-03T09:00:00+09:00"),
            OffsetDateTime.parse("2026-07-03T10:30:00+09:00"),
            "수정된 장소");
    MessageResponse card = proposalService.confirmWithBody(human, proposalId, body);

    // 카드 CONFIRMED + result_issue_key="event:{id}".
    assertThat(card.proposal().status()).isEqualTo("CONFIRMED");
    assertThat(card.proposal().resultIssueKey()).startsWith("event:");

    // 편집된 값으로 일정이 실제 생성됐는지.
    var ev = dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.TITLE.eq("수정된 제목")).fetchOne();
    assertThat(ev).isNotNull();

    // 결과 메시지(일정 보기 링크)가 채널에 게시됐는지.
    int resultMsgs =
        dsl.fetchCount(
            dsl.selectFrom(MESSAGE)
                .where(MESSAGE.CHANNEL_ID.eq(channelId))
                .and(MESSAGE.BODY.like("%일정 만들었어요%")));
    assertThat(resultMsgs).isEqualTo(1);
  }

  @Test
  void confirm_byNonDelegator_throws() {
    long proposalId = proposeEvent();
    assertThatThrownBy(() -> proposalService.confirmWithBody(otherHuman, proposalId, null))
        .isInstanceOf(ProposalNotDelegatorException.class);
  }

  @Test
  void confirm_twice_secondThrows() {
    long proposalId = proposeEvent();
    proposalService.confirmWithBody(human, proposalId, null);
    assertThatThrownBy(() -> proposalService.confirmWithBody(human, proposalId, null))
        .isInstanceOf(IllegalStateException.class);
  }

  /** 초대 참석자는 제안 카드에 이름으로 보이고, 승인하면 실제 일정의 참석자가 된다(#852). */
  @Test
  void propose_withAttendees_showsNamesAndInvitesOnConfirm() {
    withMembership(human);
    withMembership(otherHuman);
    var saved =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest(
                "calendar.create_event",
                "참석자 회의",
                null,
                null,
                null,
                human,
                null,
                OffsetDateTime.parse("2026-07-04T09:00:00+09:00"),
                OffsetDateTime.parse("2026-07-04T10:00:00+09:00"),
                false,
                null,
                null,
                null,
                null,
                List.of(otherHuman, human)));
    // 위임자(human)는 승인 후 주최자라 카드의 초대 참석자에서 빠진다.
    assertThat(saved.proposal().attendees())
        .extracting(a -> a.userId(), a -> a.name())
        .containsExactly(org.assertj.core.groups.Tuple.tuple(otherHuman, "calc_other"));

    proposalService.confirmWithBody(human, saved.proposal().id(), null);

    var ev = dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.TITLE.eq("참석자 회의")).fetchOne();
    assertThat(ev).isNotNull();
    var attendeeIds =
        dsl.select(com.workplace.jooq.Tables.EVENT_ATTENDEE.USER_ID)
            .from(com.workplace.jooq.Tables.EVENT_ATTENDEE)
            .where(com.workplace.jooq.Tables.EVENT_ATTENDEE.EVENT_ID.eq(ev.getId()))
            .fetch(com.workplace.jooq.Tables.EVENT_ATTENDEE.USER_ID);
    assertThat(attendeeIds).containsExactlyInAnyOrder(human, otherHuman);
  }

  /** 워크스페이스 구성원이 아닌 참석자가 섞이면 카드를 만들지 않는다 — 승인 시점이 아니라 제안 시점에 AI 에게 사유가 돌아간다(#852). */
  @Test
  void propose_withNonMemberAttendee_isRejectedWithoutCard() {
    withMembership(human);
    int before =
        dsl.fetchCount(
            MESSAGE_ACTION_PROPOSAL,
            com.workplace.jooq.tables.MessageActionProposal.MESSAGE_ACTION_PROPOSAL.CHANNEL_ID.eq(
                channelId));
    // otherHuman 은 이 테스트에서 멤버십을 주지 않는다.
    assertThatThrownBy(() -> proposeEvent(List.of(otherHuman)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("userId=[" + otherHuman + "]");
    assertThat(
            dsl.fetchCount(
                MESSAGE_ACTION_PROPOSAL,
                com.workplace.jooq.tables.MessageActionProposal.MESSAGE_ACTION_PROPOSAL.CHANNEL_ID
                    .eq(channelId)))
        .isEqualTo(before);
  }
}
