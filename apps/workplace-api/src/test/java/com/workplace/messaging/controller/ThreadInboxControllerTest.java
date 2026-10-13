package com.workplace.messaging.controller;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.ThreadInboxPage;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.messaging.service.ThreadInboxService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 인박스 서비스 — rootMessage hydrate + 채널명 + 카운트. */
@Transactional
class ThreadInboxControllerTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ThreadInboxService inboxService;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "tic_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Tic" + s)
        .set(USER.EMAIL, "tic_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void inbox_hydratesRootMessageAndChannelName_andCount() {
    long me = seedUser();
    long other = seedUser();
    long ch = channelRepo.insertPublic("일반채널", other);
    channelService.join(other, ch);
    channelService.join(me, ch);
    long root = messageService.create(me, ch, new CreateMessageRequest("부모글")).id();
    messageService.create(other, ch, new CreateMessageRequest("답글", root));

    ThreadInboxPage page = inboxService.inbox(me, null, 50);
    assertThat(page.items()).hasSize(1);
    var item = page.items().get(0);
    assertThat(item.channelName()).isEqualTo("일반채널");
    assertThat(item.rootMessage().id()).isEqualTo(root);
    assertThat(item.rootMessage().body()).isEqualTo("부모글");
    assertThat(item.rootMessage().unreadReplyCount()).isEqualTo(1);
    assertThat(item.rootMessage().followed()).isTrue();
    assertThat(item.lastReplyAt()).isNotNull();

    assertThat(inboxService.unreadThreadCount(me)).isEqualTo(1L);
  }

  /** 루트 본문의 멘션 토큰 <@id> 를 풀 수 있도록 mentions 에 사용자 정보를 채운다(없는 사용자는 빠진다). */
  @Test
  void inbox_hydratesMentionsOfRootBody() {
    long me = seedUser();
    long other = seedUser();
    long mentioned = seedUser();
    long ch = channelRepo.insertPublic("멘션채널", other);
    channelService.join(other, ch);
    channelService.join(me, ch);
    channelService.join(mentioned, ch);
    long root =
        messageService
            .create(me, ch, new CreateMessageRequest("확인 부탁 <@" + mentioned + "> <@999999999>"))
            .id();
    messageService.create(other, ch, new CreateMessageRequest("답글", root));

    var item = inboxService.inbox(me, null, 50).items().get(0);
    assertThat(item.rootMessage().id()).isEqualTo(root);
    assertThat(item.rootMessage().mentions()).extracting(m -> m.id()).containsExactly(mentioned);
    assertThat(item.rootMessage().mentions().get(0).username()).startsWith("tic_");
  }
}
