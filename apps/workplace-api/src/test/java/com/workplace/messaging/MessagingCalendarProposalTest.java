package com.workplace.messaging;

import static com.workplace.jooq.Tables.MESSAGE_ACTION_PROPOSAL;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

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
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;

/** 일정 제안(calendar.create_event) propose 통합 테스트 — 프로젝트 후보 계산 없이 일정 payload 가 저장되는지. */
class MessagingCalendarProposalTest extends IntegrationTestBase {

  @Autowired MessagingProposalService proposalService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;

  @MockBean com.workplace.messaging.outbound.AiAgentMessagingClient aiClient;

  private long human;
  private long agentId;
  private long channelId;

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
    TenantContext.clear();
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
