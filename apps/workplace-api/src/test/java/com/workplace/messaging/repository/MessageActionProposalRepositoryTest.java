package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** message_action_proposal 리포지토리 통합 테스트. 클래스 레벨 @Transactional 로 인프로세스 롤백. */
@Transactional
class MessageActionProposalRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MessageActionProposalRepository repo;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;

  long delegatorId;
  long channelId;

  @BeforeEach
  void seed() {
    delegatorId = seedUser("delegator");
    channelId = channelRepo.insertPublic("TestDelegationChannel", delegatorId);
    channelService.join(delegatorId, channelId);
  }

  /** 고유 사용자 시드 헬퍼. */
  private long seedUser(String prefix) {
    String s = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix + " User")
        .set(USER.EMAIL, prefix + "_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 채널에 메시지 1건을 INSERT 하고 id 를 반환하는 헬퍼. */
  private long seedMessage() {
    return messageService.create(delegatorId, channelId, new CreateMessageRequest("테스트 메시지")).id();
  }

  /** insert 후 findById 로 필드값이 정확히 복원되는지 검증. */
  @Test
  void insert_thenFindById_carriesFields() {
    // given: 채널에 메시지 1건 INSERT
    long messageId = seedMessage();
    String payload = "{\"title\":\"리팩터\",\"priority\":\"MID\"}";

    // when: PENDING 상태로 제안 INSERT
    long id = repo.insert(messageId, channelId, delegatorId, "CREATE_ISSUE", payload);

    // then: 조회 시 모든 필드 일치
    var row = repo.findById(id).orElseThrow();
    assertThat(row.messageId()).isEqualTo(messageId);
    assertThat(row.channelId()).isEqualTo(channelId);
    assertThat(row.proposedByUserId()).isEqualTo(delegatorId);
    assertThat(row.actionType()).isEqualTo("CREATE_ISSUE");
    assertThat(row.status()).isEqualTo("PENDING");
    assertThat(row.payloadJson()).contains("리팩터");
    assertThat(row.resultIssueKey()).isNull();
    assertThat(row.resolvedBy()).isNull();
    assertThat(row.resolvedAt()).isNull();
    assertThat(row.createdAt()).isNotNull();
  }

  /** updateStatus 는 PENDING 일 때만 전이, 이후 호출은 false(멱등 가드). */
  @Test
  void updateStatus_onlyWhenPending_isIdempotent() {
    long messageId = seedMessage();
    long id = repo.insert(messageId, channelId, delegatorId, "CREATE_ISSUE", "{}");

    // PENDING → CONFIRMED: 성공
    assertThat(repo.updateStatus(id, "CONFIRMED", "PROJ-1", delegatorId)).isTrue();
    // CONFIRMED → REJECTED: PENDING 가드로 차단되어야 함
    assertThat(repo.updateStatus(id, "REJECTED", null, delegatorId)).isFalse();
    // 상태가 CONFIRMED 로 유지되어야 함
    assertThat(repo.findById(id).orElseThrow().status()).isEqualTo("CONFIRMED");
    assertThat(repo.findById(id).orElseThrow().resultIssueKey()).isEqualTo("PROJ-1");
  }

  /** findByMessageIds 는 존재하는 message_id 만 반환하고 없는 id 는 무시한다. */
  @Test
  void findByMessageIds_batchLoads() {
    long m1 = seedMessage();
    long id = repo.insert(m1, channelId, delegatorId, "CREATE_ISSUE", "{}");

    // m1 은 존재, 999999 는 없는 id
    var rows = repo.findByMessageIds(List.of(m1, 999999L));
    assertThat(rows)
        .extracting(MessageActionProposalRepository.ProposalRow::id)
        .containsExactly(id);
  }

  /** findByMessageIds 에 빈 컬렉션 전달 시 빈 리스트 반환(쿼리 실행 안 함). */
  @Test
  void findByMessageIds_emptyInput_returnsEmpty() {
    var rows = repo.findByMessageIds(List.of());
    assertThat(rows).isEmpty();
  }
}
