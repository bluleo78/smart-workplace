package com.workplace.wiki.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.user.outbound.WorkspaceMembershipSuspended;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiShareRepository;
import com.workplace.wiki.repository.WikiShareRepository.ShareDetail;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
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
  private final WikiShareService shareService;

  /**
   * 페이지를 옮긴 뒤(같은 트랜잭션) — 옮기기 전후 부모의 조상 체인에 걸린 하위 포함 공유를 비교한다. 옮긴 페이지 자신과 그 하위의 공유는 함께 옮겨 가므로 비교에 들지
   * 않는다. 부모가 그대로면(같은 부모 안 순서 변경)이나 그 스페이스에 하위 포함 공유가 없으면 아무것도 하지 않는다(대부분의 이동은 조상 체인을 훑지 않고 끝난다).
   *
   * @param spaceId 옮긴 페이지의 스페이스(이동은 같은 스페이스 안에서만 된다)
   * @param actorId 옮긴 사람 — 이동 기록의 행위자
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void onMoved(long spaceId, long pageId, Long oldParentId, Long newParentId, long actorId) {
    if (Objects.equals(oldParentId, newParentId) || !shares.existsIncludingChildren(spaceId)) {
      return;
    }
    Set<Long> before = includingRootsAbove(oldParentId);
    Set<Long> after = includingRootsAbove(newParentId);
    List<Long> movedOut = before.stream().filter(id -> !after.contains(id)).toList();
    List<Long> movedIn = after.stream().filter(id -> !before.contains(id)).toList();
    if (movedOut.isEmpty() && movedIn.isEmpty()) {
      return;
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
    if (!movedOut.isEmpty()) {
      // 빠진 공유로 옮긴 서브트리를 열어 둔 화면을 다시 판정하게 한다.
      shareService.publishAccessChanged(pages.subtreeIdsInclusive(pageId));
    }
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

  /** 부모(포함)의 조상 체인에 걸린 하위 포함 공유의 루트 페이지. 최상위(부모 없음)면 비어 있다. */
  private Set<Long> includingRootsAbove(Long parentId) {
    if (parentId == null) {
      return Set.of();
    }
    return new LinkedHashSet<>(
        shares.findIncludingChildrenRoots(pages.ancestorIdsInclusive(parentId)));
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
