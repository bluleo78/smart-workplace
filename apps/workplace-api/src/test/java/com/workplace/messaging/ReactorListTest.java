package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.ReactorPage;
import com.workplace.messaging.dto.ReactorResponse;
import com.workplace.messaging.exception.MessageNotFoundException;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.messaging.service.ReactionService;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 반응자 목록 조회 — 이모지 필터·키셋 페이지·이름/종류·권한 통합 테스트. */
@Transactional
class ReactorListTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ReactionService reactionService;
  @Autowired ChannelRepository channelRepo;

  private long author;
  private long channelId;
  private long messageId;

  /** 테스트 격리를 위해 UUID suffix 로 유니크 유저를 직접 INSERT 후 ID 반환. */
  private long seedUser(String name) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "rl_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, "rl_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 채널에 가입한 사용자를 만들어 반환. */
  private long member(String name) {
    long id = seedUser(name);
    channelService.join(id, channelId);
    return id;
  }

  @BeforeEach
  void setUp() {
    author = seedUser("작성자");
    channelId = channelRepo.insertPublic("reactor-채널", author);
    channelService.join(author, channelId);
    messageId = messageService.create(author, channelId, new CreateMessageRequest("hi")).id();
  }

  /** 이모지로 걸러 이름·종류를 user_id 순(같은 시각)으로 돌려준다. */
  @Test
  void list_filtersByEmoji_andReturnsNameKind() {
    long a = member("김민수");
    long b = member("이영희");
    reactionService.add(a, messageId, "👍");
    reactionService.add(b, messageId, "👍");
    reactionService.add(b, messageId, "🎉");

    ReactorPage page = reactionService.listReactors(author, messageId, "👍", null, 20);

    assertThat(page.items()).extracting(ReactorResponse::userId).containsExactly(a, b);
    assertThat(page.items()).extracting(ReactorResponse::name).containsExactly("김민수", "이영희");
    assertThat(page.items()).extracting(ReactorResponse::kind).containsOnly("HUMAN");
    assertThat(page.hasMore()).isFalse();
    assertThat(page.nextCursor()).isNull();
  }

  /** limit 단위로 끊고 cursor 로 이어 받으면 빠짐·중복 없이 전원을 얻는다(같은 created_at 경계 포함). */
  @Test
  void list_paginatesWithCursor() {
    List<Long> expected = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      long u = member("반응자" + i);
      reactionService.add(u, messageId, "👍");
      expected.add(u);
    }

    ReactorPage p1 = reactionService.listReactors(author, messageId, "👍", null, 2);
    ReactorPage p2 = reactionService.listReactors(author, messageId, "👍", p1.nextCursor(), 2);
    ReactorPage p3 = reactionService.listReactors(author, messageId, "👍", p2.nextCursor(), 2);

    assertThat(p1.hasMore()).isTrue();
    assertThat(p2.hasMore()).isTrue();
    assertThat(p3.hasMore()).isFalse();
    assertThat(p3.nextCursor()).isNull();
    List<Long> all = new ArrayList<>();
    for (ReactorPage p : List.of(p1, p2, p3)) p.items().forEach(r -> all.add(r.userId()));
    assertThat(all).containsExactlyElementsOf(expected);
  }

  /** limit 은 1~50 으로 보정된다. */
  @Test
  void list_clampsLimit() {
    long a = member("김민수");
    reactionService.add(a, messageId, "👍");
    assertThat(reactionService.listReactors(author, messageId, "👍", null, 0).items()).hasSize(1);
    assertThat(reactionService.listReactors(author, messageId, "👍", null, 999).items()).hasSize(1);
  }

  /** 비멤버도 없는 메시지와 같은 404(MessageNotFoundException, WP-591). */
  @Test
  void list_guards() {
    long outsider = seedUser("외부인");
    assertThatThrownBy(() -> reactionService.listReactors(outsider, messageId, "👍", null, 20))
        .isInstanceOf(MessageNotFoundException.class);
    assertThatThrownBy(() -> reactionService.listReactors(author, Long.MAX_VALUE, "👍", null, 20))
        .isInstanceOf(MessageNotFoundException.class);
  }

  /** 깨진 cursor 는 IllegalArgumentException(400) — 500 으로 새지 않는다. */
  @Test
  void list_badCursor_isIllegalArgument() {
    assertThatThrownBy(() -> reactionService.listReactors(author, messageId, "👍", "!!", 20))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> reactionService.listReactors(author, messageId, "👍", "YQ", 20))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
