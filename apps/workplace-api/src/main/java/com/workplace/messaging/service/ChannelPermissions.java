package com.workplace.messaging.service;

import com.workplace.global.security.PermissionChecker;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 채널 권한 판정 일원화. 채널 역할(OWNER/ADMIN/MEMBER) + 시스템 ADMIN 오버라이드.
 *
 * <p>비공개 채널 비멤버는 존재 은닉을 위해 404(ChannelNotFoundException)로 처리한다.
 */
@Component
@RequiredArgsConstructor
public class ChannelPermissions {

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final PermissionChecker permissionChecker;

  /** 시스템 ADMIN 여부. */
  public boolean isSystemAdmin(long userId) {
    return permissionChecker.userHasRole(userId, "ADMIN");
  }

  /**
   * 멤버 접근 보장. 멤버면 통과. 비멤버면 존재 은닉을 위해 404 로 차단한다.
   *
   * <p>사용처는 비공개 채널 상세/멤버목록 등 "멤버 전용" 동작이다(공개 채널 메시지 비멤버 차단은 MessageService.ensureMember 가 403 으로
   * 담당하므로 책임이 겹치지 않는다).
   */
  public void requireMember(long channelId, long userId) {
    if (memberRepo.isMember(channelId, userId)) return;
    throw new ChannelNotFoundException(channelId);
  }

  /** 관리 권한(OWNER/ADMIN 또는 시스템 ADMIN) 보장. */
  public void requireManage(long channelId, long userId, String action) {
    if (isSystemAdmin(userId)) return;
    String role = memberRepo.findRole(channelId, userId).orElse(null);
    if ("OWNER".equals(role) || "ADMIN".equals(role)) return;
    throw new ChannelForbiddenException(channelId, userId, action);
  }

  /** 소유자 권한(OWNER 또는 시스템 ADMIN) 보장. */
  public void requireOwner(long channelId, long userId, String action) {
    if (isSystemAdmin(userId)) return;
    if (memberRepo.findRole(channelId, userId).filter("OWNER"::equals).isPresent()) return;
    throw new ChannelForbiddenException(channelId, userId, action);
  }

  /** 시스템 ADMIN 보장. */
  public void requireSystemAdmin(long userId, String action) {
    if (!isSystemAdmin(userId)) throw new ChannelForbiddenException(0L, userId, action);
  }

  /** caller 의 역할 조회(없으면 empty). */
  public Optional<String> roleOf(long channelId, long userId) {
    return memberRepo.findRole(channelId, userId);
  }
}
