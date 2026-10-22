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

  /** 채널 연동 공간 보장(없으면 생성 + 멤버 투영). 멱등. callerId 기준 응답 반환. 보관 상태는 건드리지 않는다. */
  default DriveSpaceResponse ensureChannelSpace(
      long callerId, long channelId, String channelName, List<ChannelMemberSnapshot> members) {
    return ensureChannelSpace(callerId, channelId, channelName, members, null);
  }

  /**
   * 채널 연동 공간 보장 + 보관 상태 맞춤(WP-787). channelArchived 가 null 이 아니면 공간의 보관 상태를 채널과 같게 맞춘다 — 이미 보관된
   * 채널에서 공간이 처음 만들어지면 보관 표시 없이 생겨 업로드·폴더 생성이 그대로 됐다(보관 이벤트는 공간이 있을 때만 반영된다).
   */
  DriveSpaceResponse ensureChannelSpace(
      long callerId,
      long channelId,
      String channelName,
      List<ChannelMemberSnapshot> members,
      Boolean channelArchived);

  /** 멤버 동기화 — 연동 공간이 있으면 roster 로 reconcile, 없으면 no-op(이벤트 투영용). */
  void syncChannelMembers(long channelId, List<ChannelMemberSnapshot> members);

  /** 이름 동기화 — 연동 공간이 있으면 채널의 새 이름으로 바꾸고, 없으면 no-op(WP-532). */
  void renameChannelSpace(long channelId, String channelName);

  /** 보관 상태 동기화 — 연동 공간이 있으면 archived 반영, 없으면 no-op. */
  void setChannelSpaceArchived(long channelId, boolean archived);

  /**
   * 채널 삭제 반영 — 연동 공간이 있으면 팀 공간 삭제와 같은 방식으로 영구 삭제(파일·버전 blob 만료 후 공간 행 삭제, 공유 링크·멤버는 cascade), 없으면
   * no-op(WP-525). actorId 는 변경 알림 발신자.
   */
  void deleteChannelSpace(long channelId, long actorId);
}
