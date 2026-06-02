package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.dto.MentionResponse;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 메시지 @멘션 파싱·hydrate 통합 테스트 — 존재하는 user 만 통과시키고 응답에 hydrate. */
class MessageMentionTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;

  /** 테스트 격리를 위해 UUID suffix 로 유니크 유저를 직접 INSERT 후 ID 반환. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "msg_mention_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "MsgMention" + suffix)
        .set(USER.EMAIL, "msgmention_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void create_withMention_hydratesExistingUserAndFiltersMissing() {
    long u1 = seedUser();
    long u2 = seedUser();
    long channelId = channelRepo.insertPublic("멘션채널", u1);
    channelService.join(u1, channelId);
    channelService.join(u2, channelId);

    // u2 는 존재 → hydrate, 999999 는 미존재 → 필터링.
    MessageResponse r =
        messageService.create(
            u1, channelId, new CreateMessageRequest("<@" + u2 + "> <@999999> hi"));

    assertThat(r.mentions()).extracting(MentionResponse::id).containsExactly(u2);
    MentionResponse mention = r.mentions().get(0);
    assertThat(mention.username()).isNotBlank();
    assertThat(mention.name()).isNotBlank();
    assertThat(mention.kind()).isNotBlank();
  }
}
