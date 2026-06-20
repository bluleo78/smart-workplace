package com.workplace.messaging.service;

import com.workplace.drive.api.DriveChannelSpacePort;
import com.workplace.drive.api.DriveChannelSpacePort.ChannelMemberSnapshot;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.messaging.dto.ChannelDriveSpaceResponse;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 채널 '파일' 탭 진입 시 연동 드라이브 공간 보장. 멤버십 인가 + roster 스냅샷으로 drive 포트 동기 호출. messaging→drive 단방향(포트 인터페이스만
 * 의존).
 */
@Service
@RequiredArgsConstructor
public class ChannelDriveService {

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final ChannelPermissions perms;
  private final DriveChannelSpacePort drivePort;

  /** 연동 공간 보장 — 호출자가 채널 멤버여야. 비멤버 차단(비공개 404 은닉). */
  @Transactional
  public ChannelDriveSpaceResponse ensure(long callerId, long channelId) {
    if (!channelRepo.exists(channelId)) throw new ChannelNotFoundException(channelId);
    perms.requireMember(channelId, callerId);
    String name = channelRepo.findName(channelId).orElse("채널");
    List<ChannelMemberSnapshot> roster =
        memberRepo.listMembers(channelId).stream()
            .map(m -> new ChannelMemberSnapshot(m.userId(), m.role()))
            .toList();
    DriveSpaceResponse space = drivePort.ensureChannelSpace(callerId, channelId, name, roster);
    return new ChannelDriveSpaceResponse(space.id(), space.archived());
  }
}
