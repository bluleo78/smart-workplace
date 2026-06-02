package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.dto.ReactionResponse;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.messaging.service.ReactionService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 이모지 리액션 토글·멱등·집계(count/reacted)·비멤버 거부 통합 테스트. */
class ReactionToggleTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ReactionService reactionService;
  @Autowired ChannelRepository channelRepo;

  private long author;
  private long reactor;
  private long nonMember;
  private long channelId;
  private long messageId;

  /** 테스트 격리를 위해 UUID suffix 로 유니크 유저를 직접 INSERT 후 ID 반환. */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "rx_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Rx" + s)
        .set(USER.EMAIL, "rx_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** message 의 리액션 집계를 callerId 시점으로 조회. */
  private List<ReactionResponse> reactionsFor(long callerId) {
    return messageService.list(callerId, channelId, null, 50).items().stream()
        .filter(m -> m.id() == messageId)
        .findFirst()
        .map(MessageResponse::reactions)
        .orElseThrow();
  }

  @BeforeEach
  void setUp() {
    author = seedUser();
    reactor = seedUser();
    nonMember = seedUser();
    channelId = channelRepo.insertPublic("react-채널", author);
    channelService.join(author, channelId);
    channelService.join(reactor, channelId);
    messageId = messageService.create(author, channelId, new CreateMessageRequest("hi")).id();
  }

  /** add → count=1, reactor 본인 reacted=true / author 시점 reacted=false. */
  @Test
  void add_aggregatesCount_andReactedPerCaller() {
    reactionService.add(reactor, messageId, "👍");

    assertThat(reactionsFor(reactor))
        .singleElement()
        .satisfies(
            r -> {
              assertThat(r.emoji()).isEqualTo("👍");
              assertThat(r.count()).isEqualTo(1);
              assertThat(r.reacted()).isTrue();
            });
    assertThat(reactionsFor(author))
        .singleElement()
        .satisfies(r -> assertThat(r.reacted()).isFalse());
  }

  /** 같은 (메시지,유저,이모지) 중복 add 는 멱등 — count 그대로 1. */
  @Test
  void add_isIdempotent() {
    reactionService.add(reactor, messageId, "👍");
    reactionService.add(reactor, messageId, "👍");
    assertThat(reactionsFor(reactor))
        .singleElement()
        .satisfies(r -> assertThat(r.count()).isEqualTo(1));
  }

  /** 두 유저가 같은 이모지 → count=2. */
  @Test
  void add_twoUsers_count2() {
    reactionService.add(reactor, messageId, "🎉");
    reactionService.add(author, messageId, "🎉");
    assertThat(reactionsFor(reactor))
        .singleElement()
        .satisfies(r -> assertThat(r.count()).isEqualTo(2));
  }

  /** remove → 0건이면 집계에서 사라짐. */
  @Test
  void remove_dropsReaction() {
    reactionService.add(reactor, messageId, "❤️");
    reactionService.remove(reactor, messageId, "❤️");
    assertThat(reactionsFor(reactor)).isEmpty();
  }

  /** 비멤버는 리액션 불가(403). */
  @Test
  void nonMember_cannotReact() {
    assertThatThrownBy(() -> reactionService.add(nonMember, messageId, "👍"))
        .isInstanceOf(ChannelNotMemberException.class);
  }
}
