package com.workplace.drive.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.drive.dto.DriveMemberResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveSpaceNameDuplicatedException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.drive.outbound.DriveChangeNotifier;
import com.workplace.drive.repository.DriveSpaceMemberRepository;
import com.workplace.drive.repository.DriveSpaceRepository;
import com.workplace.global.tenant.MembershipGuard;
import java.util.List;
import java.util.Set;
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
  private final MembershipGuard membershipGuard;

  /** 스페이스·멤버 변경 resource.changed 발행(WP-63). */
  private final DriveChangeNotifier notifier;

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

  /**
   * 독립 팀 공간 생성. 생성자가 OWNER. 이름은 만드는 사람이 볼 수 있는(멤버인) TEAM 공간과 겹칠 수 없다(#696 의 "컨테이너류 이름은 식별자" 정책을
   * WP-693 에서 볼 수 있는 범위로 좁힘 — 채널 WP-590 처럼 볼 수 없는 공간 존재를 숨기려고).
   */
  @Transactional
  public DriveSpaceResponse createTeamSpace(long callerId, String name) {
    // 같은 이름의 동시 생성·이름 변경과 차례를 세운 뒤 검사한다(WP-772 — 유니크 인덱스가 없어 검사만으로는 동시 요청이 모두 통과했다).
    spaces.lockTeamSpaceName(name);
    if (spaces.existsVisibleTeamSpaceName(name, callerId, null)) {
      throw new DriveSpaceNameDuplicatedException(name);
    }
    long id = spaces.insert("TEAM", name, callerId);
    members.add(id, callerId, "OWNER");
    notifier.spaceChanged(OP_CREATED, id, callerId, Set.of());
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

  /**
   * 멤버 추가. OWNER 권한 필요. 대상이 현재 테넌트의 활성 멤버가 아니면 거부한다 — 테넌트 경계를 넘는 드라이브 공간 멤버십 등록 차단 (messaging
   * ChannelMemberService.add() 와 동일 정책, #713).
   */
  @Transactional
  public void addMember(long callerId, long spaceId, long userId, String role) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    perms.validateRole(role);
    if (membershipGuard.isForeignUser(userId)) {
      throw new DriveForbiddenException(spaceId, userId);
    }
    // 추가는 이미 멤버면 역할을 덮어쓰는 업서트라, 마지막 OWNER 강등도 역할 변경과 같은 가드를 거친다(WP-557).
    if (!"OWNER".equals(role)) requireAnotherOwner(spaceId, userId);
    members.add(spaceId, userId, role);
    notifier.spaceChanged(OP_UPDATED, spaceId, callerId, Set.of());
  }

  @Transactional
  public void changeRole(long callerId, long spaceId, long userId, String role) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    perms.validateRole(role);
    // 멤버가 아니면 바꿀 행이 없다 — 0행 UPDATE 를 성공(204)으로 돌려주지 않고 거절한다(WP-667).
    if (members.findRole(spaceId, userId).isEmpty()) {
      throw new com.workplace.drive.exception.DriveSpaceMemberNotFoundException();
    }
    if (!"OWNER".equals(role)) requireAnotherOwner(spaceId, userId);
    members.changeRole(spaceId, userId, role);
    notifier.spaceChanged(OP_UPDATED, spaceId, callerId, Set.of());
  }

  @Transactional
  public void removeMember(long callerId, long spaceId, long userId) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    requireAnotherOwner(spaceId, userId);
    members.remove(spaceId, userId);
    // 제거된 멤버는 커밋 후 명단에 없으므로 extra 로 넘겨 목록에서 사라지게 한다.
    notifier.spaceChanged(OP_UPDATED, spaceId, callerId, List.of(userId));
  }

  /**
   * 대상이 OWNER 이고 마지막 OWNER 면 제거·강등을 거부한다(WP-496) — 빠지면 멤버 관리·편집을 할 사람이 없는 공간이 남고, 공간 이름도 묶인다. 대상이
   * OWNER 가 아니면(또는 다른 OWNER 가 있으면) 그대로 진행한다.
   */
  private void requireAnotherOwner(long spaceId, long userId) {
    // 소유자 행을 잠근 뒤 그 집합으로 판정한다(WP-788) — 두 소유자가 서로를 동시에 강등·제거해도 나중 요청은 앞 요청의 커밋을 기다렸다 판정해 소유자
    // 0명이 되지 않는다.
    List<Long> owners = members.lockOwnerIds(spaceId);
    if (owners.contains(userId) && owners.size() <= 1) {
      throw new com.workplace.drive.exception.DriveLastOwnerException(spaceId);
    }
  }

  /**
   * TEAM 공간이 아니면 거부 — PERSONAL("내 드라이브")/CHANNEL(채널 소유) 보호. rename·delete·멤버 변경이 공유하는 단일 타입 가드. 개인
   * 공간 멤버를 바꾸면 남에게 넘기거나 소유자가 빠져 영구히 열리지 않고, 채널 공간 멤버는 채널 멤버십을 따른다(WP-495).
   */
  private void requireTeamSpace(long spaceId) {
    String type =
        spaces.findType(spaceId).orElseThrow(() -> new DriveSpaceNotFoundException(spaceId));
    if (!"TEAM".equals(type)) {
      throw new com.workplace.drive.exception.DriveSpaceTypeNotEditableException(spaceId, type);
    }
  }

  /** TEAM 공간 이름 변경. OWNER 전용. 바꾸는 사람이 볼 수 있는 다른 TEAM 공간과 이름이 겹치면 차단(#696·WP-693). */
  @Transactional
  public DriveSpaceResponse renameTeamSpace(long callerId, long spaceId, String name) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    spaces.lockTeamSpaceName(name); // WP-772 — 만들기와 같은 이름 잠금
    if (spaces.existsVisibleTeamSpaceName(name, callerId, spaceId)) {
      throw new DriveSpaceNameDuplicatedException(name);
    }
    spaces.rename(spaceId, name);
    notifier.spaceChanged(OP_UPDATED, spaceId, callerId, Set.of());
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
    purgeSpace(spaceId, callerId);
  }

  /**
   * 공간 영구 삭제 본체(권한 확인 없음) — 파일·버전 blob 을 만료 표시(FileCleanupService 가 회수)하고 공간 행을 지운다. 파일·폴더·멤버·공유 링크
   * 행은 cascade. 팀 공간 삭제와 채널 삭제에 따른 연동 공간 삭제(WP-525)가 같이 쓴다. 권한·유형 확인은 호출측 책임.
   */
  @Transactional
  public void purgeSpace(long spaceId, long actorId) {
    // 하드삭제 cascade 로 멤버 행이 사라지므로 삭제 전에 명단을 확보한다.
    List<Long> before = members.memberUserIds(spaceId);
    files.expireFiles(files.allFileIdsInSpace(spaceId));
    files.expireFiles(versions.fileIdsForSpace(spaceId));
    spaces.deleteSpace(spaceId);
    notifier.spaceChanged(OP_DELETED, spaceId, actorId, before);
  }
}
