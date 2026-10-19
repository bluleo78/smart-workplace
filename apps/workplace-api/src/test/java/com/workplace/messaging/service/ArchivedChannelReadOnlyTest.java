package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.UpdateMessageRequest;
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-508: 보관된 채널은 읽기 전용이다. 새 메시지뿐 아니라 메시지 수정·삭제, 리액션, 이름 변경, 참여, 멤버 추가, 첨부 업로드도 막고, 정리용인 나가기는 허용한다.
 */
@Transactional
class ArchivedChannelReadOnlyTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired ChannelMemberService memberService;
  @Autowired MessageService messageService;
  @Autowired ReactionService reactionService;
  @Autowired MessageAttachmentService attachmentService;
  @Autowired ChannelMemberRepository memberRepo;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ar_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Ar" + s)
        .set(USER.EMAIL, "ar_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void archivedChannel_blocksAllWrites_butAllowsLeave() {
    long owner = seedUser();
    long member = seedUser();
    long outsider = seedUser();
    long newcomer = seedUser();
    ChannelResponse ch = channelService.create(owner, "보관-" + UUID.randomUUID(), "PUBLIC");
    channelService.join(member, ch.id());
    long msgId = messageService.create(member, ch.id(), new CreateMessageRequest("보관 전 글")).id();
    channelService.archive(owner, ch.id());

    assertThatThrownBy(
            () -> messageService.update(member, msgId, new UpdateMessageRequest("보관 뒤 수정")))
        .isInstanceOf(ChannelArchivedException.class);
    assertThatThrownBy(() -> messageService.delete(member, msgId))
        .isInstanceOf(ChannelArchivedException.class);
    assertThatThrownBy(() -> reactionService.add(member, msgId, "👍"))
        .isInstanceOf(ChannelArchivedException.class);
    assertThatThrownBy(() -> reactionService.remove(member, msgId, "👍"))
        .isInstanceOf(ChannelArchivedException.class);
    assertThatThrownBy(() -> channelService.rename(owner, ch.id(), "새이름-" + UUID.randomUUID()))
        .isInstanceOf(ChannelArchivedException.class);
    assertThatThrownBy(() -> channelService.join(outsider, ch.id()))
        .isInstanceOf(ChannelArchivedException.class);
    assertThatThrownBy(() -> memberService.add(owner, ch.id(), newcomer))
        .isInstanceOf(ChannelArchivedException.class);
    var file = new MockMultipartFile("files", "a.txt", "text/plain", "hello".getBytes());
    assertThatThrownBy(() -> attachmentService.upload(member, ch.id(), List.of(file)))
        .isInstanceOf(ChannelArchivedException.class);

    // 나가기는 정리용이라 허용한다.
    memberService.leave(member, ch.id());
    assertThat(memberRepo.isMember(ch.id(), member)).isFalse();
  }

  @Test
  void unarchivedChannel_allowsEditAgain() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "해제-" + UUID.randomUUID(), "PUBLIC");
    long msgId = messageService.create(owner, ch.id(), new CreateMessageRequest("원문")).id();
    channelService.archive(owner, ch.id());
    channelService.unarchive(owner, ch.id());

    assertThat(messageService.update(owner, msgId, new UpdateMessageRequest("고침")).body())
        .isEqualTo("고침");
  }
}
