package com.workplace.messaging;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.service.DmService;
import com.workplace.messaging.service.MessagePushRecipientResolver;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * 리뷰 #866 — 푸시 수신자 계산이 실패해도 메시지 작성은 커밋된다. 계산은 커밋 후 별도 트랜잭션(resolver)에서 돌기 때문에 작성 트랜잭션과 분리돼 있다(이전
 * 세이브포인트 방식의 대체). 실제 COMMIT 을 봐야 하므로 @Transactional 을 붙이지 않고 수동 정리한다.
 */
class MessagePushResolverFailureTest extends IntegrationTestBase {

  @MockitoSpyBean MessagePushRecipientResolver resolver;
  @Autowired DSLContext dsl;
  @Autowired DmService dmService;
  @Autowired MessageService messageService;

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
    long id = withMembership(TestFixtures.createHuman(dsl));
    users.add(id);
    return id;
  }

  @Test
  void resolverThrows_messageStillCommitted() {
    long me = seedUser();
    long you = seedUser();
    doThrow(new IllegalStateException("resolver boom")).when(resolver).resolve(any());
    channelId = dmService.createOrGet(me, List.of(you)).dm().id();

    MessageResponse saved = messageService.create(me, channelId, new CreateMessageRequest("안녕하세요"));

    // 커밋 후 리스너가 실제로 resolver 를 호출(그리고 실패)했는지 확인 — 실패 경로를 타지 않고 통과하는 거짓 양성 방지.
    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> verify(resolver).resolve(any()));
    assertThat(dsl.fetchExists(dsl.selectOne().from(MESSAGE).where(MESSAGE.ID.eq(saved.id()))))
        .isTrue();
  }
}
