package com.workplace.messaging;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessagePushCandidateEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.DmService;
import com.workplace.messaging.service.MessagePushRecipientResolver;
import com.workplace.messaging.service.MessageService;
import com.workplace.notify.push.MessagePushRequest;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메시지 푸시 대상 계산 — MessageService.create 가 메모리 값만으로 MessagePushCandidateEvent 를 발행하고, 커밋 후
 * MessagePushRecipientResolver 가 DM 상대·채널 멤버 멘션 대상을 확정하는지. 커밋 후 리스너는 롤백 테스트에서 돌지 않으므로 resolver 를 같은
 * 트랜잭션에서 직접 호출해 규칙을 검증한다(실제 커밋 경로는 MessagePushDeliveryTest).
 */
@Transactional
@RecordApplicationEvents
class MessagePushEventTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MessageService messageService;
  @Autowired MessagePushRecipientResolver resolver;
  @Autowired ChannelService channelService;
  @Autowired DmService dmService;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired ApplicationEvents events;

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  private long human() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  private long channel(long owner) {
    return channelService
        .create(owner, "push-" + UUID.randomUUID().toString().substring(0, 8), "PUBLIC")
        .id();
  }

  private MessagePushCandidateEvent lastCandidate() {
    return events.stream(MessagePushCandidateEvent.class).reduce((a, b) -> b).orElseThrow();
  }

  @Test
  void create_dm_targetsOtherHumans() {
    long me = human();
    long you = human();
    long dmId = dmService.createOrGet(me, List.of(you)).dm().id();

    messageService.create(me, dmId, new CreateMessageRequest("안녕"));

    MessagePushCandidateEvent c = lastCandidate();
    assertThat(c.tenantId()).isEqualTo(1L);
    assertThat(c.authorId()).isEqualTo(me);
    assertThat(c.preview()).isEqualTo("안녕");
    MessagePushRequest r = resolver.resolve(c);
    assertThat(r.channelKind()).isEqualTo("DM");
    assertThat(r.channelName()).isNull();
    assertThat(r.dmRecipientIds()).containsExactly(you);
    assertThat(r.authorId()).isEqualTo(me);
    assertThat(r.preview()).isEqualTo("안녕");
    assertThat(r.tenantId()).isEqualTo(1L);
  }

  @Test
  void create_channelMention_excludesNonMemberAgentAndAuthor() {
    long me = human();
    long member = human();
    long outsider = human();
    long agent = createAgentUserWithMembership("mp-agent");
    long ch = channel(me);
    memberRepo.add(ch, member, "MEMBER");
    memberRepo.add(ch, agent, "MEMBER");

    messageService.create(
        me,
        ch,
        new CreateMessageRequest(
            "<@" + member + "> <@" + outsider + "> <@" + agent + "> <@" + me + "> 확인"));

    MessagePushCandidateEvent c = lastCandidate();
    // AGENT 멘션은 후보 단계(메모리)에서 이미 빠진다.
    assertThat(c.mentionedUserIds()).doesNotContain(agent);
    MessagePushRequest r = resolver.resolve(c);
    assertThat(r.channelKind()).isEqualTo("CHANNEL");
    assertThat(r.mentionedUserIds()).containsExactly(member);
    assertThat(r.dmRecipientIds()).isEmpty();
    assertThat(r.channelName()).startsWith("push-");
  }

  @Test
  void create_channelWithoutMention_noTargets() {
    long me = human();
    long ch = channel(me);

    messageService.create(me, ch, new CreateMessageRequest("그냥 메시지"));

    assertThat(resolver.resolve(lastCandidate())).isNull();
  }

  /**
   * 리뷰 #866: 푸시는 메시지 작성을 절대 실패/롤백시키지 않는다 — TenantContext.get()==null 이면 후보 발행만 스킵한다. 트랜잭션은
   * IntegrationTestBase 의 @BeforeTransaction 이 이미 tenantId=1 로 GUC 를 주입했으므로 TenantContext 를 지워도 멤버십
   * 조회·RLS 는 그대로 통과하고, 오직 이벤트 발행만 스킵됨을 검증한다.
   */
  @Test
  void create_noTenantContext_stillCreatesMessage_noEvent() {
    long me = human();
    long member = human();
    long ch = channel(me);
    memberRepo.add(ch, member, "MEMBER");

    TenantContext.clear();
    MessageResponse saved =
        messageService.create(me, ch, new CreateMessageRequest("<@" + member + "> 확인"));

    assertThat(saved).isNotNull();
    assertThat(saved.body()).contains("확인");
    assertThat(events.stream(MessagePushCandidateEvent.class)).isEmpty();
  }
}
