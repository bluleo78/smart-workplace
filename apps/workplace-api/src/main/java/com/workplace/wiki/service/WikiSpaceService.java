package com.workplace.wiki.service;

import com.workplace.global.tenant.MembershipGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.wiki.dto.WikiMemberResponse;
import com.workplace.wiki.dto.WikiSpaceResponse;
import com.workplace.wiki.exception.WikiForbiddenException;
import com.workplace.wiki.exception.WikiSpaceNameDuplicatedException;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import com.workplace.wiki.exception.WikiSpaceTypeNotEditableException;
import com.workplace.wiki.outbound.WikiChangeNotifier;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiSpaceMembershipChangedEvent;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import com.workplace.wiki.repository.WikiSpaceRepository;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 위키 공간/멤버. 소유자는 생성 시 OWNER 멤버로 등록되어 권한이 멤버십으로 일원화된다. */
@Service
@RequiredArgsConstructor
public class WikiSpaceService {
  private final WikiSpaceRepository spaces;
  private final WikiSpaceMemberRepository members;
  private final WikiPermissions perms;
  private final MembershipGuard membershipGuard;
  // WP-64: 멤버 변경 resource.changed 발행기.
  private final WikiChangeNotifier notifier;
  // WP-285: 멤버 변경을 커밋 후 동기화 서버에 알려 열린 편집 연결을 재판정하게 한다(WikiCollabRevalidator).
  private final ApplicationEventPublisher publisher;

  /** 개인 공간 보장(없으면 생성). 멱등. */
  @Transactional
  public WikiSpaceResponse ensurePersonalSpace(long userId) {
    long spaceId =
        spaces
            .findPersonalSpaceId(userId)
            .orElseGet(
                () -> {
                  long id = spaces.insert("PERSONAL", "내 노트", userId);
                  members.add(id, userId, "OWNER");
                  return id;
                });
    return spaces
        .findForUser(spaceId, userId)
        .orElseThrow(() -> new WikiSpaceNotFoundException(spaceId));
  }

  /**
   * 독립 팀 공간 생성. 생성자가 OWNER. 동일 테넌트 내 이름 중복은 하드 차단(#696 — 채팅 채널 #688/드라이브 공간/연락처 조직 그룹과 동일한 "컨테이너류
   * 이름은 식별자" 정책).
   */
  @Transactional
  public WikiSpaceResponse createTeamSpace(long callerId, String name) {
    if (spaces.existsTeamSpaceName(name, null)) {
      throw new WikiSpaceNameDuplicatedException(name);
    }
    long id = spaces.insert("TEAM", name, callerId);
    members.add(id, callerId, "OWNER");
    return spaces.findForUser(id, callerId).orElseThrow(() -> new WikiSpaceNotFoundException(id));
  }

  /** 내 공간 목록(개인 자동생성 보장 + 멤버 팀). */
  @Transactional
  public List<WikiSpaceResponse> listMySpaces(long userId) {
    ensurePersonalSpace(userId);
    return spaces.findMySpaces(userId);
  }

  @Transactional(readOnly = true)
  public WikiSpaceResponse getSpace(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    return spaces
        .findForUser(spaceId, callerId)
        .orElseThrow(() -> new WikiSpaceNotFoundException(spaceId));
  }

  @Transactional(readOnly = true)
  public List<WikiMemberResponse> listMembers(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    return members.listMembers(spaceId);
  }

  /**
   * 멤버 추가. OWNER 권한 필요. 대상이 현재 테넌트의 활성 멤버가 아니면 거부한다 — 테넌트 경계를 넘는 위키 공간 멤버십 등록 차단 (messaging
   * ChannelMemberService.add() 와 동일 정책, #713).
   */
  @Transactional
  public void addMember(long callerId, long spaceId, long userId, String role) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    perms.validateRole(role);
    if (membershipGuard.isForeignUser(userId)) {
      throw new WikiForbiddenException(spaceId, userId);
    }
    members.add(spaceId, userId, role);
    notifier.spaceChanged(spaceId, callerId, Set.of());
    publishMembershipChanged(spaceId, userId);
  }

  @Transactional
  public void changeRole(long callerId, long spaceId, long userId, String role) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    perms.validateRole(role);
    if (!"OWNER".equals(role)) requireAnotherOwner(spaceId, userId);
    members.changeRole(spaceId, userId, role);
    notifier.spaceChanged(spaceId, callerId, Set.of());
    // 강등(EDITOR→VIEWER)이면 열린 연결을 읽기 전용으로 바꿔야 한다.
    publishMembershipChanged(spaceId, userId);
  }

  @Transactional
  public void removeMember(long callerId, long spaceId, long userId) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    requireAnotherOwner(spaceId, userId);
    members.remove(spaceId, userId);
    // 제거된 멤버는 커밋 후 명단에서 빠지므로 extra 로 넘겨 자기 화면에서도 스페이스가 사라지게 한다.
    notifier.spaceChanged(spaceId, callerId, List.of(userId));
    // 제거된 사용자가 열어 둔 편집 연결을 끊게 한다.
    publishMembershipChanged(spaceId, userId);
  }

  /**
   * 대상이 OWNER 이고 마지막 OWNER 면 제거·강등을 거부한다(WP-496) — 빠지면 멤버 관리·편집을 할 사람이 없는 공간이 남고, 공간 이름도 묶인다. 대상이
   * OWNER 가 아니면(또는 다른 OWNER 가 있으면) 그대로 진행한다.
   */
  private void requireAnotherOwner(long spaceId, long userId) {
    boolean targetIsOwner = members.findRole(spaceId, userId).map("OWNER"::equals).orElse(false);
    if (targetIsOwner && members.countOwners(spaceId) <= 1) {
      throw new com.workplace.wiki.exception.WikiLastOwnerException(spaceId);
    }
  }

  /**
   * TEAM 공간이 아니면 멤버 변경을 거부한다(WP-495) — 개인 공간 멤버를 바꾸면 남에게 넘기거나 소유자가 빠져 공간 목록이 영구히 열리지 않는다. 드라이브 공간의
   * 같은 가드(DriveSpaceService.requireTeamSpace)와 같은 규칙.
   */
  private void requireTeamSpace(long spaceId) {
    String type =
        spaces.findType(spaceId).orElseThrow(() -> new WikiSpaceNotFoundException(spaceId));
    if (!"TEAM".equals(type)) {
      throw new WikiSpaceTypeNotEditableException(spaceId, type);
    }
  }

  /** 동기화 서버 연결 재검증 이벤트 발행. 테넌트는 지금(요청 스레드) 담는다 — 리스너는 커밋 후 별도 스레드에서 돌아 TenantContext 를 볼 수 없다. */
  private void publishMembershipChanged(long spaceId, long userId) {
    publisher.publishEvent(
        new WikiSpaceMembershipChangedEvent(
            TenantContext.require(), spaceId, userId, Instant.now()));
  }
}
