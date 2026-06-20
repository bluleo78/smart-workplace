package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.ThreadReadStateRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 답글 생성 시 자동 팔로우 규칙 검증. */
@Transactional
class MessageServiceThreadUnreadTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ThreadReadStateRepository threadRepo;

  private long seedUser(String name) {
    String s = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, name + "_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, name + "_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 답글이 달리면 루트 작성자가 자동 팔로우되고, 그 답글이 미읽음으로 잡힌다. */
  @Test
  void reply_autoFollowsRootAuthor_andCountsUnread() {
    long rootAuthor = seedUser("루트");
    long replier = seedUser("답글러");
    long ch = channelRepo.insertPublic("일반", rootAuthor);
    channelService.join(rootAuthor, ch);
    channelService.join(replier, ch);
    long root = messageService.create(rootAuthor, ch, new CreateMessageRequest("부모")).id();

    messageService.create(replier, ch, new CreateMessageRequest("답글", root));

    // 루트 작성자는 팔로우 + 답글 1개 미읽음.
    assertThat(threadRepo.countUnreadForRoots(List.of(root), rootAuthor)).containsEntry(root, 1);
  }

  /** 답글 작성자 본인은 팔로우되지만, 본인 답글이라 미읽음에는 안 잡힌다(watermark = 본인 답글). */
  @Test
  void reply_followsReplier_butSelfNotUnread() {
    long rootAuthor = seedUser("루트");
    long replier = seedUser("답글러");
    long ch = channelRepo.insertPublic("일반", rootAuthor);
    channelService.join(rootAuthor, ch);
    channelService.join(replier, ch);
    long root = messageService.create(rootAuthor, ch, new CreateMessageRequest("부모")).id();

    messageService.create(replier, ch, new CreateMessageRequest("답글", root));

    assertThat(threadRepo.followedRoots(List.of(root), replier)).containsExactly(root);
    assertThat(threadRepo.countUnreadForRoots(List.of(root), replier)).doesNotContainKey(root);
  }

  /** 패널 열기(markThreadRead)는 watermark 를 최신 답글로 올려 미읽음을 0으로 만든다. */
  @Test
  void markThreadRead_clearsUnread() {
    long rootAuthor = seedUser("루트");
    long replier = seedUser("답글러");
    long ch = channelRepo.insertPublic("일반", rootAuthor);
    channelService.join(rootAuthor, ch);
    channelService.join(replier, ch);
    long root = messageService.create(rootAuthor, ch, new CreateMessageRequest("부모")).id();
    messageService.create(replier, ch, new CreateMessageRequest("답1", root));
    messageService.create(replier, ch, new CreateMessageRequest("답2", root));

    // rootAuthor 는 답글 2개 미읽음.
    assertThat(threadRepo.countUnreadForRoots(List.of(root), rootAuthor)).containsEntry(root, 2);

    messageService.markThreadRead(rootAuthor, root);

    assertThat(threadRepo.countUnreadForRoots(List.of(root), rootAuthor)).doesNotContainKey(root);
  }

  /** 채널 전체 읽음은 스레드 미읽음을 건드리지 않는다(독립성). */
  @Test
  void channelMarkRead_doesNotClearThreadUnread() {
    long rootAuthor = seedUser("루트");
    long replier = seedUser("답글러");
    long ch = channelRepo.insertPublic("일반", rootAuthor);
    channelService.join(rootAuthor, ch);
    channelService.join(replier, ch);
    long root = messageService.create(rootAuthor, ch, new CreateMessageRequest("부모")).id();
    long lastReply = messageService.create(replier, ch, new CreateMessageRequest("답1", root)).id();

    // 채널 전체를 읽음 처리(마지막 메시지까지).
    messageService.markRead(rootAuthor, ch, lastReply);

    // 스레드 미읽음은 그대로.
    assertThat(threadRepo.countUnreadForRoots(List.of(root), rootAuthor)).containsEntry(root, 1);
  }

  /** 채널 메시지 목록 조회 시 부모 메시지에 미읽음 수/팔로우 여부가 채워진다. */
  @Test
  void list_hydratesUnreadReplyCountAndFollowed() {
    long rootAuthor = seedUser("루트");
    long replier = seedUser("답글러");
    long ch = channelRepo.insertPublic("일반", rootAuthor);
    channelService.join(rootAuthor, ch);
    channelService.join(replier, ch);
    long root = messageService.create(rootAuthor, ch, new CreateMessageRequest("부모")).id();
    messageService.create(replier, ch, new CreateMessageRequest("답글", root));

    // rootAuthor 관점: 부모 메시지는 followed=true, unreadReplyCount=1.
    var page = messageService.list(rootAuthor, ch, null, 50);
    var parent = page.items().stream().filter(m -> m.id() == root).findFirst().orElseThrow();
    assertThat(parent.followed()).isTrue();
    assertThat(parent.unreadReplyCount()).isEqualTo(1);

    // 비팔로워(제3자) 관점: followed=false, unreadReplyCount=0.
    long bystander = seedUser("제3자");
    channelService.join(bystander, ch);
    var page2 = messageService.list(bystander, ch, null, 50);
    var parent2 = page2.items().stream().filter(m -> m.id() == root).findFirst().orElseThrow();
    assertThat(parent2.followed()).isFalse();
    assertThat(parent2.unreadReplyCount()).isZero();
  }
}
