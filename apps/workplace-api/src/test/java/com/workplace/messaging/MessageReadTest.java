package com.workplace.messaging;

import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 읽음 추적(markRead watermark) + 채널 unread-count 집계 통합 테스트. */
class MessageReadTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;

  private long author;
  private long reader;
  private long channelId;

  /** 테스트 격리를 위해 UUID suffix 유니크 유저 INSERT 후 ID 반환. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "read_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Read" + suffix)
        .set(USER.EMAIL, "read_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** channelId 채널에서 reader 의 unreadCount 조회(findMyChannels 사이드바 응답 기준). */
  private long readerUnread() {
    return channelRepo.findMyChannels(reader).stream()
        .filter(c -> c.id() == channelId)
        .map(ChannelResponse::unreadCount)
        .findFirst()
        .orElseThrow();
  }

  /** channel_member.last_read_message_id 직접 조회. */
  private Long lastRead(long userId) {
    return dsl.select(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID)
        .from(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .fetchOne(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID);
  }

  @BeforeEach
  void setUp() {
    author = seedUser();
    reader = seedUser();
    channelId = channelRepo.insertPublic("read-채널", author);
    channelService.join(author, channelId);
    channelService.join(reader, channelId);
  }

  /** markRead(upto) 가 last_read 를 upto 로 갱신하고, 더 작은 upto 로는 감소하지 않는다(GREATEST). */
  @Test
  void markRead_setsWatermark_andDoesNotDecrease() {
    long m1 = messageService.create(author, channelId, new CreateMessageRequest("1")).id();
    long m2 = messageService.create(author, channelId, new CreateMessageRequest("2")).id();

    messageService.markRead(reader, channelId, m2);
    assertThat(lastRead(reader)).isEqualTo(m2);

    // 더 작은 watermark 로 다시 호출 → 감소하지 않음.
    messageService.markRead(reader, channelId, m1);
    assertThat(lastRead(reader)).isEqualTo(m2);
  }

  /** 타인이 작성한 N개의 미읽음 메시지 → unreadCount == N. 본인 작성 메시지는 제외. */
  @Test
  void unreadCount_countsOthersMessages_excludesOwn() {
    messageService.create(author, channelId, new CreateMessageRequest("a1"));
    messageService.create(author, channelId, new CreateMessageRequest("a2"));
    messageService.create(author, channelId, new CreateMessageRequest("a3"));
    // reader 본인이 작성한 메시지는 unread 에서 제외되어야 한다.
    messageService.create(reader, channelId, new CreateMessageRequest("self"));

    assertThat(readerUnread()).isEqualTo(3L);

    // 마지막까지 읽음 처리하면 0.
    long last = messageService.create(author, channelId, new CreateMessageRequest("a4")).id();
    messageService.markRead(reader, channelId, last);
    assertThat(readerUnread()).isEqualTo(0L);
  }

  /** 가입 시점에 last_read 가 최신 메시지로 초기화되어, 가입 이전 히스토리는 unread 로 보이지 않는다. */
  @Test
  void newMemberJoin_initializesLastRead_preJoinHistoryNotUnread() {
    long late = seedUser();
    // late 가입 전 author 가 메시지 3건 작성.
    messageService.create(author, channelId, new CreateMessageRequest("h1"));
    messageService.create(author, channelId, new CreateMessageRequest("h2"));
    messageService.create(author, channelId, new CreateMessageRequest("h3"));

    // 가입 경로(channelService.join → memberRepo.add)에서 last_read 를 최신 id 로 초기화.
    channelService.join(late, channelId);

    long lateUnread =
        channelRepo.findMyChannels(late).stream()
            .filter(c -> c.id() == channelId)
            .map(ChannelResponse::unreadCount)
            .findFirst()
            .orElseThrow();
    assertThat(lateUnread).isZero();

    // 가입 이후 새 메시지는 unread 로 집계된다.
    messageService.create(author, channelId, new CreateMessageRequest("after"));
    long after =
        channelRepo.findMyChannels(late).stream()
            .filter(c -> c.id() == channelId)
            .map(ChannelResponse::unreadCount)
            .findFirst()
            .orElseThrow();
    assertThat(after).isEqualTo(1L);
  }

  /** 비멤버가 markRead 시도 → ChannelNotMemberException(403). */
  @Test
  void markRead_nonMember_throwsNotMember() {
    long stranger = seedUser();
    long m1 = messageService.create(author, channelId, new CreateMessageRequest("x")).id();

    assertThatThrownBy(() -> messageService.markRead(stranger, channelId, m1))
        .isInstanceOf(ChannelNotMemberException.class);
  }
}
