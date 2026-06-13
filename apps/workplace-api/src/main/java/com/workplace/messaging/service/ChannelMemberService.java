package com.workplace.messaging.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.exception.OwnershipTransferRequiredException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.tenant.repository.MembershipRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 채널 멤버 관리 — 목록/초대/제거/나가기/역할변경(소유권 이전). */
@Service
@RequiredArgsConstructor
public class ChannelMemberService {

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final ChannelPermissions perms;
  private final MembershipRepository membershipRepo;

  private static final List<String> VALID_ROLES = List.of("OWNER", "ADMIN", "MEMBER");

  /** 멤버 목록 — 멤버만(비공개 비멤버 404 은닉). */
  public List<ChannelMemberResponse> listMembers(long callerId, long channelId) {
    ensureExists(channelId);
    perms.requireMember(channelId, callerId);
    return memberRepo.listMembers(channelId);
  }

  /** 멤버 추가 — OWNER/ADMIN 또는 시스템 ADMIN. MEMBER 역할로 add(idempotent). */
  @Transactional
  public void add(long callerId, long channelId, long targetUserId) {
    ensureExists(channelId);
    perms.requireManage(channelId, callerId, "add-member");
    // 추가 대상 사용자가 현재 테넌트의 활성 멤버인지 확인 — 테넌트 경계를 넘는 채널 멤버십 차단(설계 §4).
    Long tenantId = TenantContext.get();
    if (tenantId == null || !membershipRepo.hasActiveMembership(targetUserId, tenantId)) {
      throw new ChannelForbiddenException(channelId, targetUserId, "add-cross-tenant");
    }
    memberRepo.add(channelId, targetUserId, "MEMBER");
  }

  /** 멤버 제거 — OWNER/ADMIN. OWNER 는 제거 불가. */
  @Transactional
  public void remove(long callerId, long channelId, long targetUserId) {
    ensureExists(channelId);
    perms.requireManage(channelId, callerId, "remove-member");
    if (memberRepo.findRole(channelId, targetUserId).filter("OWNER"::equals).isPresent()) {
      throw new ChannelForbiddenException(channelId, callerId, "remove-owner");
    }
    memberRepo.remove(channelId, targetUserId);
  }

  /** 나가기 — 본인. OWNER 는 소유권 이전 전엔 나갈 수 없음. */
  @Transactional
  public void leave(long callerId, long channelId) {
    ensureExists(channelId);
    String role = memberRepo.findRole(channelId, callerId).orElse(null);
    if (role == null) return; // 이미 비멤버 — idempotent
    if ("OWNER".equals(role)) {
      throw new OwnershipTransferRequiredException(channelId);
    }
    memberRepo.remove(channelId, callerId);
  }

  /** 역할 변경 — OWNER 만. role=OWNER 면 소유권 이전(대상 OWNER 승격 + 호출자 ADMIN 강등). 한 트랜잭션으로 OWNER 1명 불변식 유지. */
  @Transactional
  public void updateRole(long callerId, long channelId, long targetUserId, String role) {
    ensureExists(channelId);
    String normalized = normalizeRole(role);
    perms.requireOwner(channelId, callerId, "update-role");
    if (memberRepo.findRole(channelId, targetUserId).isEmpty()) {
      throw new ChannelForbiddenException(channelId, callerId, "update-role-of-nonmember");
    }
    if ("OWNER".equals(normalized)) {
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
  }

  private void ensureExists(long channelId) {
    if (!channelRepo.exists(channelId)) throw new ChannelNotFoundException(channelId);
  }

  private String normalizeRole(String role) {
    String r = role == null ? "" : role.trim().toUpperCase();
    if (!VALID_ROLES.contains(r)) {
      throw new IllegalArgumentException("invalid role: " + role);
    }
    return r;
  }
}
