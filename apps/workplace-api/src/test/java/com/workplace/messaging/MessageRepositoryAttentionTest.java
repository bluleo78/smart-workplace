package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * MessageRepository 어텐션 신호 조회 통합 테스트.
 * - listRecentUnreadForChannel: watermark 이후 메시지만 반환
 * - maxMessageId: 채널 최신 메시지 id
 */
@Transactional
class MessageRepositoryAttentionTest extends IntegrationTestBase {

  @Autowired MessageRepository repo;
  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;

  /** RLS 게이트: test DB 세션에 tenant_id=1 주입. */
  @BeforeEach
  void setTenant() {
    dsl.execute("set app.tenant_id='1'");
  }

  /** 테스트 격리를 위해 UUID suffix 유니크 유저 INSERT 후 ID 반환. */
  private long seedUser(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix + suffix)
        .set(USER.EMAIL, prefix + "_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 퍼블릭 채널 생성 후 id 반환. */
  private long seedChannel(long ownerId) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 6);
    return channelRepo.insertPublic("attention-ch-" + suffix, ownerId);
  }

  /** 채널에 메시지 INSERT 후 id 반환. */
  private long seedMessage(long channelId, long authorId, String body, List<Long> mentions) {
    return repo.insert(channelId, authorId, body, mentions, null);
  }

  /**
   * watermark(uptoExclusiveReadId) 이후 메시지만 반환하는지 검증.
   * m1 이후 메시지(m2)만 결과에 포함되어야 한다.
   */
  @Test
  void listRecentUnreadForChannel_watermark이후만() {
    long owner = seedUser("owner");
    long ch = seedChannel(owner);
    long m1 = seedMessage(ch, owner, "hi", List.of());
    long m2 = seedMessage(ch, owner, "동희 봤어?", List.of());

    // uptoExclusiveReadId=m1 → m1 초과인 m2 만 반환.
    var rows = repo.listRecentUnreadForChannel(ch, m1, 50);
    assertThat(rows).extracting(MessageRepository.RecentUnread::id)
        .containsExactly(m2);
  }

  /**
   * 스레드 답글(parent_message_id 있음)은 listRecentUnreadForChannel 에서 제외되어야 한다.
   */
  @Test
  void listRecentUnreadForChannel_스레드답글_제외() {
    long owner = seedUser("thr");
    long ch = seedChannel(owner);
    long root = seedMessage(ch, owner, "root", List.of());
    // 스레드 답글 INSERT (parent_message_id = root)
    repo.insert(ch, owner, "reply", List.of(), root);

    var rows = repo.listRecentUnreadForChannel(ch, 0L, 50);
    assertThat(rows).extracting(MessageRepository.RecentUnread::id)
        .containsExactly(root); // 답글 제외, root만
  }

  /**
   * maxMessageId 는 채널 최신 미삭제 메시지 id 를 반환, 없으면 0.
   */
  @Test
  void maxMessageId_최신메시지id() {
    long owner = seedUser("maxid");
    long ch = seedChannel(owner);

    // 메시지 없으면 0.
    assertThat(repo.maxMessageId(ch)).isEqualTo(0L);

    long m1 = seedMessage(ch, owner, "a", List.of());
    long m2 = seedMessage(ch, owner, "b", List.of());
    assertThat(repo.maxMessageId(ch)).isEqualTo(m2);
  }
}
