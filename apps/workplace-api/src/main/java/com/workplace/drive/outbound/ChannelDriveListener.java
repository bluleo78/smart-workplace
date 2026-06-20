package com.workplace.drive.outbound;

import com.workplace.drive.api.DriveChannelSpacePort;
import com.workplace.drive.api.DriveChannelSpacePort.ChannelMemberSnapshot;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelArchivedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelMembershipChangedEvent;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * messaging 채널 도메인 이벤트를 받아 연동 드라이브 공간 멤버십/보관 상태를 투영(reconcile).
 *
 * <p>drive 는 messaging service/repository 를 import 하지 않는다 — 이벤트 record(공개 계약)만 의존.
 * IssueStakeholderListener 와 동일하게 @EventListener + @Transactional(동기·인-트랜잭션). 연동 공간이 없으면 포트가
 * no-op(평소 채널엔 공간 미생성).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ChannelDriveListener {

  private final DriveChannelSpacePort port;

  /** 채널 멤버십 변경 → 연동 공간 roster reconcile. */
  @EventListener
  @Transactional
  public void onMembershipChanged(ChannelMembershipChangedEvent e) {
    List<ChannelMemberSnapshot> roster =
        e.members().stream().map(m -> new ChannelMemberSnapshot(m.userId(), m.role())).toList();
    port.syncChannelMembers(e.channelId(), roster);
  }

  /** 채널 보관 토글 → 연동 공간 읽기전용 반영. */
  @EventListener
  @Transactional
  public void onChannelArchived(ChannelArchivedEvent e) {
    port.setChannelSpaceArchived(e.channelId(), e.archived());
  }
}
