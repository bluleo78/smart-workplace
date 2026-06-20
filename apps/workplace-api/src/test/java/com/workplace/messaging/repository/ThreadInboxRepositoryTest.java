package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.service.ChannelMemberService;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 크로스채널 인박스 집계 검증 — 팔로우+미읽음 스레드만, 활동순. */
@Transactional
class ThreadInboxRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired ChannelMemberService channelMemberService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ThreadReadStateRepository repo;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "tib_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Tib" + s)
        .set(USER.EMAIL, "tib_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 두 채널에 미읽음 스레드 → 인박스에 둘 다, 최근 활동순. 카운트=2. */
  @Test
  void inbox_aggregatesAcrossChannels_activityOrder() {
    long me = seedUser();
    long other = seedUser();
    long chA = channelRepo.insertPublic("A", other);
    long chB = channelRepo.insertPublic("B", other);
    channelService.join(other, chA);
    channelService.join(me, chA);
    channelService.join(other, chB);
    channelService.join(me, chB);
    // me 가 양 채널에 루트 작성(자동 팔로우) → other 가 답글(미읽음).
    long rootA = messageService.create(me, chA, new CreateMessageRequest("부모A")).id();
    long rootB = messageService.create(me, chB, new CreateMessageRequest("부모B")).id();
    messageService.create(other, chA, new CreateMessageRequest("답A", rootA));
    messageService.create(other, chB, new CreateMessageRequest("답B", rootB)); // B 가 더 최근

    var page = repo.inboxPage(me, null, 50);
    assertThat(page.rows()).hasSize(2);
    // 최근 활동(B) 먼저.
    assertThat(page.rows().get(0).rootId()).isEqualTo(rootB);
    assertThat(page.rows().get(0).channelName()).isEqualTo("B");
    assertThat(page.rows().get(0).unreadReplyCount()).isEqualTo(1);
    assertThat(repo.inboxUnreadThreadCount(me)).isEqualTo(2);
  }

  /** 읽음 처리한 스레드는 인박스에서 빠지고 카운트 감소. */
  @Test
  void inbox_excludesReadThreads() {
    long me = seedUser();
    long other = seedUser();
    long ch = channelRepo.insertPublic("A", other);
    channelService.join(other, ch);
    channelService.join(me, ch);
    long root = messageService.create(me, ch, new CreateMessageRequest("부모")).id();
    messageService.create(other, ch, new CreateMessageRequest("답", root));

    assertThat(repo.inboxUnreadThreadCount(me)).isEqualTo(1);
    // me 가 그 스레드를 읽음 처리(1단계).
    messageService.markThreadRead(me, root);
    assertThat(repo.inboxPage(me, null, 50).rows()).isEmpty();
    assertThat(repo.inboxUnreadThreadCount(me)).isZero();
  }

  /**
   * 채널 탈퇴 후 인박스 제외 검증 — 멤버십 스코프 버그 회귀 방지.
   *
   * <p>탈퇴 후 thread_read_state 행은 잔존하지만 CHANNEL_MEMBER INNER JOIN 으로 인박스에서 제거되어야 한다.
   */
  @Test
  void inbox_excludesThreadsInLeftChannels() {
    long owner = seedUser(); // 채널 소유자(OWNER = 탈퇴 불가)
    long me = seedUser(); // 팔로우 후 탈퇴할 사용자
    long ch = channelRepo.insertPublic("LeaveTest", owner);
    channelService.join(owner, ch);
    channelService.join(me, ch);
    // owner 가 루트 작성(me 는 비작성자) → owner 가 답글(me 의 미읽음 발생)
    long root = messageService.create(owner, ch, new CreateMessageRequest("루트")).id();
    messageService.create(owner, ch, new CreateMessageRequest("답글", root));
    // me 가 루트 작성자가 아니므로 자동 팔로우 여부 확인 — 명시적 팔로우(followerIfAbsent)
    repo.followIfAbsent(root, me);
    // 탈퇴 전: 인박스에 해당 스레드 존재해야 함
    assertThat(repo.inboxPage(me, null, 50).rows()).hasSize(1);
    assertThat(repo.inboxUnreadThreadCount(me)).isEqualTo(1);
    // me 가 채널 탈퇴 — thread_read_state 행은 삭제되지 않음(V76 FK 캐스케이드 없음)
    channelMemberService.leave(me, ch);
    // 탈퇴 후: 멤버십 스코프로 인박스/카운트 모두 0
    assertThat(repo.inboxPage(me, null, 50).rows()).isEmpty();
    assertThat(repo.inboxUnreadThreadCount(me)).isZero();
  }

  /** keyset 페이지네이션: limit 1 로 2페이지 분할. */
  @Test
  void inbox_keysetPagination() {
    long me = seedUser();
    long other = seedUser();
    long ch = channelRepo.insertPublic("A", other);
    channelService.join(other, ch);
    channelService.join(me, ch);
    long r1 = messageService.create(me, ch, new CreateMessageRequest("부모1")).id();
    long r2 = messageService.create(me, ch, new CreateMessageRequest("부모2")).id();
    messageService.create(other, ch, new CreateMessageRequest("답1", r1));
    messageService.create(other, ch, new CreateMessageRequest("답2", r2));

    var p1 = repo.inboxPage(me, null, 1);
    assertThat(p1.rows()).hasSize(1);
    assertThat(p1.hasMore()).isTrue();
    assertThat(p1.nextCursor()).isNotNull();
    var p2 = repo.inboxPage(me, p1.nextCursor(), 1);
    assertThat(p2.rows()).hasSize(1);
    // 서로 다른 스레드.
    assertThat(p2.rows().get(0).rootId()).isNotEqualTo(p1.rows().get(0).rootId());
    // 정렬 검증: r2 답글(답2)이 더 최근 → 1페이지=r2, 2페이지=r1 (정렬 역전 회귀 방지).
    assertThat(p1.rows().get(0).rootId()).isEqualTo(r2);
    assertThat(p2.rows().get(0).rootId()).isEqualTo(r1);
  }
}
