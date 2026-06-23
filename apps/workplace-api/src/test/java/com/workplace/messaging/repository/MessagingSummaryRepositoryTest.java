package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.ConversationRow;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 대화 요약 리포지토리 통합 테스트. 클래스 레벨 @Transactional 로 인프로세스 롤백. */
@Transactional
class MessagingSummaryRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MessagingSummaryRepository repo;
  @Autowired ThreadReadStateRepository threadRepo;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository channelMemberRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;

  long me;
  long other;

  @BeforeEach
  void seedUsers() {
    me = seedUser("me");
    other = seedUser("other");
  }

  /** 고유 사용자 시드 헬퍼. */
  private long seedUser(String prefix) {
    String s = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    String name = prefix.equals("other") ? "Other User" : "Me User";
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, prefix + "_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 채널 1·DM 1 시드, other 가 채널에 멘션 포함 메시지 작성, recentConversationRows 가 두 종류 kind 를 반환하고 마지막 메시지/안읽음
   * 포함하는지 검증.
   */
  @Test
  void recentConversationRows_returnsLastMessageAndUnread() {
    // 채널 c 생성·가입
    long c = channelRepo.insertPublic("TestChannel", other);
    channelService.join(other, c);
    channelService.join(me, c);

    // DM d 생성·가입(PRIVATE 채널이므로 channelMemberRepo 로 직접 추가)
    String dmKey = me < other ? me + ":" + other : other + ":" + me;
    long d = channelRepo.insertDm(dmKey, me);
    channelMemberRepo.add(d, me, "MEMBER");
    channelMemberRepo.add(d, other, "MEMBER");

    // other 가 채널에 메시지 작성(본문 "안녕하세요 회의 자료")
    long msgId = messageService.create(other, c, new CreateMessageRequest("안녕하세요 회의 자료")).id();
    // mentions 를 직접 갱신(CreateMessageRequest 에 @mention 파싱 의존 회피)
    dsl.update(MESSAGE)
        .set(MESSAGE.MENTIONS, JSONB.valueOf("[" + me + "]"))
        .where(MESSAGE.ID.eq(msgId))
        .execute();

    // other 가 DM 에 메시지 작성
    messageService.create(other, d, new CreateMessageRequest("DM 본문")).id();

    List<ConversationRow> rows = repo.recentConversationRows(me, 20);

    assertThat(rows).extracting(ConversationRow::kind).contains("CHANNEL", "DM");
    ConversationRow ch =
        rows.stream().filter(r -> "CHANNEL".equals(r.kind())).findFirst().orElseThrow();
    assertThat(ch.lastBody()).isEqualTo("안녕하세요 회의 자료");
    assertThat(ch.lastAuthorName()).isEqualTo("Other User");
    assertThat(ch.unreadCount()).isEqualTo(1);

    Set<Long> mentioned =
        repo.mentionedChannelIds(rows.stream().map(ConversationRow::channelId).toList(), me);
    assertThat(mentioned).contains(ch.channelId());
  }

  /** DM 안읽음 1 + 멘션 채널 1 = countUnreadConversations 2, countNeedsReply 2. 멘션 있는 DM 이중계산 없어야 한다. */
  @Test
  void countNeedsReply_countsDmUnreadAndMentionChannels_noDoubleCount() {
    // DM 채널 생성·가입
    String dmKey = me < other ? me + ":" + other : other + ":" + me;
    long d = channelRepo.insertDm(dmKey, me);
    channelMemberRepo.add(d, me, "MEMBER");
    channelMemberRepo.add(d, other, "MEMBER");

    // DM 안읽음 메시지(other→me, 멘션 없음)
    messageService.create(other, d, new CreateMessageRequest("DM 안읽음"));

    // 멘션 채널 생성·가입
    long c = channelRepo.insertPublic("MentionChannel", other);
    channelService.join(other, c);
    channelService.join(me, c);

    // 채널에 멘션 메시지
    long msgId = messageService.create(other, c, new CreateMessageRequest("멘션 메시지")).id();
    dsl.update(MESSAGE)
        .set(MESSAGE.MENTIONS, JSONB.valueOf("[" + me + "]"))
        .where(MESSAGE.ID.eq(msgId))
        .execute();

    assertThat(repo.countUnreadConversations(me)).isEqualTo(2);
    assertThat(repo.countNeedsReply(me)).isEqualTo(2);
  }

  /**
   * DM 하나가 안읽음이면서 동시에 callerId 를 멘션할 때 countNeedsReply 는 1이어야 한다. 동일 채널이 "DM 안읽음" AND "안읽은 멘션" 두
   * 조건을 모두 충족해도 이중 계산되면 안 된다.
   */
  @Test
  void countNeedsReply_dmUnreadWithMention_noDuplication() {
    // DM 채널 생성·가입
    String dmKey = me < other ? me + ":" + other : other + ":" + me;
    long d = channelRepo.insertDm(dmKey, me);
    channelMemberRepo.add(d, me, "MEMBER");
    channelMemberRepo.add(d, other, "MEMBER");

    // other → me 메시지(안읽음) + callerId 멘션 동시 포함
    long msgId = messageService.create(other, d, new CreateMessageRequest("DM 안읽음 멘션")).id();
    dsl.update(MESSAGE)
        .set(MESSAGE.MENTIONS, JSONB.valueOf("[" + me + "]"))
        .where(MESSAGE.ID.eq(msgId))
        .execute();

    // DM 하나만 존재 → needsReply 는 1(이중계산 없음)
    assertThat(repo.countNeedsReply(me)).isEqualTo(1);
  }

  /**
   * 자기 자신이 최상위 메시지를 작성하면서 자기 id 를 멘션한 경우(셀프 멘션). mentionedChannelIds 에 포함되지 않아야 하고, countNeedsReply
   * 도 증가하지 않아야 한다. "자기 멘션"은 알림 대상이 아님 — AUTHOR_ID.ne(callerId) 조건으로 걸러진다.
   */
  @Test
  void mentionedChannelIds_selfMention_notCounted() {
    long c = channelRepo.insertPublic("SelfMentionChannel", me);
    channelService.join(me, c);

    // me 가 자기 자신을 멘션하는 메시지 작성
    long msgId = messageService.create(me, c, new CreateMessageRequest("셀프 멘션")).id();
    dsl.update(MESSAGE)
        .set(MESSAGE.MENTIONS, JSONB.valueOf("[" + me + "]"))
        .where(MESSAGE.ID.eq(msgId))
        .execute();

    // 셀프 멘션이므로 멘션 채널 집합에 포함되면 안 됨
    Set<Long> mentioned = repo.mentionedChannelIds(List.of(c), me);
    assertThat(mentioned).doesNotContain(c);

    // countNeedsReply 도 셀프 멘션으로 증가하면 안 됨
    assertThat(repo.countNeedsReply(me)).isEqualTo(0);
  }

  /**
   * 스레드 답글(parent_message_id != null)에서 callerId 를 멘션해도 채널 워터마크 기준 집계에서 제외돼야 한다. 스레드 읽음 상태는 별도
   * threadRepo 로 판정하므로 최상위 메시지만 멘션 집계 대상으로 삼는다.
   */
  @Test
  void mentionedChannelIds_threadReplyMention_notCounted() {
    long c = channelRepo.insertPublic("ThreadMentionChannel", other);
    channelService.join(other, c);
    channelService.join(me, c);

    // other 가 루트 메시지 작성
    long rootId = messageService.create(other, c, new CreateMessageRequest("루트 메시지")).id();

    // other 가 스레드 답글에 me 를 멘션
    long replyId = messageService.create(other, c, new CreateMessageRequest("답글 멘션", rootId)).id();
    dsl.update(MESSAGE)
        .set(MESSAGE.MENTIONS, JSONB.valueOf("[" + me + "]"))
        .where(MESSAGE.ID.eq(replyId))
        .execute();

    // 스레드 답글 멘션이므로 채널 멘션 집합에 포함되면 안 됨
    Set<Long> mentioned = repo.mentionedChannelIds(List.of(c), me);
    assertThat(mentioned).doesNotContain(c);

    // countNeedsReply: DM 없고 최상위 멘션 없으므로 0
    assertThat(repo.countNeedsReply(me)).isEqualTo(0);
  }

  /** 채널 c 의 스레드 답글 countUnreadThreadsByChannel 채널별 집계 검증. */
  @Test
  void countUnreadThreadsByChannel_aggregatesPerChannel() {
    long c = channelRepo.insertPublic("ThreadChannel", other);
    channelService.join(other, c);
    channelService.join(me, c);

    // me 가 루트 작성(루트 작성자 자동 팔로우)
    long rootId = messageService.create(me, c, new CreateMessageRequest("루트 메시지")).id();
    // other 가 답글 2건
    messageService.create(other, c, new CreateMessageRequest("답글1", rootId));
    messageService.create(other, c, new CreateMessageRequest("답글2", rootId));

    // 명시적 팔로우(자동 팔로우 보장을 위해)
    threadRepo.followIfAbsent(rootId, me);

    Map<Long, Integer> m = threadRepo.countUnreadThreadsByChannel(List.of(c), me);
    assertThat(m.getOrDefault(c, 0)).isEqualTo(2);
  }
}
