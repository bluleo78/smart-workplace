package com.workplace.messaging;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.MESSAGE_REACTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.messaging.service.ReactionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 리액션 상한이 동시 요청에도 지켜지는지(WP-778) — 한 사람이 서로 다른 이모지를 한꺼번에 보내도 한 메시지에 20개를 넘지 않는다. 고치기 전에는 동시 요청이 모두
 * 「20개 미만」으로 읽고 함께 삽입해 상한을 넘겼다. 커밋되는 트랜잭션이 필요해 클래스에 {@code @Transactional} 을 쓰지 않는다.
 */
class ReactionConcurrentCapTest extends IntegrationTestBase {

  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ReactionService reactionService;
  @Autowired ChannelRepository channelRepo;

  private final List<Long> users = new ArrayList<>();
  private long channelId;
  private long messageId;
  private long reactor;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "rxc_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Rxc" + s)
            .set(USER.EMAIL, "rxc_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    TestFixtures.addMember(baseDsl, id, 1L);
    users.add(id);
    return id;
  }

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    long author = seedUser();
    reactor = seedUser();
    channelId = channelRepo.insertPublic("rx-cap-" + UUID.randomUUID(), author);
    channelService.join(author, channelId);
    channelService.join(reactor, channelId);
    messageId = messageService.create(author, channelId, new CreateMessageRequest("hi")).id();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          baseDsl
              .deleteFrom(MESSAGE_REACTION)
              .where(MESSAGE_REACTION.MESSAGE_ID.eq(messageId))
              .execute();
          baseDsl.deleteFrom(MESSAGE).where(MESSAGE.CHANNEL_ID.eq(channelId)).execute();
          baseDsl
              .deleteFrom(CHANNEL_MEMBER)
              .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId))
              .execute();
          baseDsl.deleteFrom(CHANNEL).where(CHANNEL.ID.eq(channelId)).execute();
        });
    TenantContext.clear();
  }

  /** 서로 다른 이모지 30개를 동시에 보내면 정확히 20개만 저장되고 나머지는 400(IllegalArgumentException)이다. */
  @Test
  void concurrentDistinctEmojis_stopAtPerUserLimit() throws Exception {
    int n = 30;
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(n);
    try {
      List<Future<Boolean>> results = new ArrayList<>();
      IntStream.range(0, n)
          .forEach(
              i ->
                  results.add(
                      pool.submit(
                          () -> {
                            TenantContext.set(1L);
                            try {
                              start.await(10, TimeUnit.SECONDS);
                              reactionService.add(
                                  reactor, messageId, new String(Character.toChars(0x1F600 + i)));
                              return true;
                            } catch (IllegalArgumentException e) {
                              return false;
                            } finally {
                              TenantContext.clear();
                            }
                          })));
      start.countDown();
      long accepted = 0;
      for (Future<Boolean> f : results) if (f.get(60, TimeUnit.SECONDS)) accepted++;

      assertThat(accepted).isEqualTo(20);
      assertThat(
              baseDsl.fetchCount(
                  MESSAGE_REACTION,
                  MESSAGE_REACTION
                      .MESSAGE_ID
                      .eq(messageId)
                      .and(MESSAGE_REACTION.USER_ID.eq(reactor))))
          .isEqualTo(20);
    } finally {
      pool.shutdownNow();
    }
  }
}
