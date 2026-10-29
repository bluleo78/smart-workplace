package com.workplace.messaging;

import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.ChannelReadStateResponse;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageReadEvent;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.DmService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * DM 읽음 표시(WP-1176) 통합 테스트 — 읽은 시각(last_read_at)은 읽은 위치가 앞으로 갈 때만 바뀌고, 읽음 목록은 DM 의 다른 사람 멤버만 보이며,
 * 읽음 이벤트에 시각이 실린다.
 */
@Transactional
@RecordApplicationEvents
class DmReadStateTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DmService dmService;
  @Autowired MessageService messageService;
  @Autowired ChannelService channelService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ApplicationEvents events;

  /** DM 생성의 테넌트 경계 검증을 통과하도록 tenant#1 로 둔다. */
  @BeforeEach
  void setTenantContext() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenantContext() {
    TenantContext.clear();
  }

  /** 고유 사용자 1명 + tenant#1 ACTIVE 멤버십. kind 는 HUMAN/AGENT. */
  private long seedUser(String kind) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "rs_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Rs" + s)
            .set(USER.EMAIL, "rs_" + s + "@example.com")
            .set(USER.KIND, kind)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private OffsetDateTime readAt(long channelId, long userId) {
    return dsl.select(CHANNEL_MEMBER.LAST_READ_AT)
        .from(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .fetchOne(CHANNEL_MEMBER.LAST_READ_AT);
  }

  private void setReadAt(long channelId, long userId, OffsetDateTime at) {
    dsl.update(CHANNEL_MEMBER)
        .set(CHANNEL_MEMBER.LAST_READ_AT, at)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /** 읽은 위치가 앞으로 갈 때만 시각이 바뀌고 이벤트가 난다 — 같은·더 앞 위치를 다시 읽음 처리해도 「언제 읽었나」가 그대로다. */
  @Test
  void markRead_setsReadAt_onlyWhenWatermarkAdvances() {
    long me = seedUser("HUMAN");
    long other = seedUser("HUMAN");
    long dm = dmService.createOrGet(me, List.of(other)).dm().id();
    long m1 = messageService.create(me, dm, new CreateMessageRequest("1")).id();
    long m2 = messageService.create(me, dm, new CreateMessageRequest("2")).id();

    assertThat(readAt(dm, other)).isNull();
    messageService.markRead(other, dm, m1);
    assertThat(readAt(dm, other)).isNotNull();

    // 시각을 과거로 돌려 두고 같은 위치·더 앞 위치를 다시 읽음 → 그대로.
    OffsetDateTime past = OffsetDateTime.of(2026, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    setReadAt(dm, other, past);
    long eventsBefore = events.stream(MessageReadEvent.class).count();
    messageService.markRead(other, dm, m1);
    assertThat(readAt(dm, other)).isEqualTo(past);
    // 위치가 그대로인 다시 읽음은 이벤트도 내지 않는다(전 멤버 SSE 낭비 방지).
    assertThat(events.stream(MessageReadEvent.class).count()).isEqualTo(eventsBefore);

    // 더 뒤 위치를 읽으면 지금 시각으로 바뀌고, 이벤트에도 그 시각이 실린다.
    messageService.markRead(other, dm, m2);
    OffsetDateTime now = readAt(dm, other);
    assertThat(now).isAfter(past);
    MessageReadEvent last = events.stream(MessageReadEvent.class).reduce((a, b) -> b).orElseThrow();
    assertThat(last.lastReadMessageId()).isEqualTo(m2);
    assertThat(last.readAt()).isEqualTo(now.toInstant());
  }

  /** 그룹 DM 읽음 목록 — 나·AI 멤버·아직 아무것도 읽지 않은 멤버는 빼고, 읽은 위치·시각을 준다. */
  @Test
  void readStates_groupDm_listsOtherHumansWhoRead() {
    long me = seedUser("HUMAN");
    long reader = seedUser("HUMAN");
    long notYet = seedUser("HUMAN");
    long agent = seedUser("AGENT");
    long dm = dmService.createOrGet(me, List.of(reader, notYet, agent)).dm().id();
    long m1 = messageService.create(me, dm, new CreateMessageRequest("안건 공유")).id();
    messageService.markRead(reader, dm, m1);
    messageService.markRead(agent, dm, m1);
    messageService.markRead(me, dm, m1);

    List<ChannelReadStateResponse> states = messageService.readStates(me, dm);

    assertThat(states).extracting(ChannelReadStateResponse::userId).containsExactly(reader);
    assertThat(states.get(0).lastReadMessageId()).isEqualTo(m1);
    assertThat(states.get(0).readAt()).isEqualTo(readAt(dm, reader).toInstant());
  }

  /** 채널(kind=CHANNEL)은 읽음 표시를 하지 않는다 — 빈 목록. 비멤버는 403. */
  @Test
  void readStates_channelIsEmpty_andNonMemberForbidden() {
    long owner = seedUser("HUMAN");
    long member = seedUser("HUMAN");
    long channelId = channelRepo.insertPublic("rs-채널-" + UUID.randomUUID(), owner);
    channelService.join(owner, channelId);
    channelService.join(member, channelId);
    long m1 = messageService.create(owner, channelId, new CreateMessageRequest("x")).id();
    messageService.markRead(member, channelId, m1);

    assertThat(messageService.readStates(owner, channelId)).isEmpty();

    long me = seedUser("HUMAN");
    long other = seedUser("HUMAN");
    long dm = dmService.createOrGet(me, List.of(other)).dm().id();
    assertThatThrownBy(() -> messageService.readStates(owner, dm))
        .isInstanceOf(ChannelNotMemberException.class);
  }
}
