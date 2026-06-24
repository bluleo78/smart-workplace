package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.MessageActionProposalRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 메시지 목록 조회 시 proposal batch enrich 검증. 제안이 있는 메시지는 proposal != null, 없는 메시지는 null. */
@Transactional
class MessageProposalEnrichTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;
  @Autowired MessageRepository messageRepo;
  @Autowired MessageActionProposalRepository proposalRepo;

  private long human;
  private long agent;
  private long channelId;

  /** 테스트 격리를 위해 UUID suffix 로 유니크 유저를 직접 INSERT 후 ID 반환. */
  private long seedUser(String prefix, String kind) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix + suffix)
        .set(USER.EMAIL, prefix + "_" + suffix + "@example.com")
        .set(USER.KIND, kind)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long postMessage(long userId, long chId, String body) {
    return messageService.create(userId, chId, new CreateMessageRequest(body)).id();
  }

  @BeforeEach
  void setUp() {
    human = seedUser("prop_human", "HUMAN");
    agent = seedUser("prop_agent", "AGENT");
    channelId = channelRepo.insertPublic("제안채널", human);
    channelService.join(human, channelId);
    channelService.join(agent, channelId);
  }

  @Test
  void channelMessages_carryProposalWhenPresent() {
    // 제안 없는 일반 메시지
    long plain = postMessage(human, channelId, "일반 메시지");
    // 제안이 붙을 AI 메시지
    long proposalMsg = postMessage(agent, channelId, "제안 카드 메시지");

    // proposalRepo.insert: AI가 human 대신 CREATE_ISSUE 제안을 시드
    proposalRepo.insert(
        proposalMsg,
        channelId,
        human,
        "CREATE_ISSUE",
        "{\"title\":\"리팩터\",\"priority\":\"HIGH\",\"projectName\":\"내 작업\"}");

    var page = messageService.list(human, channelId, null, 50);

    var withProposal =
        page.items().stream().filter(m -> m.id() == proposalMsg).findFirst().orElseThrow();
    var without = page.items().stream().filter(m -> m.id() == plain).findFirst().orElseThrow();

    // 제안 없는 메시지는 null
    assertThat(without.proposal()).isNull();

    // 제안 있는 메시지는 payload 필드 정확히 채워져야 함
    assertThat(withProposal.proposal()).isNotNull();
    assertThat(withProposal.proposal().title()).isEqualTo("리팩터");
    assertThat(withProposal.proposal().priority()).isEqualTo("HIGH");
    assertThat(withProposal.proposal().projectName()).isEqualTo("내 작업");
    assertThat(withProposal.proposal().status()).isEqualTo("PENDING");
    assertThat(withProposal.proposal().actionType()).isEqualTo("CREATE_ISSUE");
    assertThat(withProposal.proposal().proposedByUserId()).isEqualTo(human);
  }

  /** calendar.create_event 페이로드를 가진 제안이 enrich 시 시간·장소·충돌 필드를 올바르게 노출하는지 검증. */
  @Test
  void enrich_calendarProposal_surfacesTimeAndConflicts() {
    // calendar.create_event payload 로 제안 행을 직접 INSERT 후 enrich 결과 확인.
    String payload =
        "{\"title\":\"리뷰 미팅\",\"startsAt\":\"2026-07-04T13:00:00+09:00\","
            + "\"endsAt\":\"2026-07-04T14:00:00+09:00\",\"location\":\"3층\",\"allDay\":false,"
            + "\"conflicts\":[{\"id\":7,\"title\":\"기존 회의\",\"startsAt\":\"2026-07-04T13:30:00+09:00\","
            + "\"endsAt\":\"2026-07-04T14:30:00+09:00\"}]}";
    long messageId =
        messageRepo.insert(channelId, agent, "💡 일정 생성을 제안했어요", java.util.List.of(), null);
    proposalRepo.insert(messageId, channelId, human, "calendar.create_event", payload);

    // list() 를 통해 proposal enrich 경로 전체를 검증한다.
    var page = messageService.list(human, channelId, null, 50);
    var m = page.items().stream().filter(msg -> msg.id() == messageId).findFirst().orElseThrow();

    assertThat(m.proposal().actionType()).isEqualTo("calendar.create_event");
    assertThat(m.proposal().startsAt()).isEqualTo("2026-07-04T13:00:00+09:00");
    assertThat(m.proposal().location()).isEqualTo("3층");
    assertThat(m.proposal().conflicts()).hasSize(1);
    assertThat(m.proposal().conflicts().get(0).title()).isEqualTo("기존 회의");
  }
}
