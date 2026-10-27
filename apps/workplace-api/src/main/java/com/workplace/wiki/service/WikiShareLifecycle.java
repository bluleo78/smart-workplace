package com.workplace.wiki.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.user.outbound.WorkspaceMembershipSuspended;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiShareRepository;
import com.workplace.wiki.repository.WikiShareRepository.ShareDetail;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 노트 공유를 페이지·사람의 변화에 맞춰 정리한다(WP-579, 설계 「공유한 사람이 떠날 때」·「기록·감사」).
 *
 * <ul>
 *   <li>페이지 이동 — 하위 포함 공유는 「지금 위치 기준」이라, 공유 루트 밖으로 옮긴 페이지는 그 순간 공유에서 빠지고 안으로 옮긴 페이지는 들어간다. 그 공유의
 *       기록에 PAGE_MOVED_OUT·PAGE_MOVED_IN 을 남기고, 빠진 쪽은 재검증해 공유로 열린 화면을 닫는다.
 *   <li>다른 스페이스로 이동(WP-988) — 서브트리의 공유는 토큰 그대로 함께 옮겨 가되, 만든 사람이 대상 스페이스 편집자가 아니면 해제한다. 옛 위치를 덮던 상위
 *       공유에서는 빠지고(PAGE_MOVED_OUT) 새 위치를 덮는 상위 공유에는 들어간다(PAGE_MOVED_IN).
 *   <li>공유한 사람이 편집 권한을 잃음(스페이스에서 내보내짐·보기로 강등) — 그 스페이스에서 그 사람이 만든 공유를 해제한다. 워크스페이스에서 정지되면 모든 스페이스의
 *       것을 해제한다(REVOKED_BY_MEMBERSHIP, 감사 reason MEMBERSHIP).
 *   <li>페이지·스페이스 삭제 — 공유 행은 CASCADE 로 사라지므로 지우기 전에 공유마다 감사(reason PAGE_DELETED)만 남긴다. 공유 기록은 페이지에
 *       매달려 함께 지워지고, 열린 화면은 삭제가 내는 재검증(사유 삭제)이 닫는다.
 * </ul>
 *
 * <p>모두 원인이 된 변경과 같은 트랜잭션에서 돈다 — 변경이 롤백되면 정리도 함께 되돌려진다. 해제 기록의 행위자는 감사 로그와 같은 요청 사용자({@link
 * WikiShareAudit#currentActorId}), 없으면 시스템이다.
 */
@Component
@RequiredArgsConstructor
public class WikiShareLifecycle {
  private static final String LOST_EDIT_TEXT = "공유한 사람이 이 스페이스의 편집 권한을 잃어 공유가 해제되었습니다";
  private static final String DELETED_TEXT = "공유한 에이전트가 삭제되어 공유가 해제되었습니다";
  private static final String SUSPENDED_TEXT = "공유한 사람이 워크스페이스에서 정지되어 공유가 해제되었습니다";

  private final WikiShareRepository shares;
  private final WikiPageRepository pages;
  private final WikiSpaceMemberRepository members;
  private final WikiShareService shareService;

  /**
   * 페이지를 옮긴 뒤(같은 트랜잭션) — 옮기기 전후 부모의 조상 체인에 걸린 하위 포함 공유를 비교한다. 옮긴 페이지 자신과 그 하위의 공유는 함께 옮겨 가므로 비교에 들지
   * 않는다. 부모가 그대로면(같은 부모 안 순서 변경)이나 그 스페이스에 하위 포함 공유가 없으면 아무것도 하지 않는다(대부분의 이동은 조상 체인을 훑지 않고 끝난다).
   *
   * @param spaceId 옮긴 페이지의 스페이스(같은 스페이스 안 이동 — 다른 스페이스로 옮길 때는 {@link #afterSpaceMove})
   * @param actorId 옮긴 사람 — 이동 기록의 행위자
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void onMoved(long spaceId, long pageId, Long oldParentId, Long newParentId, long actorId) {
    if (Objects.equals(oldParentId, newParentId) || !shares.existsIncludingChildren(spaceId)) {
      return;
    }
    if (recordCoverageChange(pageId, oldParentId, newParentId, actorId, null)) {
      // 빠진 공유로 옮긴 서브트리를 열어 둔 화면을 다시 판정하게 한다.
      shareService.publishAccessChanged(pages.subtreeIdsInclusive(pageId));
    }
  }

  /**
   * 옮기기 전후 부모를 덮는 하위 포함 공유를 비교해, 빠진 공유에는 PAGE_MOVED_OUT, 새로 덮는 공유에는 PAGE_MOVED_IN 을 남긴다. 같은 스페이스 안
   * 이동과 다른 스페이스로의 이동(WP-988 — 두 조상 체인이 겹치지 않아 옛 공유는 모두 빠지고 새 공유는 모두 들어온다)이 함께 쓴다. 옮긴 페이지가 상위 공유에서
   * 제외돼 있거나 자기 공유가 살아 있으면 어느 쪽도 덮지 않으므로 아무것도 남기지 않는다(WP-1031·WP-1043).
   *
   * <p>상속을 멈추는지는 옮기기 전과 뒤를 나눠 본다(WP-1043) — 옛 공유에서 「나감」은 옮기기 전에 멈추지 않았을 때만, 새 공유에 「들어옴」은 옮긴 뒤에 멈추지
   * 않을 때만 남긴다. 같은 스페이스 안 이동은 자기 공유·제외 표시가 그대로라 둘이 같고, 다른 스페이스로 옮길 때는 옮기며 자기 공유가 해제될 수 있어(만든 사람이 대상
   * 스페이스 편집자가 아님) 옮기기 전 값을 {@link #beforeSpaceMove} 가 넘긴다.
   *
   * @param stoppedBefore 옮기기 전에 이 페이지가 상속을 멈췄는지 — null 이면 옮긴 뒤와 같다(같은 스페이스 안 이동)
   * @return 빠진 공유가 있었는지 — 있으면 공유로 열린 화면을 다시 판정해야 한다
   */
  private boolean recordCoverageChange(
      long pageId, Long oldParentId, Long newParentId, long actorId, Boolean stoppedBefore) {
    Set<Long> before = includingRootsAbove(oldParentId);
    Set<Long> after = includingRootsAbove(newParentId);
    List<Long> movedOut = before.stream().filter(id -> !after.contains(id)).toList();
    List<Long> movedIn = after.stream().filter(id -> !before.contains(id)).toList();
    if (movedOut.isEmpty() && movedIn.isEmpty()) {
      return false;
    }
    // 옮긴 페이지 자신이 상속을 멈추면(상위 공유 제외 표시 WP-987, 또는 자기 공유가 살아 있음 WP-1043 — 접근 판정 stopsInheritance 와
    // 같다) 그 위의 어떤 하위 포함 공유로도 열리지 않는다. 그래서 옮기기 전에 멈췄으면 옛 공유의 「나감」을, 옮긴 뒤에 멈추면 새 공유의 「들어옴」을
    // 남기지 않는다. 조상 쪽에서 멈추는 경우는 includingRootsAbove 가 이미 걸러 낸다. 대부분의 이동은 위에서 끝나므로 이 조회는 공유 범위가 바뀔 때만
    // 한다.
    boolean stoppedAfter = shares.stopsInheritanceAt(pageId);
    boolean stoppedBeforeMove = stoppedBefore != null ? stoppedBefore : stoppedAfter;
    if (stoppedBeforeMove) {
      movedOut = List.of();
    }
    if (stoppedAfter) {
      movedIn = List.of();
    }
    if (movedOut.isEmpty() && movedIn.isEmpty()) {
      return false;
    }
    String title =
        pages.findTitle(pageId).filter(t -> !t.isBlank()).orElse(WikiPublicShareService.UNTITLED);
    movedOut.forEach(
        root ->
            recordMove(
                root,
                actorId,
                "PAGE_MOVED_OUT",
                pageId,
                title,
                "「" + title + "」 페이지를 공유 범위 밖으로 옮겼습니다"));
    movedIn.forEach(
        root ->
            recordMove(
                root,
                actorId,
                "PAGE_MOVED_IN",
                pageId,
                title,
                "「" + title + "」 페이지를 공유 범위 안으로 옮겼습니다"));
    return !movedOut.isEmpty();
  }

  /** 다른 스페이스로 옮길 때 서브트리 공유의 처리 갈래 — 함께 옮겨 가는 것과 옮기며 해제되는 것. */
  public record SpaceMoveShares(List<ShareDetail> kept, List<ShareDetail> revoked) {}

  /**
   * 서브트리의 공유를 나눈다(WP-988) — 만든 사람이 대상 스페이스의 편집자 이상이면 옮겨 가고, 아니면(멤버 아님·보기 전용) 해제한다. 지금의 「만든 사람이 편집
   * 권한을 잃으면 자동 해제」 규칙과 같다. lock 이면 공유 행을 page_id 순으로 잠가 읽는다(이동 본 처리), 아니면 잠그지 않는다(미리보기).
   */
  public SpaceMoveShares splitSharesForSpaceMove(
      List<Long> subtreeIds, long targetSpaceId, boolean lock) {
    List<ShareDetail> all =
        lock ? shares.findByPagesForUpdate(subtreeIds) : shares.findByPages(subtreeIds);
    // 만든 사람들의 대상 스페이스 역할을 한 번에 읽는다(공유마다 조회하지 않게).
    Map<Long, String> roles =
        members.findRoles(
            targetSpaceId, all.stream().map(ShareDetail::createdBy).collect(Collectors.toSet()));
    Map<Boolean, List<ShareDetail>> byKept =
        all.stream()
            .collect(
                Collectors.partitioningBy(
                    s -> {
                      String role = roles.get(s.createdBy());
                      return role != null && WikiPermissions.atLeast(role, "EDITOR");
                    }));
    return new SpaceMoveShares(byKept.get(true), byKept.get(false));
  }

  /**
   * 스페이스 이동 직전(같은 트랜잭션) — 옮기면서 해제될 공유를 해제한다. 해제 기록·감사의 스페이스는 옮기기 전 스페이스로 남도록 서브트리의 스페이스를 바꾸기
   * <b>전에</b> 부른다.
   *
   * @return 옮기기 전에 옮길 페이지가 상속을 멈췄는지(WP-1043) — 해제 <b>전</b> 값이다. {@link #afterSpaceMove} 에 넘겨 옛 공유의
   *     「나감」 판정에 쓴다
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public boolean beforeSpaceMove(
      long pageId, List<Long> subtreeIds, long targetSpaceId, long actorId) {
    // 해제가 자기 공유를 지우기 전에 읽는다 — 옮기기 전 위치에서는 그 공유가 상속을 멈췄다.
    boolean stoppedBefore = shares.stopsInheritanceAt(pageId);
    SpaceMoveShares split = splitSharesForSpaceMove(subtreeIds, targetSpaceId, true);
    shareService.revokeAll(
        actorId,
        split.revoked(),
        "REVOKED_BY_MEMBERSHIP",
        "공유한 사람이 옮겨 간 스페이스의 편집 권한이 없어 공유가 해제되었습니다",
        "MEMBERSHIP");
    return stoppedBefore;
  }

  /**
   * 스페이스 이동 직후(같은 트랜잭션, 페이지의 스페이스·부모를 바꾼 뒤) — 남은 공유 행의 스페이스를 따라 옮기고, 옛 위치를 덮던 상위 하위 포함 공유에는
   * PAGE_MOVED_OUT, 새 위치를 덮는 상위 공유에는 PAGE_MOVED_IN 을 남긴다. 열린 연결의 재검증은 호출자의
   * WikiPageSpaceChangedEvent 가 서브트리의 모든 연결(공유 연결 포함)로 한 번에 한다.
   *
   * @param oldParentId 옮기기 전 부모(옛 스페이스의 페이지, 없으면 null)
   * @param newParentId 새 부모(새 스페이스의 페이지, 없으면 null)
   * @param stoppedBefore {@link #beforeSpaceMove} 가 돌려준, 옮기기 전에 옮길 페이지가 상속을 멈췄는지
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void afterSpaceMove(
      long newSpaceId,
      long pageId,
      List<Long> subtreeIds,
      Long oldParentId,
      Long newParentId,
      long actorId,
      boolean stoppedBefore) {
    shares.updateSpace(subtreeIds, newSpaceId);
    // 옛 위치의 조상 체인은 옮긴 서브트리와 상관없이 그대로 — 옮긴 뒤에 읽어도 같다. 재검증은 호출자의 WikiPageSpaceChangedEvent 가 한다.
    recordCoverageChange(pageId, oldParentId, newParentId, actorId, stoppedBefore);
  }

  /**
   * 공유한 사람이 이 스페이스의 편집 권한을 잃었다(내보내짐·보기로 강등) — 그 사람이 이 스페이스에 만든 공유를 해제한다. 멤버 변경과 같은 트랜잭션에서 부른다. 해제할
   * 공유가 없으면 아무것도 하지 않는다.
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void onMemberLostEdit(long spaceId, long userId) {
    revokeCreatedBy(userId, spaceId, LOST_EDIT_TEXT);
  }

  /**
   * 워크스페이스 멤버십 정지 — 그 사람이 만든 공유를 모든 스페이스에서 해제한다. 정지 트랜잭션의 커밋 직전에 같은 트랜잭션에서 돌아, 정지와 해제가 함께 커밋되거나 함께
   * 롤백된다(정지만 남고 공유가 살아 있는 틈이 없다). 테넌트는 이벤트에 담긴 값으로 세운다 — 발행한 쪽(user 모듈)의 컨텍스트에 기대지 않는다.
   */
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onWorkspaceMembershipSuspended(WorkspaceMembershipSuspended e) {
    TenantContext.runAs(e.tenantId(), () -> revokeCreatedBy(e.userId(), null, SUSPENDED_TEXT));
  }

  /**
   * AGENT 삭제 — 그 에이전트가 만든 공유를 모든 스페이스에서 해제한다. {@code WikiSpaceService} 의 AgentDeleted 동기 리스너가 사용자
   * 행을 지우기 <b>전에</b>(같은 트랜잭션, 테넌트도 세운 뒤) 부른다: 행을 지우면 {@code wiki_page_share.created_by} CASCADE 가
   * 공유를 조용히 지워 버려 감사·기록이 남지 않는다. 같은 리스너가 이어서 스페이스 멤버십을 지우므로 이벤트 리스너를 따로 두지 않는다(두 리스너의 순서는 정해지지
   * 않는다). 재검증 이벤트는 해제 경로가 내고, 지정 대상이던 사람의 연결은 {@code WikiCollabRevalidator} 가 AgentDeleted 로 사용자 단위
   * 재검증한다.
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void revokeAgentShares(long userId) {
    revokeCreatedBy(userId, null, DELETED_TEXT);
  }

  /**
   * 페이지(서브트리) 삭제 직전 — 함께 사라질 공유마다 감사 WIKI_SHARE_REVOKED(reason PAGE_DELETED). 페이지 행을 지우기 전에 부른다.
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void beforePagesDeleted(List<Long> pageIds) {
    shares.findByPagesForUpdate(pageIds).forEach(this::auditDeleted);
  }

  /**
   * 스페이스 삭제 직전 — {@link #beforePagesDeleted} 와 같은 감사를 스페이스의 공유 전부에 남긴다. 스페이스 행을 잠근 뒤, 페이지 행을 잠그기
   * <b>전에</b> 부른다: 공유 저장은 공유 행을 잠근 뒤 기록을 쓰며 페이지 행에 KEY SHARE 를 거는데, 페이지 행을 먼저 잠그면 그 저장과 서로 기다리는 교착이
   * 된다.
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void beforeSpaceDeleted(long spaceId) {
    shares.findBySpaceForUpdate(spaceId).forEach(this::auditDeleted);
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  /** 그 사람이 만든 공유(spaceId null = 모든 스페이스)를 해제하고, 재검증 이벤트를 한 번 낸다(없으면 아무것도 하지 않는다). */
  private void revokeCreatedBy(long userId, Long spaceId, String text) {
    // 기록과 감사의 행위자를 같은 값으로 — 멤버를 바꾼 OWNER·정지한 관리자, 요청 사용자가 없으면 시스템(null).
    shareService.revokeAll(
        WikiShareAudit.currentActorId(),
        shares.findByCreatorForUpdate(userId, spaceId),
        "REVOKED_BY_MEMBERSHIP",
        text,
        "MEMBERSHIP");
  }

  /**
   * 부모(포함)를 지금 덮는 하위 포함 공유의 루트 페이지 — 부모 자신의 공유이거나, 부모까지 상속이 멈추지 않는(제외 표시·따로 켠 공유가 없는) 조상의
   * 공유다(WP-987, {@link WikiShareRepository#isCoveredBy}). 조상 체인에 걸렸어도 중간에서 멈춘 공유는 이 부모 아래로 옮긴 페이지를
   * 덮지 않는다. 만료된 공유는 접근 판정처럼 아무것도 덮지 않으므로 루트로 세지 않는다(WP-1044, {@link
   * WikiShareRepository#findIncludingChildrenRoots}) — 중간의 만료된 자기 공유는 상속도 멈추지 않으므로 그 위의 살아 있는 공유는
   * 그대로 덮는다. 최상위(부모 없음)면 비어 있다.
   */
  private Set<Long> includingRootsAbove(Long parentId) {
    if (parentId == null) {
      return Set.of();
    }
    Set<Long> roots = new LinkedHashSet<>();
    for (long root : shares.findIncludingChildrenRoots(pages.ancestorIdsInclusive(parentId))) {
      if (root == parentId || shares.isCoveredBy(root, parentId)) {
        roots.add(root);
      }
    }
    return roots;
  }

  /** 공유 루트 페이지의 기록에 이동 한 줄 — detail 에 옮긴 페이지 id·제목을 함께 싣는다(웹은 text 를 보인다). */
  private void recordMove(
      long rootPageId, long actorId, String type, long pageId, String title, String text) {
    Map<String, Object> detail = new LinkedHashMap<>();
    detail.put("text", text);
    detail.put("pageId", pageId);
    detail.put("title", title);
    shares.insertEvent(rootPageId, actorId, type, shareService.detail(detail));
  }

  private void auditDeleted(ShareDetail share) {
    shareService.auditRevoked(share, "PAGE_DELETED");
  }
}
