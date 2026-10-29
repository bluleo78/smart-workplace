package com.workplace.messaging.service;

import com.workplace.global.tenant.MembershipGuard;
import com.workplace.global.tenant.WorkspaceActive;
import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.exception.AgentCannotOwnChannelException;
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.exception.InactiveMemberException;
import com.workplace.messaging.exception.OwnershipTransferRequiredException;
import com.workplace.messaging.outbound.ChannelChangeNotifier;
import com.workplace.messaging.repository.ChannelMemberGroupRepository;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 채널 멤버 관리 — 목록/초대/제거/나가기/역할변경(소유권 이전).
 *
 * <p>멤버 부서(WP-1058)와의 관계: 사람 행은 한 사람에 한 줄이고 direct 로 직접 멤버인지 가른다. 초대·관리 역할 승격은 직접 멤버로 고정하고(부서가 빠져도
 * 남는다), 부서로 걸리는 사람을 내보내거나 그 사람이 나가면 개인 제외를 남겨 맞추기가 다시 넣지 않게 한다(다시 초대하면 지운다).
 */
@Service
@RequiredArgsConstructor
public class ChannelMemberService {

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final ChannelMemberGroupRepository groupRepo;
  private final ChannelPermissions perms;
  private final MembershipGuard membershipGuard;
  private final ChannelChangeNotifier changeNotifier;
  private final ChannelRosterPublisher rosterPublisher;
  private final UserRepository userRepo;

  private static final List<String> VALID_ROLES = List.of("OWNER", "ADMIN", "MEMBER");

  /**
   * 멤버 목록 — 읽을 수 있는 사람만(멤버, 또는 보관된 공개 채널이면 누구나 — WP-621). 그 밖의 비멤버는 404 은닉. RLS GUC 주입
   * 위해 @Transactional 필요(없으면 빈 결과). 사람마다 걸리는 이 채널의 멤버 부서(viaGroupIds, WP-1058)를 붙인다.
   */
  @Transactional(readOnly = true)
  public List<ChannelMemberResponse> listMembers(long callerId, long channelId) {
    ensureExists(channelId);
    if (!perms.canRead(channelId, callerId)) throw new ChannelNotFoundException(channelId);
    Map<Long, List<Long>> covering = groupRepo.coveringGroupsByUser(channelId);
    return memberRepo.listMembers(channelId).stream()
        .map(m -> m.withViaGroupIds(covering.getOrDefault(m.userId(), List.of())))
        .toList();
  }

  /**
   * 멤버 추가 — OWNER/ADMIN 또는 시스템 ADMIN. 직접 멤버(MEMBER)로 넣는다(idempotent). 부서로 이미 들어와 있으면 행을 새로 만들지 않고
   * 직접 멤버로 고정한다 — 역할·읽은 위치 그대로(WP-1058). 개인 제외(내보냈거나 나간 기록)가 있으면 지운다 — 다시 초대한 사람은 부서 판정에서도 다시 들어온다.
   */
  @Transactional
  public void add(long callerId, long channelId, long targetUserId) {
    checkAdd(callerId, channelId, targetUserId);
    // 잠금은 권한 검사 뒤 — 볼 수 없는 사람의 요청(404)이 채널의 멤버십 쓰기를 붙잡지 않게.
    lockExisting(channelId);
    memberRepo.addDirect(channelId, targetUserId);
    groupRepo.deleteExclusion(channelId, targetUserId);
    rosterPublisher.publish(channelId);
    changeNotifier.membershipChanged(channelId, callerId, List.of(targetUserId));
  }

  /**
   * 멤버 추가 사전검증(#856) — 확인 카드 dry-run 이 {@link #add} 와 같은 {@link #checkAdd} 를 쓴다. 실행은 이미 멤버여도
   * 성공(idempotent)이지만 그런 카드는 아무 효과가 없으므로 사전검증에서만 사유와 함께 거절한다. 부서로만 들어와 있는 사람은 초대하면 직접 멤버로
   * 고정되므로(WP-1058) 거절하지 않는다.
   */
  @Transactional(readOnly = true)
  public void validateAdd(long callerId, long channelId, long targetUserId) {
    checkAdd(callerId, channelId, targetUserId);
    if (memberRepo.findDirect(channelId, targetUserId).orElse(false)) {
      throw new IllegalArgumentException("이미 채널 멤버입니다: userId=" + targetUserId);
    }
  }

  /** 멤버 추가 술어 — 채널 존재·DM 아님·관리 권한·대상이 현재 테넌트 구성원. */
  private void checkAdd(long callerId, long channelId, long targetUserId) {
    ensureExists(channelId);
    // 권한 먼저 — 비공개(DM 포함) 비멤버는 여기서 404 로 존재를 숨긴다(WP-511). DM 차단은 그 뒤.
    perms.requireManage(channelId, callerId, "add-member");
    requireNotDm(callerId, channelId, "add-member");
    // 보관된 채널은 읽기 전용 — 멤버를 새로 넣을 수 없다(WP-508). 내보내기·나가기는 정리용이라 허용한다.
    if (channelRepo.isArchived(channelId))
      throw new ChannelArchivedException(channelId, "보관된 채널에는 구성원을 초대할 수 없습니다");
    // WP-723: 이 워크스페이스 구성원이지만 정지(또는 전역 비활성)된 대상은 「권한이 없습니다」가 아니라 실제 이유로 거절한다
    // (프로젝트 멤버 추가의 「비활성화된 사용자는 멤버로 추가할 수 없습니다」와 같은 판정).
    if (isInactiveMember(targetUserId)) {
      throw new InactiveMemberException("비활성화된 구성원은 채널에 초대할 수 없습니다");
    }
    // 추가 대상 사용자가 현재 테넌트의 활성 멤버인지 확인 — 테넌트 경계를 넘는 채널 멤버십 차단(설계 §4).
    // project/wiki/drive 공간 addMember 와 공용 헬퍼(MembershipGuard)로 정책 통일 (#713).
    if (membershipGuard.isForeignUser(targetUserId)) {
      throw new ChannelForbiddenException(channelId, targetUserId, "add-cross-tenant");
    }
  }

  /**
   * 멤버 제거 — OWNER/ADMIN. OWNER 는 제거 불가. 내보낸 사람이 여전히 멤버 부서로 걸리면 개인 제외를 남긴다(WP-1058) — 맞추기가 다시 넣지 않게.
   */
  @Transactional
  public void remove(long callerId, long channelId, long targetUserId) {
    ensureExists(channelId);
    // 권한 먼저 — 비공개(DM 포함) 비멤버는 여기서 404 로 존재를 숨긴다(WP-511). DM 차단은 그 뒤.
    perms.requireManage(channelId, callerId, "remove-member");
    requireNotDm(callerId, channelId, "remove-member");
    // 대상 판정(OWNER·부서로 걸리는가) 전에 잠근다 — 동시에 더해지는 부서를 커밋 뒤에 보게(WP-1186).
    lockExisting(channelId);
    if (memberRepo.findRole(channelId, targetUserId).filter("OWNER"::equals).isPresent()) {
      throw new ChannelForbiddenException(channelId, callerId, "remove-owner");
    }
    if (memberRepo.remove(channelId, targetUserId) > 0) {
      excludeIfCovered(channelId, targetUserId);
    }
    rosterPublisher.publish(channelId);
    // 제거된 사용자는 커밋 후 명단에서 빠지므로 extra 로 알린다.
    changeNotifier.membershipChanged(channelId, callerId, List.of(targetUserId));
  }

  /**
   * 나가기 — 본인. OWNER 는 소유권 이전 전엔 나갈 수 없음. 나간 사람이 여전히 멤버 부서로 걸리면 개인 제외를 남긴다(WP-1058) — 부서 변화로 다시 끌려
   * 들어오지 않게.
   */
  @Transactional
  public void leave(long callerId, long channelId) {
    // 나갈 수 있는지(멤버인가·OWNER 인가)를 잠근 뒤에 판정한다 — 그사이 부서로 들어온 사람의 나가기가 「이미 비멤버」로 끝나지 않게(WP-1186).
    lockExisting(channelId);
    if (!checkLeave(callerId, channelId)) return; // 이미 비멤버 — idempotent
    memberRepo.remove(channelId, callerId);
    excludeIfCovered(channelId, callerId);
    rosterPublisher.publish(channelId);
    changeNotifier.membershipChanged(channelId, callerId, List.of(callerId));
  }

  /**
   * 나가기 사전검증(#860) — 확인 카드 dry-run 이 {@link #leave} 와 같은 {@link #checkLeave} 를 쓴다. 실행은 비멤버여도
   * 성공(idempotent)이지만 그런 카드는 아무 효과가 없으므로 사전검증에서만 사유와 함께 거절한다.
   */
  @Transactional(readOnly = true)
  public void validateLeavable(long callerId, long channelId) {
    if (!checkLeave(callerId, channelId)) {
      throw new IllegalArgumentException("이 채널의 멤버가 아닙니다: channelId=" + channelId);
    }
  }

  /** 나가기 술어 — 채널 존재·OWNER 아님. 호출자가 현재 멤버인지 돌려준다. */
  private boolean checkLeave(long callerId, long channelId) {
    ensureExists(channelId);
    String role = memberRepo.findRole(channelId, callerId).orElse(null);
    if ("OWNER".equals(role)) {
      throw new OwnershipTransferRequiredException(channelId);
    }
    return role != null;
  }

  /**
   * 역할 변경 — OWNER 만. role=OWNER 면 소유권 이전(대상 OWNER 승격 + 호출자 ADMIN 강등). 한 트랜잭션으로 OWNER 1명 불변식 유지.
   * ADMIN·OWNER 로 올린 사람은 직접 멤버로 고정된다(부서로 들어온 사람도 — WP-1058, {@link
   * ChannelMemberRepository#updateRole}).
   */
  @Transactional
  public void updateRole(long callerId, long channelId, long targetUserId, String role) {
    ensureExists(channelId);
    // 권한 먼저 — 비공개(DM 포함) 비멤버는 404 로 존재를 숨긴다(WP-511).
    perms.requireOwner(channelId, callerId, "update-role");
    requireNotDm(callerId, channelId, "update-role");
    // 부서로만 들어온 사람을 올리면 직접 멤버로 고정된다 — 부서 빼기·맞추기와 줄 세워 그 사이 행이 지워져 0행 갱신으로 끝나지 않게(WP-1186).
    lockExisting(channelId);
    String normalized = normalizeRole(role);
    if (memberRepo.findRole(channelId, targetUserId).isEmpty()) {
      throw new ChannelForbiddenException(channelId, callerId, "update-role-of-nonmember");
    }
    if ("OWNER".equals(normalized)) {
      // AGENT(AI 봇)는 채널 OWNER 가 될 수 없음(사람 전용 권한, #598) — 이슈 담당자 도메인과 동일 정책.
      if (UserKind.isAgent(memberRepo.findUserKind(targetUserId).orElse(null))) {
        throw new AgentCannotOwnChannelException(channelId, targetUserId);
      }
      // 정지된(또는 전역 비활성) 구성원에게는 넘기지 않는다(WP-1148) — 넘기면 채널을 관리할 사람이 없어진다(정지된 사람은 로그인·관리 불가,
      // 넘긴 사람은 ADMIN 으로 내려가 되돌리지도 못한다). 웹은 선택지에서 빼지만(WP-1131) 다른 클라이언트에도 API 로 막는다.
      if (isInactiveMember(targetUserId)) {
        throw new InactiveMemberException("비활성화된 구성원에게는 채널 소유권을 넘길 수 없습니다");
      }
      // 소유권 이전 — 호출자가 아니라 "현재 OWNER" 를 강등한다.
      // (시스템 ADMIN 이 비멤버로서 이전을 수행하면 호출자 강등은 0행이 되어 OWNER 가 2명이 되는 버그 방지.)
      memberRepo.demoteOwners(channelId);
      memberRepo.updateRole(channelId, targetUserId, "OWNER");
    } else {
      // 대상이 현재 OWNER 인데 비-OWNER 로 강등하려 하면 차단(소유권 공백 방지)
      if (memberRepo.findRole(channelId, targetUserId).filter("OWNER"::equals).isPresent()) {
        throw new ChannelForbiddenException(channelId, callerId, "demote-owner");
      }
      memberRepo.updateRole(channelId, targetUserId, normalized);
    }
    rosterPublisher.publish(channelId);
    changeNotifier.membershipChanged(channelId, callerId, Set.of());
  }

  /**
   * 이 워크스페이스 구성원이지만 정지(또는 전역 비활성)됐는가 — 초대(WP-723)·소유권 이전(WP-1148)이 같은 판정을 쓴다. 이 워크스페이스 멤버십이 없는 사람은
   * 여기서 false(다른 워크스페이스 사람은 따로 isForeignUser 로 거른다).
   */
  private boolean isInactiveMember(long userId) {
    var status = membershipGuard.membershipStatus(userId);
    return status.isPresent()
        && !WorkspaceActive.of(
            userRepo.findById(userId).map(u -> u.isActive()).orElse(false), status.get());
  }

  /** 멤버 부서로 걸리는 사람이면 개인 제외를 남긴다 — 내보내기·나가기 뒤 맞추기가 그 사람을 다시 넣지 않게(WP-1058). */
  private void excludeIfCovered(long channelId, long userId) {
    if (groupRepo.isCovered(channelId, userId)) {
      groupRepo.insertExclusion(channelId, userId);
    }
  }

  /**
   * 채널 행을 잠근다(없으면 404) — 멤버를 넣고 빼는 쓰기를 멤버 부서 추가·맞추기와 줄 세운다(WP-1186). 그래야 내보내기의 개인 제외 판정이 동시에 더해진
   * 부서를 커밋 뒤에 보고, 그 부서가 내보낸 사람을 다시 넣지 않는다.
   */
  private void lockExisting(long channelId) {
    if (channelRepo.lockState(channelId).isEmpty()) throw new ChannelNotFoundException(channelId);
  }

  private void ensureExists(long channelId) {
    if (!channelRepo.exists(channelId)) throw new ChannelNotFoundException(channelId);
  }

  // DM(kind=DM) 채널은 생성 시 고정된 참여자 구성 — 이후 멤버 추가/제거/역할변경을 서비스 레이어에서 하드 차단한다.
  // 시스템 ADMIN 오버라이드(ChannelPermissions.requireManage)도 예외 없이 막는다 — 무음 멤버 추가로 추가 이전
  // 전체 대화 이력이 새 참여자에게 노출되는 사고를 방지(#704). 그룹 DM 확장이 필요해지면 별도의 명시적·감사되는
  // 엔드포인트/플로우로 분리해야 한다(DmService.createOrGet 은 생성 시점에만 memberRepo.add 를 직접 호출하며 이
  // 가드 대상이 아니다).
  private void requireNotDm(long callerId, long channelId, String action) {
    if ("DM".equals(channelRepo.findKind(channelId))) {
      throw new ChannelForbiddenException(channelId, callerId, action + "-on-dm");
    }
  }

  private String normalizeRole(String role) {
    String r = role == null ? "" : role.trim().toUpperCase();
    if (!VALID_ROLES.contains(r)) {
      throw new IllegalArgumentException("올바르지 않은 채널 역할입니다 (role: " + role + ")");
    }
    return r;
  }
}
