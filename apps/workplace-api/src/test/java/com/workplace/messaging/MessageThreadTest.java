package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.exception.InvalidThreadParentException;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 스레드 답글: 부모 검증·대댓글 금지·메인 제외·thread page·replyCount 통합 테스트. */
class MessageThreadTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;

  private long author;
  private long channelId;
  private long otherChannelId;
  private long nonMember;

  /** 테스트 격리를 위해 UUID suffix 로 유니크 유저를 직접 INSERT 후 ID 반환. */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "th_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Th" + s)
        .set(USER.EMAIL, "th_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @BeforeEach
  void setUp() {
    author = seedUser();
    nonMember = seedUser();
    channelId = channelRepo.insertPublic("thread-채널", author);
    channelService.join(author, channelId);
    otherChannelId = channelRepo.insertPublic("other-채널", author);
    channelService.join(author, otherChannelId);
  }

  /** 답글은 메인 목록(findPage)에서 제외되고, 부모의 replyCount 로만 노출된다. */
  @Test
  void reply_excludedFromMainList_andCountedOnParent() {
    long parent = messageService.create(author, channelId, new CreateMessageRequest("부모")).id();
    messageService.create(author, channelId, new CreateMessageRequest("답글1", parent));
    messageService.create(author, channelId, new CreateMessageRequest("답글2", parent));

    MessagePage main = messageService.list(author, channelId, null, 50);
    assertThat(main.items()).extracting(MessageResponse::body).containsExactly("부모");
    assertThat(main.items().get(0).replyCount()).isEqualTo(2);

    MessagePage thread = messageService.listThread(author, parent, null, 50);
    assertThat(thread.items()).extracting(MessageResponse::body).containsExactly("답글1", "답글2");
    assertThat(thread.items()).allSatisfy(m -> assertThat(m.parentMessageId()).isEqualTo(parent));
  }

  /** 대댓글 금지: 답글에 다시 답글 달면 400(InvalidThreadParent). */
  @Test
  void replyToReply_rejected() {
    long parent = messageService.create(author, channelId, new CreateMessageRequest("부모")).id();
    long reply =
        messageService.create(author, channelId, new CreateMessageRequest("답글", parent)).id();
    assertThatThrownBy(
            () -> messageService.create(author, channelId, new CreateMessageRequest("대댓글", reply)))
        .isInstanceOf(InvalidThreadParentException.class);
  }

  /** 타 채널 메시지를 부모로 지정하면 400. */
  @Test
  void parentInOtherChannel_rejected() {
    long otherParent =
        messageService.create(author, otherChannelId, new CreateMessageRequest("타채널")).id();
    assertThatThrownBy(
            () ->
                messageService.create(
                    author, channelId, new CreateMessageRequest("답글", otherParent)))
        .isInstanceOf(InvalidThreadParentException.class);
  }

  /** 비멤버는 스레드 조회 불가(403). */
  @Test
  void nonMember_cannotListThread() {
    long parent = messageService.create(author, channelId, new CreateMessageRequest("부모")).id();
    assertThatThrownBy(() -> messageService.listThread(nonMember, parent, null, 50))
        .isInstanceOf(ChannelNotMemberException.class);
  }
}
