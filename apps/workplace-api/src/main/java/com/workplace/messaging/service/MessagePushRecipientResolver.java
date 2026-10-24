package com.workplace.messaging.service;

import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessagePushCandidateEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.notify.dto.NotificationSettingItem;
import com.workplace.notify.push.MessagePushRequest;
import com.workplace.notify.service.NotificationSettingService;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메시지 푸시 수신 대상 계산. 커밋 후 MessagePushDispatcher(pushExecutor 스레드)가 호출한다.
 *
 * <p>규칙: DM → 작성자 외 HUMAN 멤버 전원. 채널 → 멘션 대상 중 채널 멤버이면서 작성자가 아닌 사람(AGENT 멘션은 후보 단계에서 이미 제외). 멘션 없는
 * 일반 채널 메시지는 대상 없음. 그 뒤 알림 설정(DM·채널 멘션 줄, 작성자 kind 로 「사람이」/「AI가」 칸)을 끈 사람을 뺀다(WP-913). 대상이 없으면
 * null.
 *
 * <p>호출자와 다른 빈으로 둔 이유: {@code @Transactional} 이 프록시를 거쳐야 TenantAwareTransactionManager 가 tenant GUC
 * 를 주입한다(self-invocation 이면 트랜잭션이 없어 RLS 가 채널·멤버 행을 가려 조용히 "대상 없음"이 된다).
 * PushContentService.forInbox 와 같은 패턴.
 */
@Service
@RequiredArgsConstructor
public class MessagePushRecipientResolver {

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final NotificationSettingService settings;

  /** 후보 이벤트 → 발송 요청. 대상이 없으면 null(발송 안 함). */
  @Transactional(readOnly = true)
  public MessagePushRequest resolve(MessagePushCandidateEvent e) {
    String kind = channelRepo.findKind(e.channelId());
    boolean dm = "DM".equals(kind);
    // 멘션 없는 일반 채널 메시지(채널 메시지 대다수)는 멤버 조회 없이 즉시 스킵.
    if (!dm && e.mentionedUserIds().isEmpty()) return null;
    // 멤버 조회는 한 번만 — DM 수신자 목록과 멘션 유효성(채널 멤버 여부) 검증에 함께 쓴다.
    List<ChannelMemberResponse> members = memberRepo.listMembers(e.channelId());
    List<Long> dmRecipients =
        dm
            ? members.stream()
                .filter(m -> !m.userId().equals(e.authorId()) && !"AGENT".equals(m.kind()))
                .map(ChannelMemberResponse::userId)
                .toList()
            : List.of();
    Set<Long> memberIds =
        members.stream().map(ChannelMemberResponse::userId).collect(Collectors.toSet());
    List<Long> mentioned =
        e.mentionedUserIds().stream()
            .filter(id -> memberIds.contains(id) && id != e.authorId())
            .distinct()
            .toList();
    // 채팅 DM·채널 멘션은 인박스 행이 없어(푸시만 나간다) NotificationService 의 설정 필터를 거치지 않는다 — 여기서 같은 규칙으로 거른다.
    // 수신자는 모두 멤버라 종류를 이미 읽어 둔 멤버 목록에서 넘긴다(작성자가 멤버가 아니면 그 한 명만 설정 판정이 조회한다).
    Map<Long, String> kinds = new HashMap<>();
    members.forEach(m -> kinds.put(m.userId(), m.kind()));
    dmRecipients =
        settings.filterRecipients(
            dmRecipients, NotificationSettingItem.CHAT_DM, e.authorId(), kinds);
    mentioned =
        settings.filterRecipients(
            mentioned, NotificationSettingItem.CHAT_CHANNEL_MENTION, e.authorId(), kinds);
    if (dmRecipients.isEmpty() && mentioned.isEmpty()) return null;
    return new MessagePushRequest(
        e.tenantId(),
        e.channelId(),
        kind,
        dm ? null : channelRepo.findName(e.channelId()).orElse(null),
        e.messageId(),
        e.parentMessageId(),
        e.authorId(),
        e.authorName(),
        e.preview(),
        dmRecipients,
        mentioned);
  }
}
