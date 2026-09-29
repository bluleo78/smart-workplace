package com.workplace.notify.push;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessagePushRequestedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;

/**
 * 리뷰 #866 라운드2 — publishPushRequest 의 조회(listMembers) 중 "진짜" PostgreSQL 오류가 나면 그 트랜잭션 전체가 abort 상태가
 * 된다. 세이브포인트(PROPAGATION_NESTED) 없이 단순 try/catch 만으로는 그 뒤 커밋(메시지 INSERT 포함)이 "current transaction
 * is aborted" 로 실패해 메시지 자체가 롤백된다. 이 테스트는 {@link ChannelMemberRepository#listMembers} 호출 시점에 존재하지 않는
 * 테이블을 조회해 실제 PG 오류를 주입하고, 그럼에도 메시지가 커밋되고(별도 조회로 확인) 푸시 이벤트만 발행되지 않음을 검증한다. @Transactional 을 붙이지
 * 않는다 — 실제 COMMIT 여부를 봐야 하므로(MessagePushDeliveryTest 와 동일한 이유).
 */
@RecordApplicationEvents
class MessagePushSavepointTest extends IntegrationTestBase {

  @MockitoSpyBean ChannelMemberRepository memberRepo;
  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ApplicationEvents events;

  final List<Long> users = new ArrayList<>();
  long channelId;

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (channelId != 0) dsl.deleteFrom(MESSAGE).where(MESSAGE.CHANNEL_ID.eq(channelId)).execute();
    if (!users.isEmpty()) {
      dsl.deleteFrom(CHANNEL).where(CHANNEL.CREATED_BY.in(users)).execute();
      dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    }
    users.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "spu_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Spu" + s)
            .set(USER.EMAIL, "spu_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    users.add(id);
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  @Test
  void listMembersSqlFailure_savepointProtectsMessageCommit() {
    long me = seedUser();
    long member = seedUser();
    channelId =
        channelService
            .create(me, "sp-" + UUID.randomUUID().toString().substring(0, 8), "PUBLIC")
            .id();
    memberRepo.add(channelId, member, "MEMBER"); // 실제 위임 호출(스텁 대상 아님)

    // 이 채널의 listMembers 호출에서만 존재하지 않는 테이블을 조회해 진짜 PG 오류(트랜잭션 abort)를 재현한다.
    doAnswer(
            invocation -> {
              dsl.fetchOne("SELECT 1 FROM no_such_table_866_savepoint_probe");
              return null; // 위 fetchOne 이 항상 예외를 던지므로 도달하지 않음
            })
        .when(memberRepo)
        .listMembers(channelId);

    MessageResponse saved =
        messageService.create(me, channelId, new CreateMessageRequest("<@" + member + "> 확인"));

    assertThat(saved).isNotNull();
    // 반환값만으로는 실제 커밋 여부를 알 수 없으므로 별도 조회로 DB 에 실제 반영됐는지 확인한다.
    assertThat(dsl.fetchExists(dsl.selectOne().from(MESSAGE).where(MESSAGE.ID.eq(saved.id()))))
        .isTrue();
    assertThat(events.stream(MessagePushRequestedEvent.class)).isEmpty();
  }
}
