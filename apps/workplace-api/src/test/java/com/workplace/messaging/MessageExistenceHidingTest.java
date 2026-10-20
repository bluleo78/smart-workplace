package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.UpdateMessageRequest;
import com.workplace.messaging.exception.MessageAuthorMismatchException;
import com.workplace.messaging.exception.MessageNotFoundException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.MessageService;
import com.workplace.messaging.service.ReactionService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-591: 메시지 id 로 부르는 API 는 볼 수 없는(멤버가 아닌) 채널의 메시지를 없는 메시지와 같은 404(MessageNotFoundException)로
 * 돌려준다. 메시지 id 는 전역 일련번호라, 403/404 가 갈리면 비멤버가 id 를 차례로 넣어 비공개 채널·DM 에 글이 쌓이는 것을 알 수 있다.
 */
@Transactional
class MessageExistenceHidingTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MessageService messageService;
  @Autowired ReactionService reactionService;
  @Autowired ChannelRepository channelRepo;

  @Autowired ChannelMemberRepository memberRepo;

  private long owner;
  private long outsider;
  private long secret;
  private long secretMsg;

  /** 테스트 격리를 위해 UUID suffix 유니크 유저 INSERT 후 ID 반환. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "hide_msg_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "HideMsg" + suffix)
        .set(USER.EMAIL, "hide_msg_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @BeforeEach
  void setUp() {
    owner = seedUser();
    outsider = seedUser();
    secret = channelRepo.insert("비밀-" + UUID.randomUUID(), "PRIVATE", owner);
    memberRepo.add(secret, owner, "OWNER");
    secretMsg = messageService.create(owner, secret, new CreateMessageRequest("비밀 글")).id();
  }

  /** 비멤버가 비공개 채널 메시지 id 로 부른 결과는 없는 id(Long.MAX_VALUE)로 부른 결과와 같은 예외여야 한다. */
  private void assertHidden(java.util.function.LongFunction<ThrowingCallable> call) {
    assertThatThrownBy(call.apply(secretMsg)).isInstanceOf(MessageNotFoundException.class);
    assertThatThrownBy(call.apply(Long.MAX_VALUE)).isInstanceOf(MessageNotFoundException.class);
  }

  @Test
  void outsider_replies_isNotFound() {
    assertHidden(id -> () -> messageService.listThread(outsider, id, null, 20));
  }

  @Test
  void outsider_threadRead_isNotFound() {
    assertHidden(id -> () -> messageService.markThreadRead(outsider, id));
  }

  @Test
  void outsider_edit_isNotFound_notAuthorMismatch() {
    assertHidden(id -> () -> messageService.update(outsider, id, new UpdateMessageRequest("x")));
  }

  @Test
  void outsider_delete_isNotFound_notAuthorMismatch() {
    assertHidden(id -> () -> messageService.delete(outsider, id));
  }

  @Test
  void outsider_reactions_isNotFound() {
    assertHidden(id -> () -> reactionService.add(outsider, id, "👍"));
    assertHidden(id -> () -> reactionService.remove(outsider, id, "👍"));
    assertHidden(id -> () -> reactionService.listReactors(outsider, id, "👍", null, 10));
  }

  /** 같은 채널 멤버(메시지를 볼 수 있는 사람)에게는 지금처럼 「본인 글만」 403 이 그대로다. */
  @Test
  void member_nonAuthor_edit_isStillAuthorMismatch() {
    memberRepo.add(secret, outsider, "MEMBER");
    assertThatThrownBy(
            () -> messageService.update(outsider, secretMsg, new UpdateMessageRequest("x")))
        .isInstanceOf(MessageAuthorMismatchException.class);
  }
}
