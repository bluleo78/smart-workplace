package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.dto.ReactionResponse;
import com.workplace.messaging.exception.MessageNotFoundException;
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
import org.springframework.transaction.annotation.Transactional;

/** 이모지 리액션 토글·멱등·집계(count/reacted)·비멤버 거부 통합 테스트. */
@Transactional
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

  /** WP-594: 이모지 하나가 아닌 값(글자·HTML·여러 개·보이지 않는 문자)은 400 으로 거절하고 저장하지 않는다. */
  @Test
  void nonEmoji_reaction_isRejected() {
    for (String bad : new String[] {"가나다라마바사", "<b>x</b>", "👍👍", "\u200B"}) {
      assertThatThrownBy(() -> reactionService.add(reactor, messageId, bad))
          .as(bad)
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessage("리액션에는 이모지 하나만 쓸 수 있습니다");
    }
    assertThat(reactionsFor(reactor)).isEmpty();
  }

  /** 비멤버는 리액션 불가 — 없는 메시지와 같은 404(WP-591). */
  @Test
  void nonMember_cannotReact() {
    assertThatThrownBy(() -> reactionService.add(nonMember, messageId, "👍"))
        .isInstanceOf(MessageNotFoundException.class);
  }

  /** 이모지 n 개(서로 다른 한 글자 이모지 — 😀 부터 차례로). */
  private static List<String> emojis(int n) {
    return java.util.stream.IntStream.range(0, n)
        .mapToObj(i -> new String(Character.toChars(0x1F600 + i)))
        .toList();
  }

  /** WP-665: 삭제된 메시지에는 리액션을 새로 달 수 없다(400). 이미 달린 것을 떼는 것은 된다. */
  @Test
  void deletedMessage_cannotGetNewReaction() {
    reactionService.add(reactor, messageId, "👍");
    messageService.delete(author, messageId);

    assertThatThrownBy(() -> reactionService.add(author, messageId, "🎉"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("삭제된 메시지에는 리액션을 달 수 없습니다");
    reactionService.remove(reactor, messageId, "👍");
    assertThat(reactionsFor(reactor)).isEmpty();
  }

  /** WP-665: 한 사람이 한 메시지에 다는 리액션은 20개까지 — 21번째 새 이모지는 400, 이미 단 것은 그대로. */
  @Test
  void perUserReactionLimit_isEnforced() {
    List<String> e = emojis(21);
    e.subList(0, 20).forEach(x -> reactionService.add(reactor, messageId, x));

    assertThatThrownBy(() -> reactionService.add(reactor, messageId, e.get(20)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("20개");
    // 같은 이모지를 다시 누르는 것(멱등)과 다른 사람의 리액션은 막지 않는다.
    reactionService.add(reactor, messageId, e.get(0));
    reactionService.add(author, messageId, e.get(20));
    assertThat(reactionsFor(reactor)).hasSize(21);
  }

  /** WP-665: 한 메시지의 서로 다른 이모지는 50종까지 — 51번째 새 이모지는 400, 이미 있는 이모지에 더하는 것은 된다. */
  @Test
  void perMessageDistinctEmojiLimit_isEnforced() {
    List<String> e = emojis(51);
    long third = seedUser();
    channelService.join(third, channelId);
    e.subList(0, 20).forEach(x -> reactionService.add(reactor, messageId, x));
    e.subList(20, 40).forEach(x -> reactionService.add(author, messageId, x));
    e.subList(40, 50).forEach(x -> reactionService.add(third, messageId, x));

    assertThatThrownBy(() -> reactionService.add(third, messageId, e.get(50)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("50종");
    reactionService.add(third, messageId, e.get(0));
    assertThat(reactionsFor(third)).hasSize(50);
  }
}
