package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.dto.UpdateMessageRequest;
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** MessageService 통합 테스트 — 멤버십 검증 + 작성. */
@Transactional
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

  @Test
  void create_onArchivedChannel_throws409() {
    long uid = seedUser();
    long channelId = channelRepo.insertPublic("보관채널", uid);
    channelService.join(uid, channelId); // uid 를 멤버로
    channelRepo.setArchived(channelId, true); // 리포지토리로 직접 아카이브 상태 설정

    assertThatThrownBy(() -> messageService.create(uid, channelId, new CreateMessageRequest("막힘")))
        .isInstanceOf(ChannelArchivedException.class);
  }

  /**
   * WP-493 — 채널에서 나간(내보내진) 사람은 자기 예전 메시지도 수정·삭제할 수 없다. 작성자 일치만 보면 내보낸 뒤에도 고치고, 응답으로 그 뒤의 답글·리액션
   * 정보까지 받았다.
   */
  @Test
  void updateAndDelete_byAuthorNoLongerMember_throws403() {
    long uid = seedUser();
    long channelId = channelRepo.insertPublic("내보냄", uid);
    channelService.join(uid, channelId);
    long messageId = messageService.create(uid, channelId, new CreateMessageRequest("원문")).id();
    dsl.deleteFrom(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId), CHANNEL_MEMBER.USER_ID.eq(uid))
        .execute();

    assertThatThrownBy(
            () -> messageService.update(uid, messageId, new UpdateMessageRequest("수정 시도")))
        .isInstanceOf(ChannelNotMemberException.class);
    assertThatThrownBy(() -> messageService.delete(uid, messageId))
        .isInstanceOf(ChannelNotMemberException.class);
  }
}
