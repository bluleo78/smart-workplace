package com.workplace.messaging.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessagePushCandidateEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.notify.dto.NotificationActor;
import com.workplace.notify.dto.NotificationApp;
import com.workplace.notify.dto.NotificationSettingItem;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest.CellChange;
import com.workplace.notify.push.MessagePushRequest;
import com.workplace.notify.service.NotificationSettingService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메시지 푸시 수신자 계산이 알림 설정(채팅 DM·채널 멘션 줄)을 따르는지(WP-913). 채팅 메시지는 인박스 행이 없어 이 계산이 유일한 필터다. 작성자 kind 로 칸을
 * 고른다. resolver 를 같은 트랜잭션에서 직접 호출한다(MessagePushEventTest 와 같은 방식).
 */
@Transactional
class MessagePushRecipientSettingsTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MessagePushRecipientResolver resolver;
  @Autowired DmService dmService;
  @Autowired ChannelService channelService;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired NotificationSettingService settings;

  private long author;
  private long r;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    author = withMembership(TestFixtures.createHuman(dsl));
    r = withMembership(TestFixtures.createHuman(dsl));
  }

  @Test
  void dm_default_targetsRecipient() {
    long dmId = dmService.createOrGet(author, List.of(r)).dm().id();

    MessagePushRequest req = resolver.resolve(candidate(dmId, author, List.of()));

    assertThat(req.dmRecipientIds()).containsExactly(r);
  }

  @Test
  void dm_humanCellOff_noTargets() {
    long dmId = dmService.createOrGet(author, List.of(r)).dm().id();
    cell(r, NotificationSettingItem.CHAT_DM, NotificationActor.HUMAN, false);

    assertThat(resolver.resolve(candidate(dmId, author, List.of()))).isNull();
  }

  @Test
  void dm_byAgent_usesAgentCell() {
    long agent = createAgentUserWithMembership("mprs-agent");
    long dmId = dmService.createOrGet(r, List.of(agent)).dm().id();
    cell(r, NotificationSettingItem.CHAT_DM, NotificationActor.AGENT, false);
    cell(r, NotificationSettingItem.CHAT_DM, NotificationActor.HUMAN, true);

    assertThat(resolver.resolve(candidate(dmId, agent, List.of()))).isNull();

    // 대조군: 「AI가」 칸을 켜면 같은 메시지가 r 에게 간다(칸 선택이 작성자 kind 를 따름).
    cell(r, NotificationSettingItem.CHAT_DM, NotificationActor.AGENT, true);
    assertThat(resolver.resolve(candidate(dmId, agent, List.of())).dmRecipientIds())
        .containsExactly(r);
  }

  @Test
  void channelMention_appOff_noTargets() {
    long ch =
        channelService
            .create(author, "mprs-" + UUID.randomUUID().toString().substring(0, 8), "PUBLIC")
            .id();
    memberRepo.add(ch, r, "MEMBER");
    MessagePushCandidateEvent e = candidate(ch, author, List.of(r));
    assertThat(resolver.resolve(e).mentionedUserIds()).containsExactly(r); // 대조군: 기본은 받음

    settings.update(
        r, new UpdateNotificationSettingsRequest(Map.of(NotificationApp.CHAT, false), null));

    assertThat(resolver.resolve(e)).isNull();
  }

  private static MessagePushCandidateEvent candidate(
      long channelId, long authorId, List<Long> mentioned) {
    return new MessagePushCandidateEvent(1L, channelId, 1L, null, authorId, "작성자", "안녕", mentioned);
  }

  private void cell(
      long userId, NotificationSettingItem item, NotificationActor column, boolean enabled) {
    settings.update(
        userId,
        new UpdateNotificationSettingsRequest(
            null, List.of(new CellChange(item, column, enabled))));
  }
}
