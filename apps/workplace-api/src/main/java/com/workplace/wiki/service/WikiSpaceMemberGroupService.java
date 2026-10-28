package com.workplace.wiki.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.user.outbound.DepartmentMembersReduced;
import com.workplace.wiki.dto.WikiMemberGroupResponse;
import com.workplace.wiki.exception.WikiSpaceMemberNotFoundException;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import com.workplace.wiki.exception.WikiSpaceTypeNotEditableException;
import com.workplace.wiki.outbound.WikiChangeNotifier;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiSpaceAudienceChangedEvent;
import com.workplace.wiki.repository.WikiSpaceMemberGroupRepository;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import com.workplace.wiki.repository.WikiSpaceRepository;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 노트 스페이스 멤버로 둔 조직도 부서(WP-1052) — 부서 자체를 역할과 함께 스페이스 멤버로 둔다. 그 부서와 하위 부서의 활성 사람 구성원이 그 역할을 받고, 소속은
 * 판정할 때마다 다시 본다(공용 {@code WikiSpaceMembership}). 사람의 실효 역할은 직접 멤버 역할과 부서 역할 중 가장 높은 것이다.
 *
 * <p>규칙: 팀 스페이스에만, 조직도 부서(SHARED)만, 역할은 EDITOR·VIEWER 만(멤버 관리 권한 OWNER 를 부서 전체에 주지 않는다 — 마지막 소유자
 * 보호도 직접 멤버 행만 본다). 권한은 사람 멤버 API 와 같다(조회는 멤버, 변경은 OWNER).
 *
 * <p>부서로 들어오는 사람이 바뀌면(부서 행 추가·역할 변경·제거, 부서 구성원 감소) 사람 단위가 아니라 스페이스 단위로 알린다 — 변경 알림(멤버 창·목록 새로고침,
 * 빠졌을 수 있는 사람에게도), 커밋 직전 편집 권한을 잃은 사람이 만든 공유 해제, 커밋 뒤 동기화 서버의 스페이스 연결 재검증.
 */
@Service
@RequiredArgsConstructor
public class WikiSpaceMemberGroupService {
  /** 부서 행이 가질 수 있는 역할 — OWNER 는 받지 않는다. */
  private static final Set<String> GROUP_ROLES = Set.of("EDITOR", "VIEWER");

  private final WikiSpaceRepository spaces;
  private final WikiSpaceMemberRepository members;
  private final WikiSpaceMemberGroupRepository groups;
  private final WikiPermissions perms;
  private final WikiChangeNotifier notifier;
  private final ApplicationEventPublisher publisher;
  private final WikiShareLifecycle shareLifecycle;

  /** 스페이스 멤버 부서 목록(이름순, 부서마다 들어오는 사람 수) — 사람 멤버 목록과 같이 멤버면 볼 수 있다. */
  @Transactional(readOnly = true)
  public List<WikiMemberGroupResponse> list(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    return groups.list(spaceId);
  }

  /**
   * 조직도 부서를 멤버로 더한다(OWNER). 이미 멤버인 부서면 역할을 덮어쓴다 — 사람 멤버 추가와 같은 업서트 관례.
   *
   * @throws IllegalArgumentException 조직도 부서가 아닌 그룹(개인 그룹·없는 그룹·다른 워크스페이스), OWNER 역할(400)
   */
  @Transactional
  public WikiMemberGroupResponse add(long callerId, long spaceId, long groupId, String role) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    validateGroupRole(role);
    // 노트 공유의 부서 지정과 같은 검증·문구 — 개인 그룹은 조건으로, 다른 워크스페이스 그룹은 RLS 로 빠진다.
    if (groups.findDepartmentName(groupId).isEmpty()) {
      throw new IllegalArgumentException("조직도 부서만 지정할 수 있습니다");
    }
    // 업서트라 역할을 내릴 수도 있다 — 내려가도 스페이스에서 빠지는 사람은 없어 추가 수신자는 없다.
    groups.upsert(spaceId, groupId, role, callerId);
    audienceChanged(callerId, spaceId, Set.of());
    return groups.find(spaceId, groupId).orElseThrow(WikiSpaceMemberNotFoundException::new);
  }

  /**
   * 멤버 부서의 역할을 바꾼다(OWNER).
   *
   * @throws WikiSpaceMemberNotFoundException 이 스페이스의 멤버 부서가 아님(404 — 사람 멤버 역할 변경과 같은 응답)
   */
  @Transactional
  public WikiMemberGroupResponse changeRole(
      long callerId, long spaceId, long groupId, String role) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    validateGroupRole(role);
    if (groups.findRole(spaceId, groupId).isEmpty()) {
      throw new WikiSpaceMemberNotFoundException();
    }
    groups.changeRole(spaceId, groupId, role);
    audienceChanged(callerId, spaceId, Set.of());
    return groups.find(spaceId, groupId).orElseThrow(WikiSpaceMemberNotFoundException::new);
  }

  /**
   * 멤버 부서를 뺀다(OWNER). 빠지기 전 실효 멤버 전원을 변경 알림의 추가 수신자로 넘긴다 — 부서로만 들어와 있던 사람은 커밋 뒤 멤버 조회에서 빠지므로 자기
   * 화면에서도 스페이스가 사라지게.
   *
   * @throws WikiSpaceMemberNotFoundException 이 스페이스의 멤버 부서가 아님(404)
   */
  @Transactional
  public void remove(long callerId, long spaceId, long groupId) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    if (groups.findRole(spaceId, groupId).isEmpty()) {
      throw new WikiSpaceMemberNotFoundException();
    }
    List<Long> before = members.memberUserIds(spaceId);
    groups.remove(spaceId, groupId);
    audienceChanged(callerId, spaceId, before);
  }

  /**
   * 조직도 부서의 구성원이 줄었거나 부서가 사라졌다(WP-1042 이벤트) — 그 부서(이벤트에 상위 부서도 담겨 온다)를 멤버로 둔 스페이스마다 같은 스페이스 단위 신호를
   * 낸다. 동기 리스너라 변경 <b>전</b>에 돈다: 부서를 지우면 멤버 부서 행이 CASCADE 로 사라지므로 영향받는 스페이스와 지금 멤버 명단(빠질 사람에게도 알림이
   * 가게)을 여기서 모은다. 공유 정리는 변경이 반영된 뒤(커밋 직전), 연결 재검증은 커밋 뒤에 돈다.
   */
  @EventListener
  public void onDepartmentMembersReduced(DepartmentMembersReduced e) {
    List<Long> spaceIds = groups.findSpaceIdsByGroups(e.groupIds());
    if (spaceIds.isEmpty()) {
      return;
    }
    // 행위자는 없다 — 부서 변경은 user 모듈에서 왔다.
    spaceIds.forEach(id -> notifier.spaceChanged(id, null, members.memberUserIds(id)));
    publisher.publishEvent(new WikiSpaceAudienceChangedEvent(e.tenantId(), spaceIds));
  }

  /**
   * 부서로 들어오는 사람이 바뀐 스페이스 — 커밋 직전(같은 트랜잭션, 변경이 반영된 뒤) 실효 역할이 편집 아래가 된 사람이 만든 공유를 해제한다(WP-579 「공유한
   * 사람이 떠날 때」를 부서 경로에도). 변경과 해제가 함께 커밋되거나 함께 롤백된다. 테넌트는 이벤트에 담긴 값으로 세운다.
   */
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onSpaceAudienceChanged(WikiSpaceAudienceChangedEvent e) {
    TenantContext.runAs(
        e.tenantId(),
        () -> e.spaceIds().forEach(shareLifecycle::revokeSharesOfCreatorsWithoutEdit));
  }

  /** 부서 행 변경 뒤 공통 신호 — 변경 알림(SSE)과 스페이스 단위 이벤트(공유 정리·연결 재검증). */
  private void audienceChanged(long actorId, long spaceId, Collection<Long> extraRecipients) {
    notifier.spaceChanged(spaceId, actorId, extraRecipients);
    // 테넌트는 지금(요청 스레드) 담는다 — 재검증 리스너는 커밋 뒤 다른 스레드에서 돈다.
    publisher.publishEvent(
        new WikiSpaceAudienceChangedEvent(TenantContext.require(), List.of(spaceId)));
  }

  /** 부서 역할 검증 — 모르는 역할은 기존 역할 검증(400), OWNER 는 부서에 주지 않는다(400). */
  private void validateGroupRole(String role) {
    perms.validateRole(role);
    if (!GROUP_ROLES.contains(role)) {
      throw new IllegalArgumentException("부서에는 편집 또는 보기 역할만 줄 수 있습니다");
    }
  }

  /** TEAM 공간이 아니면 멤버 변경을 거부한다 — 사람 멤버 변경의 가드(WikiSpaceService, WP-495)와 같은 규칙. */
  private void requireTeamSpace(long spaceId) {
    String type =
        spaces.findType(spaceId).orElseThrow(() -> new WikiSpaceNotFoundException(spaceId));
    if (!"TEAM".equals(type)) {
      throw new WikiSpaceTypeNotEditableException(spaceId, type);
    }
  }
}
