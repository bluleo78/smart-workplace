package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.MessageActionProposalRepository;
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
}
