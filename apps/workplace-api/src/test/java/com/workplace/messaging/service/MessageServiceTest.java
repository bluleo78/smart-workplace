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
import com.workplace.messaging.exception.MessageNotFoundException;
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

  /** WP-509: 삭제된 메시지는 수정할 수 없고(404), DB 본문도 바뀌지 않는다. 다시 삭제해도 삭제 시각이 바뀌지 않는다. */
  @Test
  void update_deletedMessage_throws404_andKeepsBody() {
    long uid = seedUser();
    long chId = channelService.create(uid, "삭제수정-" + UUID.randomUUID(), "PUBLIC").id();
    long messageId = messageService.create(uid, chId, new CreateMessageRequest("원래 본문")).id();
    messageService.delete(uid, messageId);
    var deletedAt =
        dsl.select(com.workplace.jooq.Tables.MESSAGE.DELETED_AT)
            .from(com.workplace.jooq.Tables.MESSAGE)
            .where(com.workplace.jooq.Tables.MESSAGE.ID.eq(messageId))
            .fetchOne(com.workplace.jooq.Tables.MESSAGE.DELETED_AT);

    assertThatThrownBy(
            () -> messageService.update(uid, messageId, new UpdateMessageRequest("삭제 뒤 새 본문")))
        .isInstanceOf(MessageNotFoundException.class);
    messageService.delete(uid, messageId);

    var row =
        dsl.selectFrom(com.workplace.jooq.Tables.MESSAGE)
            .where(com.workplace.jooq.Tables.MESSAGE.ID.eq(messageId))
            .fetchOne();
    assertThat(row.getBody()).isEqualTo("원래 본문");
    assertThat(row.getEditedAt()).isNull();
    assertThat(row.getDeletedAt()).isEqualTo(deletedAt);
  }

  /** WP-514: 읽음 위치는 그 채널의 최신 메시지까지만 올라간다 — 범위 밖 id 로 미래를 읽음 처리해 새 메시지 미읽음이 0 으로 고정되지 않게. */
  @Test
  void markRead_beyondLatest_isCappedToChannelLatest() {
    long uid = seedUser();
    long other = seedUser();
    long chId = channelService.create(uid, "읽음상한-" + UUID.randomUUID(), "PUBLIC").id();
    channelService.join(other, chId);
    long m1 = messageService.create(uid, chId, new CreateMessageRequest("첫 글")).id();

    messageService.markRead(other, chId, Long.MAX_VALUE / 2);
    assertThat(lastRead(chId, other)).isEqualTo(m1);

    long m2 = messageService.create(uid, chId, new CreateMessageRequest("새 글")).id();
    assertThat(m2).isGreaterThan(lastRead(chId, other));
  }

  private Long lastRead(long channelId, long userId) {
    return dsl.select(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID)
        .from(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .fetchOne(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID);
  }
}
