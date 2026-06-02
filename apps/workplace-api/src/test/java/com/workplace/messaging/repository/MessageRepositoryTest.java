package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.MessagePage;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** message 리포지토리 cursor 페이징 통합 테스트 (test DB:5435). */
class MessageRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired MessageRepository messageRepo;

  /** 테스트용 USER 를 직접 INSERT 하고 ID 반환. 테스트 격리를 위해 매 호출마다 유니크 username 사용. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "msg_test_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "MsgTest" + suffix)
        .set(USER.EMAIL, "msg_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void insert_thenPage_returnsDescending() {
    long uid = seedUser();
    long channelId = channelRepo.insertPublic("일반", uid);

    long m1 = messageRepo.insert(channelId, uid, "first", java.util.List.of(), null);
    long m2 = messageRepo.insert(channelId, uid, "second", java.util.List.of(), null);

    // 멘션이 없는 메시지이므로 resolver 는 빈 목록을 돌려주는 trivial 구현으로 충분.
    MessagePage page = messageRepo.findPage(channelId, null, 50, ids -> java.util.List.of());
    assertThat(page.items()).hasSize(2);
    assertThat(page.items().get(0).id()).isEqualTo(m2);
    assertThat(page.items().get(1).id()).isEqualTo(m1);
    assertThat(page.hasMore()).isFalse();
  }
}
