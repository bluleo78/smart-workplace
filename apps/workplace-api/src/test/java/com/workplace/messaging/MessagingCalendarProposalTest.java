package com.workplace.messaging;

import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.MESSAGE_ACTION_PROPOSAL;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateProposalRequest;
import com.workplace.messaging.dto.MessageResponse;
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
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** 일정 제안(calendar.create_event) propose 통합 테스트 — 프로젝트 후보 계산 없이 일정 payload 가 저장되는지. */
class MessagingCalendarProposalTest extends IntegrationTestBase {

  @Autowired MessagingProposalService proposalService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;

  @MockitoBean com.workplace.messaging.outbound.AiAgentMessagingClient aiClient;

  private long human;
  private long agentId;
  private long channelId;
  private final List<Long> extraUsers = new ArrayList<>();

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    dsl.execute("set app.tenant_id='1'");
    human = seedUser("cal_human", "HUMAN");
    agentId = seedUser("cal_agent", "AGENT");
    channelId = channelRepo.insertPublic("cal-ch-" + UUID.randomUUID(), human);
    memberRepo.add(channelId, human, "MEMBER");
    memberRepo.add(channelId, agentId, "MEMBER");
  }

  @AfterEach
  void tearDown() {
    // #512 누수 차단: 생성한 proposal/channel/user 를 테넌트 GUC 주입 트랜잭션 안에서 회수(RLS-안전).
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(MESSAGE_ACTION_PROPOSAL)
              .where(MESSAGE_ACTION_PROPOSAL.CHANNEL_ID.eq(channelId))
              .execute();
          channelRepo.hardDelete(channelId); // channel_member/message CASCADE
          dsl.deleteFrom(USER).where(USER.ID.in(human, agentId)).execute(); // user_role CASCADE
          dsl.deleteFrom(USER).where(USER.ID.in(extraUsers)).execute();
        });
  }

  @Test
  void propose_calendarEvent_storesEventPayloadWithoutProject() throws Exception {
    var req =
        new CreateProposalRequest(
            "calendar.create_event",
            "팀 동기화 미팅",
            null,
            null,
            null,
            human,
            null,
            OffsetDateTime.parse("2026-07-02T10:00:00+09:00"),
            OffsetDateTime.parse("2026-07-02T11:00:00+09:00"),
            false,
            "회의실 A",
            10,
            null,
            null,
            null);

    MessageResponse saved = proposalService.propose(agentId, channelId, req);

    // proposal enrich 응답에 일정 actionType 이 실려야 한다.
    assertThat(saved.proposal()).isNotNull();
    assertThat(saved.proposal().actionType()).isEqualTo("calendar.create_event");

    // payload 에 일정 필드가 저장되고, 이슈 전용 projectKey 는 없어야 한다.
    String payload =
        dsl.select(MESSAGE_ACTION_PROPOSAL.PAYLOAD)
            .from(MESSAGE_ACTION_PROPOSAL)
            .where(MESSAGE_ACTION_PROPOSAL.MESSAGE_ID.eq(saved.id()))
            .fetchOne()
            .value1()
            .data();
    JsonNode p = objectMapper.readTree(payload);
    assertThat(p.path("title").asText()).isEqualTo("팀 동기화 미팅");
    assertThat(p.path("startsAt").asText()).isEqualTo("2026-07-02T10:00:00+09:00");
    assertThat(p.path("location").asText()).isEqualTo("회의실 A");
    assertThat(p.has("projectKey")).isFalse();
  }

  /**
   * #848: 위임자에게 calendar:write 가 없으면 카드를 만들기 전에 거절한다 — 예전엔 PENDING 카드가 생기고 승인해야 403 이 났다. 거절 사유는 예외
   * 그대로 ai-agent 툴 결과로 돌아가 AI 가 사용자에게 설명한다. 카드 메시지·제안 행 모두 남지 않아야 한다.
   */
  @Test
  void propose_calendarEvent_delegatorWithoutCalendarWrite_createsNoCard() {
    long noRole = seedUserWithoutRole("cal_norole");
    memberRepo.add(channelId, noRole, "MEMBER");
    extraUsers.add(noRole);

    assertThatThrownBy(() -> proposalService.propose(agentId, channelId, calendarReq(noRole, null)))
        .isInstanceOf(AccessDeniedException.class)
        .hasMessageContaining("calendar:write");
    assertThat(countProposals()).isZero();
    assertThat(countMessages()).isZero();
  }

  /** #848: 승인 시점에야 드러나던 잘못된 반복 규칙도 제안 단계에서 400 사유로 돌려준다(카드 미생성). */
  @Test
  void propose_calendarEvent_invalidRecurrence_createsNoCard() {
    assertThatThrownBy(
            () -> proposalService.propose(agentId, channelId, calendarReq(human, "FREQ=SOMETIMES")))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(countProposals()).isZero();
    assertThat(countMessages()).isZero();
  }

  private CreateProposalRequest calendarReq(long delegator, String rrule) {
    return new CreateProposalRequest(
        "calendar.create_event",
        "사전검증 미팅",
        null,
        null,
        null,
        delegator,
        null,
        OffsetDateTime.parse("2026-07-02T10:00:00+09:00"),
        OffsetDateTime.parse("2026-07-02T11:00:00+09:00"),
        false,
        null,
        null,
        rrule,
        null,
        null);
  }

  private int countProposals() {
    return dsl.fetchCount(
        MESSAGE_ACTION_PROPOSAL, MESSAGE_ACTION_PROPOSAL.CHANNEL_ID.eq(channelId));
  }

  private int countMessages() {
    return dsl.fetchCount(MESSAGE, MESSAGE.CHANNEL_ID.eq(channelId));
  }

  /** 역할 없는 사용자(= calendar:write 없음) INSERT. */
  private long seedUserWithoutRole(String prefix) {
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix)
        .set(USER.EMAIL, prefix + "_" + suffix + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  // ── 헬퍼 ──────────────────────────────────────────────────────────────────

  /** UUID suffix 유니크 유저 INSERT. USER_ROLE("USER") 함께 부여 — RLS 권한 분기 통과. */
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
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }
}
