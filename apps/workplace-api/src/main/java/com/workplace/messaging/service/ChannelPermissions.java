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
   * 멤버 접근 보장. 멤버면 통과. 비멤버일 때: 공개 채널은 호출처가 별도 처리하도록 false 반환이 아니라, 여기서는 "멤버여야 하는 동작" 전용이므로 비공개·공개 모두
   * 비멤버면 차단한다. 단 존재 은닉을 위해 비공개·비멤버는 404, 공개·비멤버는 403(ChannelNotMember 는 호출처에서 사용) — 여기선 비공개 404 처리.
   */
  public void requireMember(long channelId, long userId) {
    if (memberRepo.isMember(channelId, userId)) return;
    // 비멤버 — 비공개면 존재 은닉(404), 공개면 채널 없음과 구분되도록 동일하게 404 로 은닉하지 않고
    // 채널이 존재하면 ChannelNotFound 가 아닌 NotMember 의미가 필요하나, requireMember 사용처는
    // 비공개 상세/메시지뿐이므로 404 로 은닉한다.
    throw new ChannelNotFoundException(channelId);
  }

  /**
   * 채널 내용(메시지·스레드·첨부·반응자·멤버 목록)을 읽을 수 있는지 — 멤버, 또는 보관된 공개 채널이면 워크스페이스 구성원 누구나(WP-621). 보관된 공개 채널은
   * 원래 누구나 들어와 읽던 대화의 기록이라, 나간 사람·처음 보는 사람도 읽기 전용으로 본다(쓰기는 각 쓰기 경로의 보관 검사가 막는다). 비공개 채널·DM 은 보관돼도
   * 멤버만.
   */
  public boolean canRead(long channelId, long userId) {
    return memberRepo.isMember(channelId, userId) || channelRepo.isArchivedPublicChannel(channelId);
  }

  /** 관리 권한(OWNER/ADMIN 또는 시스템 ADMIN) 보장. */
  public void requireManage(long channelId, long userId, String action) {
    if (isSystemAdmin(userId)) return;
    String role = memberRepo.findRole(channelId, userId).orElse(null);
    if ("OWNER".equals(role) || "ADMIN".equals(role)) return;
    throw denied(channelId, userId, role, action);
  }

  /** 소유자 권한(OWNER 또는 시스템 ADMIN) 보장. */
  public void requireOwner(long channelId, long userId, String action) {
    if (isSystemAdmin(userId)) return;
    String role = memberRepo.findRole(channelId, userId).orElse(null);
    if ("OWNER".equals(role)) return;
    throw denied(channelId, userId, role, action);
  }

  /**
   * 권한 부족 예외. 비공개 채널(DM 포함)의 비멤버에게는 없는 채널과 같은 404 를 돌려 존재를 숨긴다(WP-511 — 403/404 차이로 비공개 채널 id 를 알아낼
   * 수 있었다). 멤버이거나 공개 채널이면 403.
   */
  private RuntimeException denied(long channelId, long userId, String role, String action) {
    if (isHiddenFrom(channelId, role)) {
      return new ChannelNotFoundException(channelId);
    }
    return new ChannelForbiddenException(channelId, userId, action);
  }

  /**
   * 이 역할(null = 비멤버)의 호출자에게 채널 존재를 숨겨야 하는지 — 비멤버 + 공개 채널 아님(비공개·DM). {@link #denied} 와 나가기가 같은 판정을
   * 쓰도록 한 곳에 모았다(WP-1402).
   */
  private boolean isHiddenFrom(long channelId, String role) {
    return role == null && !"PUBLIC".equals(channelRepo.findVisibility(channelId));
  }

  /**
   * 비공개 채널(DM 포함)의 비멤버면 없는 채널과 같은 404 를 던진다. 던지지 않으면 호출자는 멤버이거나 공개 채널 비멤버이거나 시스템 ADMIN 이다. 나가기가 비공개
   * 채널 비멤버에게 멱등 204 를 돌려 채널 id 존재가 드러나던 것을 막는다(WP-1402). 시스템 ADMIN 은 {@link #requireManage} 등 다른
   * 경로에서도 비공개 채널을 볼 수 있으므로 숨기지 않는다 — 가려질 때만 ADMIN 여부를 물어 평소 경로에 쿼리를 더하지 않는다.
   */
  public void hideIfInvisibleNonMember(long channelId, long userId, String role) {
    if (isHiddenFrom(channelId, role) && !isSystemAdmin(userId)) {
      throw new ChannelNotFoundException(channelId);
    }
  }

  /**
   * 시스템 ADMIN 보장. 거절은 다른 권한 검사와 같은 {@link #denied} 규칙을 따른다(WP-1419) — 비공개 채널 비멤버에게는 없는 채널과 같은 404,
   * 그 밖은 403. 그래서 채널 id 를 받는다.
   */
  public void requireSystemAdmin(long channelId, long userId, String action) {
    if (isSystemAdmin(userId)) return;
    throw denied(channelId, userId, memberRepo.findRole(channelId, userId).orElse(null), action);
  }

  /** caller 의 역할 조회(없으면 empty). */
  public Optional<String> roleOf(long channelId, long userId) {
    return memberRepo.findRole(channelId, userId);
  }
}
