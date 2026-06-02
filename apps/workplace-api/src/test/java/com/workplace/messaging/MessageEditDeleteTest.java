package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.dto.MentionResponse;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.dto.UpdateMessageRequest;
import com.workplace.messaging.exception.MessageAuthorMismatchException;
import com.workplace.messaging.exception.MessageNotFoundException;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 메시지 수정/삭제(작성자 권한·soft-delete·editedAt) 통합 테스트. */
class MessageEditDeleteTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;

  private long author;
  private long other;
  private long channelId;

  /** 테스트 격리를 위해 UUID suffix 유니크 유저 INSERT 후 ID 반환. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "edit_del_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "EditDel" + suffix)
        .set(USER.EMAIL, "edit_del_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @BeforeEach
  void setUp() {
    author = seedUser();
    other = seedUser();
    channelId = channelRepo.insertPublic("edit-del-채널", author);
    channelService.join(author, channelId);
    channelService.join(other, channelId);
  }

  /** 작성자가 자신의 메시지를 수정하면 body 가 바뀌고 editedAt 이 설정된다. */
  @Test
  void author_canEdit_bodyChangesAndEditedAtSet() {
    long msgId = messageService.create(author, channelId, new CreateMessageRequest("원본 메시지")).id();

    MessageResponse updated =
        messageService.update(author, msgId, new UpdateMessageRequest("수정된 메시지"));

    assertThat(updated.body()).isEqualTo("수정된 메시지");
    assertThat(updated.editedAt()).isNotNull();
    assertThat(updated.deleted()).isFalse();
  }

  /** 작성자가 수정 시 멘션이 재파싱되어 반영된다. */
  @Test
  void author_edit_reparsesMentions() {
    // other 유저를 멘션 대상으로 사용
    long msgId = messageService.create(author, channelId, new CreateMessageRequest("안녕")).id();

    MessageResponse updated =
        messageService.update(author, msgId, new UpdateMessageRequest("<@" + other + "> 수정 멘션"));

    assertThat(updated.mentions()).extracting(MentionResponse::id).containsExactly(other);
  }

  /** 다른 사용자가 수정을 시도하면 MessageAuthorMismatchException(403) 이 발생한다. */
  @Test
  void nonAuthor_edit_throwsAuthorMismatch() {
    long msgId = messageService.create(author, channelId, new CreateMessageRequest("내 메시지")).id();

    assertThatThrownBy(() -> messageService.update(other, msgId, new UpdateMessageRequest("훼손 시도")))
        .isInstanceOf(MessageAuthorMismatchException.class);
  }

  /** 다른 사용자가 삭제를 시도하면 MessageAuthorMismatchException(403) 이 발생한다. */
  @Test
  void nonAuthor_delete_throwsAuthorMismatch() {
    long msgId = messageService.create(author, channelId, new CreateMessageRequest("내 메시지")).id();

    assertThatThrownBy(() -> messageService.delete(other, msgId))
        .isInstanceOf(MessageAuthorMismatchException.class);
  }

  /** 작성자가 soft-delete 하면 조회 시 deleted=true, body="(삭제됨)" 으로 마스킹된다. */
  @Test
  void author_delete_thenFetchShowsMasked() {
    long msgId = messageService.create(author, channelId, new CreateMessageRequest("삭제 예정")).id();

    messageService.delete(author, msgId);

    // list 페이징으로 조회해 soft-deleted 여부 확인
    var page = messageService.list(author, channelId, null, 50);
    MessageResponse found =
        page.items().stream().filter(m -> m.id().equals(msgId)).findFirst().orElseThrow();

    assertThat(found.deleted()).isTrue();
    assertThat(found.body()).isEqualTo("(삭제됨)");
  }

  /** 존재하지 않는 메시지 수정 시도 → MessageNotFoundException. */
  @Test
  void update_notFound_throwsMessageNotFound() {
    assertThatThrownBy(
            () -> messageService.update(author, 999999999L, new UpdateMessageRequest("없는 메시지")))
        .isInstanceOf(MessageNotFoundException.class);
  }

  /** 존재하지 않는 메시지 삭제 시도 → MessageNotFoundException. */
  @Test
  void delete_notFound_throwsMessageNotFound() {
    assertThatThrownBy(() -> messageService.delete(author, 999999999L))
        .isInstanceOf(MessageNotFoundException.class);
  }
}
