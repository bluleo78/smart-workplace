package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** MessageService 통합 테스트 — 멤버십 검증 + 작성. */
class MessageServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;

  /** 테스트 격리를 위해 UUID suffix 로 유니크 유저를 직접 INSERT 후 ID 반환. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "msg_svc_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "MsgSvc" + suffix)
        .set(USER.EMAIL, "msgsvc_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void create_byMember_succeeds() {
    long uid = seedUser();
    long channelId = channelRepo.insertPublic("일반", uid);
    channelService.join(uid, channelId);

    MessageResponse saved =
        messageService.create(uid, channelId, new CreateMessageRequest("hello"));
    assertThat(saved.body()).isEqualTo("hello");
    assertThat(saved.channelId()).isEqualTo(channelId);
    assertThat(saved.authorId()).isEqualTo(uid);
  }

  @Test
  void create_byNonMember_throws403() {
    long uid = seedUser();
    long channelId = channelRepo.insertPublic("비밀 아님", uid);
    assertThatThrownBy(() -> messageService.create(uid, channelId, new CreateMessageRequest("hi")))
        .isInstanceOf(ChannelNotMemberException.class);
  }
}
