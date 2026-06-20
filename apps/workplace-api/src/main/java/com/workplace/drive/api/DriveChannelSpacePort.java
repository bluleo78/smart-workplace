package com.workplace.drive.api;

import com.workplace.drive.dto.DriveSpaceResponse;
import java.util.List;

/**
 * 채널 연동 드라이브 공간 공개 포트. messaging 모듈이 채널 컨텍스트에서 호출한다(messaging→drive 단방향). drive 내부
 * service/repository 를 노출하지 않기 위한 경계 인터페이스.
 */
public interface DriveChannelSpacePort {

  /** 채널 멤버 스냅샷 1건(채널 역할 OWNER/ADMIN/MEMBER). */
  record ChannelMemberSnapshot(long userId, String channelRole) {}

  /** 채널 연동 공간 보장(없으면 생성 + 멤버 투영). 멱등. callerId 기준 응답 반환. */
  DriveSpaceResponse ensureChannelSpace(
      long callerId, long channelId, String channelName, List<ChannelMemberSnapshot> members);

  /** 멤버 동기화 — 연동 공간이 있으면 roster 로 reconcile, 없으면 no-op(이벤트 투영용). */
  void syncChannelMembers(long channelId, List<ChannelMemberSnapshot> members);

  /** 보관 상태 동기화 — 연동 공간이 있으면 archived 반영, 없으면 no-op. */
  void setChannelSpaceArchived(long channelId, boolean archived);
}
