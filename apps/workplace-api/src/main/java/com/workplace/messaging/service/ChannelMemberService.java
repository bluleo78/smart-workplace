package com.workplace.messaging.service;

import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.exception.OwnershipTransferRequiredException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
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
      // 소유권 이전: 대상을 OWNER로 승격하고 호출자를 ADMIN으로 강등
      memberRepo.updateRole(channelId, targetUserId, "OWNER");
      if (callerId != targetUserId) {
        memberRepo.updateRole(channelId, callerId, "ADMIN");
      }
    } else {
      // OWNER 를 다른 역할로 강등하는 것은 금지
      if (memberRepo.findRole(channelId, targetUserId).filter("OWNER"::equals).isPresent()) {
        throw new ChannelForbiddenException(channelId, callerId, "demote-owner");
      }
      memberRepo.updateRole(channelId, targetUserId, normalized);
    }
  }

  /** 채널 존재 여부 확인. */
  private void ensureExists(long channelId) {
    if (!channelRepo.exists(channelId)) throw new ChannelNotFoundException(channelId);
  }

  /** 역할 문자열 정규화 및 유효성 검증. */
  private String normalizeRole(String role) {
    String r = role == null ? "" : role.trim().toUpperCase();
    if (!VALID_ROLES.contains(r)) {
      throw new IllegalArgumentException("invalid role: " + role);
    }
    return r;
  }
}
