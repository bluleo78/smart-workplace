package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** findMyChannels 가 hasUnreadThreads 를 정확히 반영하는지 검증. */
@Transactional
class ChannelRepositoryThreadUnreadTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "chu_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Chu" + s)
        .set(USER.EMAIL, "chu_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void findMyChannels_reflectsUnreadThreads() {
    long rootAuthor = seedUser();
    long replier = seedUser();
    long ch = channelRepo.insertPublic("일반", rootAuthor);
    channelService.join(rootAuthor, ch);
    channelService.join(replier, ch);
    long root = messageService.create(rootAuthor, ch, new CreateMessageRequest("부모")).id();

    // 아직 답글 없음 → rootAuthor 채널은 미읽음 스레드 없음.
    var before =
        channelRepo.findMyChannels(rootAuthor).stream()
            .filter(c -> c.id() == ch)
            .findFirst()
            .orElseThrow();
    assertThat(before.hasUnreadThreads()).isFalse();

    // replier 가 답글 → rootAuthor 자동 팔로우 + 미읽음.
    messageService.create(replier, ch, new CreateMessageRequest("답글", root));
    var after =
        channelRepo.findMyChannels(rootAuthor).stream()
            .filter(c -> c.id() == ch)
            .findFirst()
            .orElseThrow();
    assertThat(after.hasUnreadThreads()).isTrue();

    // replier 본인은 미읽음 아님(본인 답글).
    var replierView =
        channelRepo.findMyChannels(replier).stream()
            .filter(c -> c.id() == ch)
            .findFirst()
            .orElseThrow();
    assertThat(replierView.hasUnreadThreads()).isFalse();
  }
}
