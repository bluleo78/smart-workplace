package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.UpdateMessageRequest;
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.exception.MessageNotFoundException;
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
        .isInstanceOf(ChannelArchivedException.class)
        .hasMessage("보관된 채널에서는 메시지를 보내거나 수정할 수 없습니다");
    assertThatThrownBy(() -> reactionService.add(member, msgId, "👍"))
        .isInstanceOf(ChannelArchivedException.class);
    assertThatThrownBy(() -> reactionService.remove(member, msgId, "👍"))
        .isInstanceOf(ChannelArchivedException.class);
    // 거절 문구는 막힌 동작에 맞춘다(WP-621) — 메시지 전송 문구를 재사용하지 않는다.
    assertThatThrownBy(() -> channelService.rename(owner, ch.id(), "새이름-" + UUID.randomUUID()))
        .isInstanceOf(ChannelArchivedException.class)
        .hasMessage("보관된 채널은 이름을 바꿀 수 없습니다");
    assertThatThrownBy(() -> channelService.join(outsider, ch.id()))
        .isInstanceOf(ChannelArchivedException.class)
        .hasMessage("보관된 채널에는 참여할 수 없습니다");
    assertThatThrownBy(() -> memberService.add(owner, ch.id(), newcomer))
        .isInstanceOf(ChannelArchivedException.class)
        .hasMessage("보관된 채널에는 구성원을 초대할 수 없습니다");
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

  /**
   * WP-621: 보관된 공개 채널은 워크스페이스 구성원이면 멤버가 아니어도(나간 사람·처음 보는 사람) 메시지·스레드·첨부·반응자·멤버 목록을 읽기 전용으로 본다. 쓰기는
   * 그대로 막힌다.
   */
  @Test
  void archivedPublicChannel_nonMembersCanRead_butNotWrite() throws Exception {
    long owner = seedUser();
    long leaver = seedUser();
    long outsider = seedUser();
    ChannelResponse ch = channelService.create(owner, "보관공개-" + UUID.randomUUID(), "PUBLIC");
    channelService.join(leaver, ch.id());
    var file = new MockMultipartFile("files", "회의록.txt", "text/plain", "회의 내용".getBytes());
    long fileId = attachmentService.upload(leaver, ch.id(), List.of(file)).get(0).fileId();
    long rootId =
        messageService
            .create(leaver, ch.id(), new CreateMessageRequest("결정 사항 정리", null, List.of(fileId)))
            .id();
    messageService.create(owner, ch.id(), new CreateMessageRequest("확인했습니다", rootId));
    reactionService.add(owner, rootId, "👍");
    channelService.archive(owner, ch.id());
    memberService.leave(leaver, ch.id());

    for (long reader : List.of(leaver, outsider)) {
      assertThat(messageService.list(reader, ch.id(), null, 50).items())
          .extracting(m -> m.body())
          .containsExactly("결정 사항 정리");
      assertThat(messageService.listThread(reader, rootId, null, 50).items())
          .extracting(m -> m.body())
          .containsExactly("확인했습니다");
      assertThat(attachmentService.download(reader, ch.id(), rootId, fileId).originalName())
          .isEqualTo("회의록.txt");
      assertThat(reactionService.listReactors(reader, rootId, "👍", null, 10).items()).hasSize(1);
      assertThat(memberService.listMembers(reader, ch.id())).isNotEmpty();
    }

    // 쓰기는 그대로 막힌다 — 비멤버라 전송·반응 모두 거절.
    assertThatThrownBy(
            () -> messageService.create(outsider, ch.id(), new CreateMessageRequest("들어왔어요")))
        .isInstanceOfAny(ChannelArchivedException.class, ChannelNotMemberException.class);
    assertThatThrownBy(() -> reactionService.add(outsider, rootId, "🎉"))
        .isInstanceOfAny(ChannelArchivedException.class, MessageNotFoundException.class);
  }

  /** WP-621: 열람 허용은 보관된 *공개* 채널만 — 보관 안 된 공개 채널·보관된 비공개 채널은 지금처럼 멤버만 읽는다. */
  @Test
  void readAccess_onlyWidensForArchivedPublic() {
    long owner = seedUser();
    long outsider = seedUser();
    ChannelResponse open = channelService.create(owner, "공개-" + UUID.randomUUID(), "PUBLIC");
    long openMsg = messageService.create(owner, open.id(), new CreateMessageRequest("공개 글")).id();
    ChannelResponse secret = channelService.create(owner, "비공개-" + UUID.randomUUID(), "PRIVATE");
    long secretMsg =
        messageService.create(owner, secret.id(), new CreateMessageRequest("비공개 글")).id();
    channelService.archive(owner, secret.id());

    assertThatThrownBy(() -> messageService.list(outsider, open.id(), null, 50))
        .isInstanceOf(ChannelNotMemberException.class);
    assertThatThrownBy(() -> messageService.listThread(outsider, openMsg, null, 50))
        .isInstanceOf(MessageNotFoundException.class);
    assertThatThrownBy(() -> messageService.list(outsider, secret.id(), null, 50))
        .isInstanceOf(ChannelNotMemberException.class);
    assertThatThrownBy(() -> messageService.listThread(outsider, secretMsg, null, 50))
        .isInstanceOf(MessageNotFoundException.class);
    assertThatThrownBy(() -> reactionService.listReactors(outsider, secretMsg, "👍", null, 10))
        .isInstanceOf(MessageNotFoundException.class);
  }
}
