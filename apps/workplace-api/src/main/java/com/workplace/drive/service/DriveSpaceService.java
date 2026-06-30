package com.workplace.drive.service;

import com.workplace.drive.dto.DriveMemberResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.drive.repository.DriveSpaceMemberRepository;
import com.workplace.drive.repository.DriveSpaceRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 드라이브 공간/멤버. 소유자는 생성 시 OWNER 멤버로 등록되어 권한이 멤버십으로 일원화된다. */
@Service
@RequiredArgsConstructor
public class DriveSpaceService {
  private final DriveSpaceRepository spaces;
  private final DriveSpaceMemberRepository members;
  private final DrivePermissions perms;
  private final com.workplace.drive.repository.DriveFileRepository files;
  private final com.workplace.drive.repository.DriveFileVersionRepository versions;

  /** 개인 공간을 보장(없으면 생성). 멱등. */
  @Transactional
  public DriveSpaceResponse ensurePersonalSpace(long userId) {
    long spaceId =
        spaces
            .findPersonalSpaceId(userId)
            .orElseGet(
                () -> {
                  long id = spaces.insert("PERSONAL", "내 드라이브", userId);
                  members.add(id, userId, "OWNER");
                  return id;
                });
    return spaces
        .findForUser(spaceId, userId)
        .orElseThrow(() -> new DriveSpaceNotFoundException(spaceId));
  }

  /** 독립 팀 공간 생성. 생성자가 OWNER. */
  @Transactional
  public DriveSpaceResponse createTeamSpace(long callerId, String name) {
    long id = spaces.insert("TEAM", name, callerId);
    members.add(id, callerId, "OWNER");
    return spaces.findForUser(id, callerId).orElseThrow(() -> new DriveSpaceNotFoundException(id));
  }

  /** 내 공간 목록(개인 자동생성 보장 + 멤버 팀). */
  @Transactional
  public List<DriveSpaceResponse> listMySpaces(long userId) {
    ensurePersonalSpace(userId);
    return spaces.findMySpaces(userId);
  }

  @Transactional(readOnly = true)
  public DriveSpaceResponse getSpace(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    return spaces
        .findForUser(spaceId, callerId)
        .orElseThrow(() -> new DriveSpaceNotFoundException(spaceId));
  }

  @Transactional(readOnly = true)
  public List<DriveMemberResponse> listMembers(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    return members.listMembers(spaceId);
  }

  @Transactional
  public void addMember(long callerId, long spaceId, long userId, String role) {
    perms.requireRole(spaceId, callerId, "OWNER");
    perms.validateRole(role);
    members.add(spaceId, userId, role);
  }

  @Transactional
  public void changeRole(long callerId, long spaceId, long userId, String role) {
    perms.requireRole(spaceId, callerId, "OWNER");
    perms.validateRole(role);
    members.changeRole(spaceId, userId, role);
  }

  @Transactional
  public void removeMember(long callerId, long spaceId, long userId) {
    perms.requireRole(spaceId, callerId, "OWNER");
    members.remove(spaceId, userId);
  }

  /** TEAM 공간이 아니면 거부 — PERSONAL("내 드라이브")/CHANNEL(채널 소유) 보호. rename·delete 가 공유하는 단일 타입 가드. */
  private void requireTeamSpace(long spaceId) {
    String type =
        spaces.findType(spaceId).orElseThrow(() -> new DriveSpaceNotFoundException(spaceId));
    if (!"TEAM".equals(type)) {
      throw new com.workplace.drive.exception.DriveSpaceTypeNotEditableException(spaceId, type);
    }
  }

  /** TEAM 공간 이름 변경. OWNER 전용. */
  @Transactional
  public DriveSpaceResponse renameTeamSpace(long callerId, long spaceId, String name) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    spaces.rename(spaceId, name);
    return spaces
        .findForUser(spaceId, callerId)
        .orElseThrow(() -> new DriveSpaceNotFoundException(spaceId));
  }

  /**
   * TEAM 공간 즉시 하드삭제. OWNER 전용. 내용물(폴더/파일)이 있어도 통째 삭제한다.
   *
   * <p>행 삭제 전 blob(현재 파일 + 전 버전)을 만료해 FileCleanupService 가 바이트를 회수하고, drive_space 행 삭제로
   * 멤버/폴더/파일/버전이 FK CASCADE 로 정리된다. 수집 SELECT 가 같은 tx 안에 있어야 RLS GUC 가 주입돼 fail-closed 누수가 없다.
   */
  @Transactional
  public void deleteTeamSpace(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    files.expireFiles(files.allFileIdsInSpace(spaceId));
    files.expireFiles(versions.fileIdsForSpace(spaceId));
    spaces.deleteSpace(spaceId);
  }
}
