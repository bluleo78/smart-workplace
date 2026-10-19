package com.workplace.messaging.service;

import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelMembershipChangedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 채널 멤버가 바뀐 뒤 현재 roster 로 멤버십 변경 이벤트를 발행한다 — 드라이브 연동 공간 reconcile 의 소스.
 *
 * <p>멤버를 바꾸는 모든 경로(초대·제거·나가기·역할 변경·공개 채널 참여)가 이것을 불러야 한다. 참여(join)만 빠져 있어 참여자가 연동 공간에 반영되지
 * 않았다(WP-531).
 */
@Component
@RequiredArgsConstructor
public class ChannelRosterPublisher {

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final ApplicationEventPublisher publisher;

  /** 현재 roster 전체로 이벤트 발행(증분 아님 — 수신 측이 집합으로 reconcile). */
  public void publish(long channelId) {
    String name = channelRepo.findName(channelId).orElse("");
    List<ChannelMembershipChangedEvent.Member> roster =
        memberRepo.listMembers(channelId).stream()
            .map(m -> new ChannelMembershipChangedEvent.Member(m.userId(), m.role()))
            .toList();
    publisher.publishEvent(
        new ChannelMembershipChangedEvent(channelId, name, roster, Instant.now()));
  }
}
