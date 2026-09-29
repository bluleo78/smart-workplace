package com.workplace.messaging.service;

import com.workplace.global.tenant.MembershipGuard;
import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.exception.AgentCannotOwnChannelException;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.exception.OwnershipTransferRequiredException;
import com.workplace.messaging.outbound.ChannelChangeNotifier;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelMembershipChangedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.user.dto.UserKind;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 채널 멤버 관리 — 목록/초대/제거/나가기/역할변경(소유권 이전). */
@Service
@RequiredArgsConstructor
public class ChannelMemberService {

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final ChannelPermissions perms;
  private final MembershipGuard membershipGuard;
  private final ApplicationEventPublisher publisher;
  private final ChannelChangeNotifier changeNotifier;

  private static final List<String> VALID_ROLES = List.of("OWNER", "ADMIN", "MEMBER");

  /** 멤버 목록 — 멤버만(비공개 비멤버 404 은닉). RLS GUC 주입 위해 @Transactional 필요(없으면 빈 결과). */
  @Transactional(readOnly = true)
  public List<ChannelMemberResponse> listMembers(long callerId, long channelId) {
    ensureExists(channelId);
    perms.requireMember(channelId, callerId);
    return memberRepo.listMembers(channelId);
  }

  /** 멤버 추가 — OWNER/ADMIN 또는 시스템 ADMIN. MEMBER 역할로 add(idempotent). */
  @Transactional
  public void add(long callerId, long channelId, long targetUserId) {
    checkAdd(callerId, channelId, targetUserId);
    memberRepo.add(channelId, targetUserId, "MEMBER");
    publishRoster(channelId);
    changeNotifier.membershipChanged(channelId, callerId, List.of(targetUserId));
  }

  /**
   * 멤버 추가 사전검증(#856) — 확인 카드 dry-run 이 {@link #add} 와 같은 {@link #checkAdd} 를 쓴다. 실행은 이미 멤버여도
   * 성공(idempotent)이지만 그런 카드는 아무 효과가 없으므로 사전검증에서만 사유와 함께 거절한다.
   */
  @Transactional(readOnly = true)
  public void validateAdd(long callerId, long channelId, long targetUserId) {
    checkAdd(callerId, channelId, targetUserId);
    if (memberRepo.findRole(channelId, targetUserId).isPresent()) {
      throw new IllegalArgumentException("이미 채널 멤버입니다: userId=" + targetUserId);
    }
  }

  /** 멤버 추가 술어 — 채널 존재·DM 아님·관리 권한·대상이 현재 테넌트 구성원. */
  private void checkAdd(long callerId, long channelId, long targetUserId) {
    ensureExists(channelId);
    requireNotDm(callerId, channelId, "add-member");
    perms.requireManage(channelId, callerId, "add-member");
    // 추가 대상 사용자가 현재 테넌트의 활성 멤버인지 확인 — 테넌트 경계를 넘는 채널 멤버십 차단(설계 §4).
    // project/wiki/drive 공간 addMember 와 공용 헬퍼(MembershipGuard)로 정책 통일 (#713).
    if (membershipGuard.isForeignUser(targetUserId)) {
      throw new ChannelForbiddenException(channelId, targetUserId, "add-cross-tenant");
    }
  }

  /** 멤버 제거 — OWNER/ADMIN. OWNER 는 제거 불가. */
  @Transactional
  public void remove(long callerId, long channelId, long targetUserId) {
    ensureExists(channelId);
    requireNotDm(callerId, channelId, "remove-member");
    perms.requireManage(channelId, callerId, "remove-member");
    if (memberRepo.findRole(channelId, targetUserId).filter("OWNER"::equals).isPresent()) {
      throw new ChannelForbiddenException(channelId, callerId, "remove-owner");
    }
    memberRepo.remove(channelId, targetUserId);
    publishRoster(channelId);
    // 제거된 사용자는 커밋 후 명단에서 빠지므로 extra 로 알린다.
    changeNotifier.membershipChanged(channelId, callerId, List.of(targetUserId));
  }

  /** 나가기 — 본인. OWNER 는 소유권 이전 전엔 나갈 수 없음. */
  @Transactional
  public void leave(long callerId, long channelId) {
    if (!checkLeave(callerId, channelId)) return; // 이미 비멤버 — idempotent
    memberRepo.remove(channelId, callerId);
    publishRoster(channelId);
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

  /** 역할 변경 — OWNER 만. role=OWNER 면 소유권 이전(대상 OWNER 승격 + 호출자 ADMIN 강등). 한 트랜잭션으로 OWNER 1명 불변식 유지. */
  @Transactional
  public void updateRole(long callerId, long channelId, long targetUserId, String role) {
    ensureExists(channelId);
    requireNotDm(callerId, channelId, "update-role");
    String normalized = normalizeRole(role);
    perms.requireOwner(channelId, callerId, "update-role");
    if (memberRepo.findRole(channelId, targetUserId).isEmpty()) {
      throw new ChannelForbiddenException(channelId, callerId, "update-role-of-nonmember");
    }
    if ("OWNER".equals(normalized)) {
      // AGENT(AI 봇)는 채널 OWNER 가 될 수 없음(사람 전용 권한, #598) — 이슈 담당자 도메인과 동일 정책.
      if (UserKind.isAgent(memberRepo.findUserKind(targetUserId).orElse(null))) {
        throw new AgentCannotOwnChannelException(channelId, targetUserId);
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
    publishRoster(channelId);
    changeNotifier.membershipChanged(channelId, callerId, Set.of());
  }

  /** 변경 후 현재 roster 로 멤버십 변경 이벤트 발행 — 드라이브 연동 공간 reconcile 소스. */
  private void publishRoster(long channelId) {
    String name = channelRepo.findName(channelId).orElse("");
    List<ChannelMembershipChangedEvent.Member> roster =
        memberRepo.listMembers(channelId).stream()
            .map(m -> new ChannelMembershipChangedEvent.Member(m.userId(), m.role()))
            .toList();
    publisher.publishEvent(
        new ChannelMembershipChangedEvent(channelId, name, roster, Instant.now()));
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
