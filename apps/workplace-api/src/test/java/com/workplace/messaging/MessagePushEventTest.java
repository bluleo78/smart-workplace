package com.workplace.messaging;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessagePushRequestedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.DmService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/** MessageService.create 가 DM 상대·채널 멤버 멘션 대상을 계산해 MessagePushRequestedEvent 를 발행하는지. */
@Transactional
@RecordApplicationEvents
class MessagePushEventTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MessageService messageService;
  @Autowired ChannelService channelService;
  @Autowired DmService dmService;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired ApplicationEvents events;

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  private long seedUser(String kind) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "mp_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Mp" + s)
            .set(USER.EMAIL, "mp_" + s + "@example.com")
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

  private MessagePushRequestedEvent lastEvent() {
    return events.stream(MessagePushRequestedEvent.class).reduce((a, b) -> b).orElseThrow();
  }

  @Test
  void create_dm_targetsOtherHumans() {
    long me = seedUser("HUMAN");
    long you = seedUser("HUMAN");
    long dmId = dmService.createOrGet(me, List.of(you)).dm().id();

    messageService.create(me, dmId, new CreateMessageRequest("안녕"));

    MessagePushRequestedEvent e = lastEvent();
    assertThat(e.channelKind()).isEqualTo("DM");
    assertThat(e.dmRecipientIds()).containsExactly(you);
    assertThat(e.authorId()).isEqualTo(me);
    assertThat(e.preview()).isEqualTo("안녕");
    assertThat(e.tenantId()).isEqualTo(1L);
  }

  @Test
  void create_channelMention_excludesNonMemberAgentAndAuthor() {
    long me = seedUser("HUMAN");
    long member = seedUser("HUMAN");
    long outsider = seedUser("HUMAN");
    long agent = seedUser("AGENT");
    long ch =
        channelService
            .create(me, "push-" + UUID.randomUUID().toString().substring(0, 8), "PUBLIC")
            .id();
    memberRepo.add(ch, member, "MEMBER");
    memberRepo.add(ch, agent, "MEMBER");

    messageService.create(
        me,
        ch,
        new CreateMessageRequest(
            "<@" + member + "> <@" + outsider + "> <@" + agent + "> <@" + me + "> 확인"));

    MessagePushRequestedEvent e = lastEvent();
    assertThat(e.channelKind()).isEqualTo("CHANNEL");
    assertThat(e.mentionedUserIds()).containsExactly(member);
    assertThat(e.dmRecipientIds()).isEmpty();
    assertThat(e.channelName()).startsWith("push-");
  }

  @Test
  void create_channelWithoutMention_noEvent() {
    long me = seedUser("HUMAN");
    long ch =
        channelService
            .create(me, "push-" + UUID.randomUUID().toString().substring(0, 8), "PUBLIC")
            .id();
    messageService.create(me, ch, new CreateMessageRequest("그냥 메시지"));
    assertThat(events.stream(MessagePushRequestedEvent.class)).isEmpty();
  }
}
