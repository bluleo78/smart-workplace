package com.workplace.drive.service;

import com.workplace.drive.api.DriveChannelSpacePort;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.drive.repository.DriveSpaceMemberRepository;
import com.workplace.drive.repository.DriveSpaceRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 채널 연동 공간 포트 구현 — lazy 생성 + 멤버/보관 reconcile. 역할 매핑은 drive 가 소유. */
@Service
@RequiredArgsConstructor
public class DriveChannelSpaceService implements DriveChannelSpacePort {

  private final DriveSpaceRepository spaces;
  private final DriveSpaceMemberRepository members;

  /** 채널 역할 → 공간 역할: OWNER→OWNER, 그 외(ADMIN/MEMBER)→EDITOR. */
  private static String mapRole(String channelRole) {
    return "OWNER".equals(channelRole) ? "OWNER" : "EDITOR";
  }

  private static Map<Long, String> rosterToRoles(List<ChannelMemberSnapshot> members) {
    Map<Long, String> m = new LinkedHashMap<>();
    for (ChannelMemberSnapshot s : members) {
      m.put(s.userId(), mapRole(s.channelRole()));
    }
    return m;
  }

  @Override
  @Transactional
  public DriveSpaceResponse ensureChannelSpace(
      long callerId, long channelId, String channelName, List<ChannelMemberSnapshot> roster) {
    long spaceId =
        spaces
            .findIdByLinkedChannel(channelId)
            .orElseGet(() -> createChannelSpace(channelId, channelName, roster));
    // 기존 공간이어도 roster 재투영(self-heal) — 멱등.
    members.reconcileMembers(spaceId, rosterToRoles(roster));
    return spaces
        .findForUser(spaceId, callerId)
        .orElseThrow(() -> new DriveSpaceNotFoundException(spaceId));
  }

  /** owner_id 는 채널 OWNER(없으면 roster 첫 멤버) — 출처 표기용. */
  private long createChannelSpace(
      long channelId, String channelName, List<ChannelMemberSnapshot> roster) {
    long ownerId =
        roster.stream()
            .filter(s -> "OWNER".equals(s.channelRole()))
            .map(ChannelMemberSnapshot::userId)
            .findFirst()
            .orElseGet(() -> roster.isEmpty() ? 0L : roster.get(0).userId());
    // 공간 행만 생성 — 멤버 reconcile 은 ensureChannelSpace 가 일괄 수행(중복 호출 제거).
    // ON CONFLICT DO NOTHING 이라 동시 생성 경쟁 시 빈 Optional → 기존 공간 재조회(트랜잭션 비오염).
    return spaces
        .insertChannelSpace(channelName, ownerId, channelId)
        .orElseGet(
            () ->
                spaces
                    .findIdByLinkedChannel(channelId)
                    .orElseThrow(() -> new DriveSpaceNotFoundException(0L)));
  }

  @Override
  @Transactional
  public void syncChannelMembers(long channelId, List<ChannelMemberSnapshot> roster) {
    spaces
        .findIdByLinkedChannel(channelId)
        .ifPresent(spaceId -> members.reconcileMembers(spaceId, rosterToRoles(roster)));
  }

  @Override
  @Transactional
  public void setChannelSpaceArchived(long channelId, boolean archived) {
    spaces
        .findIdByLinkedChannel(channelId)
        .ifPresent(spaceId -> spaces.setArchived(spaceId, archived));
  }
}
