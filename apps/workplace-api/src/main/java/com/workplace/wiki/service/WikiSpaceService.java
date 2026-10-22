package com.workplace.wiki.service;

import com.workplace.global.tenant.MembershipGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.UnicodeNames;
import com.workplace.user.outbound.AgentDeleted;
import com.workplace.wiki.dto.WikiMemberResponse;
import com.workplace.wiki.dto.WikiSpaceResponse;
import com.workplace.wiki.exception.WikiForbiddenException;
import com.workplace.wiki.exception.WikiLastOwnerException;
import com.workplace.wiki.exception.WikiSpaceNameDuplicatedException;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import com.workplace.wiki.exception.WikiSpaceTypeNotEditableException;
import com.workplace.wiki.outbound.WikiChangeNotifier;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageAccessRevokedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiSpaceMembershipChangedEvent;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import com.workplace.wiki.repository.WikiSpaceRepository;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 위키 공간/멤버. 소유자는 생성 시 OWNER 멤버로 등록되어 권한이 멤버십으로 일원화된다. */
@Service
@RequiredArgsConstructor
public class WikiSpaceService {
  private final WikiSpaceRepository spaces;
  private final WikiSpaceMemberRepository members;
  // WP-580: 스페이스 삭제 때 페이지 잠금·첨부 회수.
  private final WikiPageRepository pages;
  private final WikiAttachmentService attachments;
  private final WikiPermissions perms;
  private final MembershipGuard membershipGuard;
  // WP-64: 멤버 변경 resource.changed 발행기.
  private final WikiChangeNotifier notifier;
  // WP-285: 멤버 변경을 커밋 후 동기화 서버에 알려 열린 편집 연결을 재판정하게 한다(WikiCollabRevalidator).
  private final ApplicationEventPublisher publisher;
  // WP-579: 편집 권한을 잃은 멤버가 만든 공유 해제, 스페이스 삭제 때 공유 감사.
  private final WikiShareLifecycle shareLifecycle;

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
   * 독립 팀 공간 생성. 생성자가 OWNER. 이름은 만드는 사람이 볼 수 있는(멤버인) TEAM 공간과 겹칠 수 없다(#696 의 "컨테이너류 이름은 식별자" 정책을
   * WP-693 에서 볼 수 있는 범위로 좁힘 — 채널 WP-590 처럼 볼 수 없는 공간 존재를 숨기려고).
   */
  @Transactional
  public WikiSpaceResponse createTeamSpace(long callerId, String rawName) {
    // 앞뒤 공백을 다듬고 NFC 로 맞춰 저장·중복 판정한다(WP-562) — 공백만 다른 이름이 목록에 같은 이름으로 두 번 보이지 않게.
    String name = UnicodeNames.toNfc(rawName.strip());
    // 같은 이름의 동시 생성과 차례를 세운 뒤 검사한다(WP-772 — 유니크 인덱스가 없어 검사만으로는 동시 요청이 모두 통과했다).
    spaces.lockTeamSpaceName(name);
    if (spaces.existsVisibleTeamSpaceName(name, callerId, null)) {
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
    // 추가는 이미 멤버면 역할을 덮어쓰는 업서트라, 마지막 OWNER 강등도 역할 변경과 같은 가드를 거친다(WP-557).
    if (!"OWNER".equals(role)) requireAnotherOwner(spaceId, userId);
    members.add(spaceId, userId, role);
    // 업서트라 기존 편집자를 보기로 내릴 수도 있다 — 역할 변경과 같은 공유 정리.
    revokeSharesIfLostEdit(spaceId, userId, role);
    notifier.spaceChanged(spaceId, callerId, Set.of());
    publishMembershipChanged(spaceId, userId);
  }

  @Transactional
  public void changeRole(long callerId, long spaceId, long userId, String role) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    perms.validateRole(role);
    // 멤버가 아니면 바꿀 행이 없다 — 0행 UPDATE 를 성공(204)으로 돌려주지 않고 거절한다(WP-667).
    if (members.findRole(spaceId, userId).isEmpty()) {
      throw new com.workplace.wiki.exception.WikiSpaceMemberNotFoundException();
    }
    if (!"OWNER".equals(role)) requireAnotherOwner(spaceId, userId);
    members.changeRole(spaceId, userId, role);
    revokeSharesIfLostEdit(spaceId, userId, role);
    notifier.spaceChanged(spaceId, callerId, Set.of());
    // 강등(EDITOR→VIEWER)이면 열린 연결을 읽기 전용으로 바꿔야 한다.
    publishMembershipChanged(spaceId, userId);
  }

  @Transactional
  public void removeMember(long callerId, long spaceId, long userId) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    removeTeamMember(callerId, spaceId, userId, true);
  }

  /**
   * AGENT 삭제(WP-579) — 사용자 행을 지우기 <b>전에</b> 같은 트랜잭션에서 동기로 돈다(user 모듈이 지우기 전에 발행). 그 에이전트가 만든 노트 공유를
   * 해제하고, 팀 스페이스 멤버십을 멤버 제거와 같은 경로({@link #removeTeamMember} — 마지막 OWNER 보호 WP-496, 변경 알림, 열린 연결
   * 재검증)로 지운다. 멤버 행을 FK CASCADE 로 지우면 그 보호와 알림을 건너뛴다.
   *
   * <p>순서: 멤버 행 잠금 → 공유 해제 → 멤버십 제거. 해제를 먼저 해야 공유 기록이 「에이전트가 삭제되어」로 남는다(멤버 제거가 먼저면 「편집 권한을 잃어」로
   * 남는다). 잠금은 멤버 제거 경로와 같은 순서(멤버 행 → 공유 행)라 동시에 그 에이전트를 내보내는 요청과 교착하지 않는다. 그 에이전트가 어느 팀 스페이스의 마지막
   * OWNER 면 그런 공간 이름을 모두 담은 {@link WikiLastOwnerException}(409, WP-785)이 공유 해제 전에 올라가 삭제 전체가 롤백된다.
   * 개인 스페이스는 건드리지 않는다 — 그 소유(wiki_space.owner_id)가 남아 삭제가 FK 에 막히면 관리자 삭제는 사용 중지로 대신한다(WP-705).
   */
  @EventListener
  public void onAgentDeleted(AgentDeleted e) {
    TenantContext.runAs(
        e.tenantId(),
        () -> {
          List<Long> teamSpaceIds = members.lockTeamSpaceIdsOf(e.userId());
          // 유일한 소유자인 공간을 먼저 모두 모아 한 번에 거부한다(WP-785) — 아래 멤버 제거가 첫 공간에서 막히면 관리자가 공간마다 다시 시도해야 했다.
          List<String> soleOwned =
              teamSpaceIds.stream()
                  .filter(spaceId -> isLastOwner(spaceId, e.userId()))
                  .map(this::spaceName)
                  .toList();
          if (!soleOwned.isEmpty()) {
            throw WikiLastOwnerException.ofAgent(soleOwned);
          }
          shareLifecycle.revokeAgentShares(e.userId());
          // 공유는 위에서 모든 스페이스 몫을 이미 해제했다 — 스페이스마다 같은 작성자 공유를 다시 찾지 않는다.
          teamSpaceIds.forEach(
              spaceId -> removeTeamMember(e.actorId(), spaceId, e.userId(), false));
        });
  }

  /**
   * 팀 스페이스에서 멤버 한 명을 뺀다 — 멤버 제거 API 와 AGENT 삭제가 함께 쓰는 본체. 호출자 권한·스페이스 종류(TEAM)는 부르는 쪽이 확인한다.
   *
   * @param actorId 변경 알림의 행위자(제거한 OWNER·에이전트를 지운 관리자)
   * @param revokeShares 내보내진 사람이 이 스페이스에 만든 공유를 해제할지 — 이미 해제한 호출(AGENT 삭제)은 false
   * @throws WikiLastOwnerException 대상이 마지막 OWNER(409, WP-496)
   */
  private void removeTeamMember(long actorId, long spaceId, long userId, boolean revokeShares) {
    requireAnotherOwner(spaceId, userId);
    members.remove(spaceId, userId);
    // WP-579: 내보내진 사람이 이 스페이스에 만든 공유를 해제한다.
    if (revokeShares) {
      shareLifecycle.onMemberLostEdit(spaceId, userId);
    }
    // 제거된 멤버는 커밋 후 명단에서 빠지므로 extra 로 넘겨 자기 화면에서도 스페이스가 사라지게 한다.
    notifier.spaceChanged(spaceId, actorId, List.of(userId));
    // 제거된 사용자가 열어 둔 편집 연결을 끊게 한다.
    publishMembershipChanged(spaceId, userId);
  }

  /**
   * 팀 스페이스 영구 삭제(WP-580). OWNER 전용이고 개인 스페이스는 거부한다 — 개인 스페이스는 목록을 열 때 다시 자동 생성되므로 지울 의미가 없다.
   *
   * <p>페이지는 휴지통 없이 하드 삭제다. 공간 행 하나를 지우면 페이지·멤버와 그 하위 행은 FK CASCADE 로 사라지지만, CASCADE 뒤에는 조회할 수 없는
   * 것들을 먼저 처리한다: 멤버 명단(실시간 알림 수신자), 페이지 id(열린 편집 연결 끊기), 첨부 파일 행·바이너리(매핑이 CASCADE 로 사라지면 회수할 길이 없다
   * — {@link WikiPageService#delete} 와 같은 순서). 공용 AI 메모리는 삭제 알림을 받은 SharedAiMemorySpaceCleanup 이 같은
   * 트랜잭션에서 지운다.
   */
  @Transactional
  public void deleteTeamSpace(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    // 공간 행 → 페이지 행 순으로 잠가 동시 페이지 생성·첨부 업로드가 아래 목록에서 빠지지 않게 한다(각 잠금 주석 참조).
    spaces.lockForDelete(spaceId);
    // WP-579: 함께 사라질 공유마다 감사(reason PAGE_DELETED) — 페이지 행을 잠그기 전에(교착 회피, 메서드 주석 참조).
    shareLifecycle.beforeSpaceDeleted(spaceId);
    List<Long> pageIds = pages.lockPageIdsOfSpace(spaceId);
    List<Long> memberIds = members.memberUserIds(spaceId);
    attachments.reclaimSpace(spaceId);
    spaces.delete(spaceId);
    notifier.spaceDeleted(spaceId, callerId, memberIds);
    if (!pageIds.isEmpty()) {
      // 테넌트는 지금 담는다 — 재검증 리스너는 커밋 후 별도 스레드에서 돈다. 사유는 "삭제"(4404)라 웹이 삭제됨으로 안내한다.
      publisher.publishEvent(
          new WikiPageAccessRevokedEvent(TenantContext.require(), spaceId, pageIds, Instant.now()));
    }
  }

  /**
   * WP-579: 바뀐 역할이 편집 권한 아래(보기)면 그 사람이 이 스페이스에 만든 공유를 해제한다(설계 「공유한 사람이 떠날 때」). 원래 보기였거나 공유가 없으면 지울
   * 것이 없어 아무것도 하지 않는다.
   */
  private void revokeSharesIfLostEdit(long spaceId, long userId, String role) {
    if (!WikiPermissions.atLeast(role, "EDITOR")) {
      shareLifecycle.onMemberLostEdit(spaceId, userId);
    }
  }

  /**
   * 대상이 OWNER 이고 마지막 OWNER 면 제거·강등을 거부한다(WP-496) — 빠지면 멤버 관리·편집을 할 사람이 없는 공간이 남고, 공간 이름도 묶인다. 대상이
   * OWNER 가 아니면(또는 다른 OWNER 가 있으면) 그대로 진행한다.
   */
  private void requireAnotherOwner(long spaceId, long userId) {
    if (isLastOwner(spaceId, userId)) {
      throw WikiLastOwnerException.ofSpace(spaceName(spaceId));
    }
  }

  /**
   * 대상이 이 공간의 OWNER 이고 다른 OWNER 가 없는지. 소유자 행을 잠근 뒤 그 집합으로 판정한다(WP-788) — 두 소유자가 서로를 동시에 강등·제거해도 나중
   * 요청은 앞 요청의 커밋을 기다렸다 판정해 소유자 0명이 되지 않는다.
   */
  private boolean isLastOwner(long spaceId, long userId) {
    List<Long> owners = members.lockOwnerIds(spaceId);
    return owners.contains(userId) && owners.size() <= 1;
  }

  /** 마지막 OWNER 오류 문구용 공간 이름 — 멤버 행이 남아 있는 공간이라 FK 로 행이 있다. */
  private String spaceName(long spaceId) {
    return spaces.findName(spaceId).orElseThrow(() -> new WikiSpaceNotFoundException(spaceId));
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
