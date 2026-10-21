package com.workplace.wiki.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.wiki.dto.WikiShareListItemResponse;
import com.workplace.wiki.repository.WikiShareRepository;
import com.workplace.wiki.repository.WikiShareRepository.PolicyLock;
import com.workplace.wiki.repository.WikiShareRepository.ShareDetail;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.TreeSet;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 공유 관리자 기능(WP-579) — 외부 공유 허용 스위치, 워크스페이스 전체 공유 목록, 일괄 해제. 권한({@code wiki_share:manage}) 확인은
 * 컨트롤러가 한다.
 *
 * <p>해제는 모두 {@link WikiShareService#revokeAll} 을 지난다 — 대기 중 접근 요청 정리·공유 기록·감사가 사용자 해제와 같다. 공유 기록의
 * 행위자는 호출한 관리자이고, 감사 로그의 행위자는 요청 사용자(같은 관리자)다. 재검증 이벤트는 한 번에 지운 공유들이 덮던 페이지를 모아 한 번 낸다.
 */
@Service
@RequiredArgsConstructor
public class WikiSharePolicyService {
  /** 전체 목록 한 번에 읽는 상한 — 화면이 한 번에 받는 양. */
  static final int MAX_LIST = 500;

  /** 일괄 해제 한 번에 다루는 페이지 수 상한 — 한 트랜잭션이 너무 커지지 않게. */
  static final int MAX_BULK_REVOKE = 500;

  private final WikiShareRepository shares;
  private final WikiShareService shareService;
  private final WikiShareAudit audit;

  /** 지금 워크스페이스의 외부 공유 허용. */
  @Transactional(readOnly = true)
  public boolean isExternalShareEnabled() {
    return shares.isExternalShareEnabled(TenantContext.require(), PolicyLock.NONE);
  }

  /**
   * 외부 공유 허용을 바꾼다. 끄면 같은 트랜잭션에서 외부(PUBLIC) 공유를 모두 지운다 — 페이지마다 공유 기록 REVOKED_BY_POLICY·감사
   * WIKI_SHARE_REVOKED(reason POLICY)를 남기고, 끝에 감사 WIKI_SHARE_POLICY_CHANGED(해제 수 포함)와 재검증 이벤트를 낸다.
   * 다시 켜도 지운 공유는 되살리지 않는다. 값이 그대로이고 지울 것도 없으면 아무것도 남기지 않는다(멱등).
   *
   * <p>테넌트 행을 먼저 배타 잠금한다 — 이 트랜잭션이 끝나기 전에 외부 공개로 저장하려는 요청은 공유 잠금({@link PolicyLock#SHARE}) 읽기에서
   * 기다렸다가 꺼진 값을 보고 거절되므로, 끈 뒤에 PUBLIC 공유가 새로 남지 않는다.
   *
   * @param adminId 요청한 관리자(공유 기록의 행위자)
   * @return 이번에 해제된 외부 공유 수
   */
  @Transactional
  public int setExternalShareEnabled(long adminId, boolean enabled) {
    long tenantId = TenantContext.require();
    boolean current = shares.isExternalShareEnabled(tenantId, PolicyLock.UPDATE);
    if (current != enabled) {
      shares.setExternalShareEnabled(tenantId, enabled);
    }
    int revoked = 0;
    if (!enabled) {
      // 이미 꺼져 있어도 남은 PUBLIC 공유가 있으면 정리한다(정책과 데이터가 어긋난 채 두지 않는다).
      revoked =
          shareService.revokeAll(
              adminId,
              shares.findPublicForUpdate(),
              "REVOKED_BY_POLICY",
              "관리자가 외부 공유를 꺼서 공유가 해제되었습니다",
              "POLICY");
    }
    if (current != enabled || revoked > 0) {
      audit.logPolicyChanged(tenantId, enabled, revoked);
    }
    return revoked;
  }

  /** 워크스페이스 전체 공유(최근 변경순) — 스페이스·토큰 포함. limit 은 1..{@value #MAX_LIST}, offset 은 0 이상으로 맞춘다. */
  @Transactional(readOnly = true)
  public List<WikiShareListItemResponse> listAll(int limit, int offset) {
    return shares.listAll(Math.max(1, Math.min(limit, MAX_LIST)), Math.max(0, offset));
  }

  /**
   * 선택한 페이지의 공유를 일괄 해제한다(REVOKED_BY_ADMIN·감사 reason ADMIN). 공유가 없는 페이지 id 는 건너뛴다(멱등). 재검증 이벤트는 한 번.
   * 교착을 피하려 페이지 id 오름차순으로 잠근다(정책 끔의 {@link WikiShareRepository#findPublicForUpdate} 도 같은 page_id
   * 순).
   *
   * @param adminId 요청한 관리자(공유 기록의 행위자)
   * @return 실제로 해제된 공유 수
   * @throws IllegalArgumentException 비었거나 상한({@value #MAX_BULK_REVOKE}) 초과(400)
   */
  @Transactional
  public int revokeShares(long adminId, List<Long> pageIds) {
    if (pageIds == null || pageIds.isEmpty()) {
      throw new IllegalArgumentException("해제할 페이지를 선택하세요");
    }
    TreeSet<Long> ordered =
        pageIds.stream().filter(Objects::nonNull).collect(Collectors.toCollection(TreeSet::new));
    if (ordered.size() > MAX_BULK_REVOKE) {
      throw new IllegalArgumentException("한 번에 " + MAX_BULK_REVOKE + "개까지 해제할 수 있습니다");
    }
    // 오름차순으로 하나씩 잠가 모은 뒤 함께 해제한다 — 잠금 순서는 그대로다.
    List<ShareDetail> locked = new ArrayList<>();
    for (long pageId : ordered) {
      shares.findByPageForUpdate(pageId).ifPresent(locked::add);
    }
    return shareService.revokeAll(adminId, locked, "REVOKED_BY_ADMIN", "관리자가 공유를 해제했습니다", "ADMIN");
  }
}
