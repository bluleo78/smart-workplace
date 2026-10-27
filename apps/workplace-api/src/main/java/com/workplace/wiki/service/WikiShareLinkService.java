package com.workplace.wiki.service;

import com.workplace.global.tenant.MembershipGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.user.repository.UserRepository;
import com.workplace.wiki.dto.WikiShareGrant;
import com.workplace.wiki.dto.WikiSharePerson;
import com.workplace.wiki.dto.WikiShareResolvedResponse;
import com.workplace.wiki.exception.WikiShareNotFoundException;
import com.workplace.wiki.exception.WikiShareOtherTenantException;
import com.workplace.wiki.exception.WikiSharePublicViewException;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiShareRepository;
import com.workplace.wiki.repository.WikiShareRepository.ShareRow;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 공유 링크 열기(WP-579) — {@code GET /api/v1/wiki/shares/{token}}. 로그인 사용자가 링크를 열 때 그 링크로 볼 수 있는 페이지
 * 묶음과 「멤버인가」를 돌려주고, 열 때마다 조회 수·마지막 열람 시각을 올린다(사람별 중복 제거 없음 — 열기 요청마다 센다). 열람은 감사 로그에 남기지 않는다.
 *
 * <p>판정 순서
 *
 * <ol>
 *   <li>토큰의 워크스페이스가 지금 워크스페이스가 아니면 RLS 로는 행이 보이지 않으므로 {@code wiki_page_share_tenant} 로 따로 찾는다. 호출자가
 *       그 워크스페이스의 ACTIVE 멤버이면 409(전환할 곳을 알려 줌). 멤버가 아니면 외부로 열 수 있는 링크(PUBLIC·정책 켬·만료 전)는 409 {@code
 *       WIKI_SHARE_PUBLIC}(웹이 외부 보기를 그림 — 설계 「멤버가 아니면 외부 링크는 외부 보기」), 그 밖엔 404 — 멤버가 아닌 사람에게 링크의
 *       워크스페이스를 드러내지 않는다.
 *   <li>같은 워크스페이스에서 없음·만료·외부 공유 꺼짐은 404.
 *   <li>멤버 여부는 {@link WikiShareAccess#grant} 보다 <b>먼저</b> 정한다 — grant 는 지정한 사람(PEOPLE)이 아니면 403 을
 *       던지지만, 스페이스 멤버의 역할이 공유 역할을 채우면 지정되지 않았어도 멤버로서 열린다(member=true). 역할이 못 미치면(보기 멤버의 편집 링크)
 *       grant 판정을 받아 공유 역할로 열리고, 지정되지 않은 PEOPLE 링크면 공유가 더하는 것이 없어 자기 역할로 멤버 화면(member=true)에서 연다.
 * </ol>
 */
@Service
@RequiredArgsConstructor
public class WikiShareLinkService {
  private static final String NOT_FOUND = "열 수 없는 링크입니다";

  private final WikiShareRepository shares;
  private final WikiPageRepository pages;
  private final WikiSpaceMemberRepository members;
  private final WikiShareAccess access;
  private final MembershipGuard membershipGuard;
  // 공유한 사람 표시 이름.
  private final UserRepository users;

  /**
   * 링크를 연다.
   *
   * @throws WikiShareOtherTenantException 다른 워크스페이스의 링크를 그 워크스페이스 멤버가 엶(409)
   * @throws WikiSharePublicViewException 다른 워크스페이스의 외부 링크를 그 비멤버가 엶(409, 외부 보기로)
   * @throws WikiShareNotFoundException 없음·해제·재발급·만료·다른 워크스페이스의 비멤버(404)
   * @throws com.workplace.wiki.exception.WikiShareForbiddenException 지정한 사람이 아님(403, 접근 요청 가능)
   */
  @Transactional
  public WikiShareResolvedResponse resolve(long userId, String token) {
    rejectOtherTenant(userId, token);
    ShareRow share = shares.findActiveByToken(token).orElseThrow(this::notFound);
    // 외부 공유가 꺼진 워크스페이스의 외부 링크는 없는 링크다(판정 {@code WikiShareAccess} 와 같은 규칙).
    if ("PUBLIC".equals(share.audience()) && !share.externalShareEnabled()) {
      throw notFound();
    }

    String shareRole = WikiShareAccess.roleOf(share.audience(), share.permission());
    String memberRole = members.findRole(share.spaceId(), userId).orElse(null);
    boolean member = memberRole != null && WikiPermissions.atLeast(memberRole, shareRole);
    if (!member) {
      // 비멤버이거나 역할이 공유 역할에 못 미친다 — 비멤버가 지정한 사람(PEOPLE)이 아니면 여기서 403. 이미 읽은 공유 행으로 판정한다.
      WikiShareGrant grant = access.grant(share, share.pageId(), userId).orElse(null);
      if (grant == null && memberRole != null) {
        // 지정되지 않은 PEOPLE 링크를 연 멤버 — 공유가 더해 주는 것이 없으니 자기 스페이스 역할로 멤버 화면에서 연다(설계: 높은 쪽).
        member = true;
      } else if (grant == null) {
        throw notFound();
      }
    }

    shares.recordView(share.id());
    List<Long> covered =
        share.includeChildren() ? shares.coveredSubtree(share.pageId()) : List.of(share.pageId());
    String sharerName =
        users.findNamesByIds(List.of(share.createdBy())).getOrDefault(share.createdBy(), "");
    return new WikiShareResolvedResponse(
        share.pageId(),
        share.spaceId(),
        share.permission(),
        share.includeChildren(),
        new WikiSharePerson(share.createdBy(), sharerName),
        member,
        shares.listSharedPages(covered, share.pageId()));
  }

  /**
   * 토큰이 다른 워크스페이스 것이면 그 워크스페이스 멤버에게는 409(전환), 비멤버에게는 외부로 열리는 링크면 409(외부 보기), 아니면 404. 같은 워크스페이스(또는
   * 없는 토큰)면 통과 — 다음 조회가 가린다. 외부로 열리는지는 외부 보기와 같은 SECURITY DEFINER 판정({@code
   * wiki_page_share_resolve_public})을 쓴다 — 정책 꺼짐·만료면 외부 보기도 404 라 보낼 곳이 없다.
   */
  private void rejectOtherTenant(long userId, String token) {
    Long tokenTenant = shares.findTenantOfToken(token).orElse(null);
    if (tokenTenant == null || tokenTenant == TenantContext.require()) {
      return;
    }
    if (membershipGuard.isActiveMemberOf(userId, tokenTenant)) {
      throw new WikiShareOtherTenantException(tokenTenant);
    }
    if (shares.findPublicTenantOfToken(token).isPresent()) {
      throw new WikiSharePublicViewException();
    }
    throw notFound();
  }

  private WikiShareNotFoundException notFound() {
    return new WikiShareNotFoundException(NOT_FOUND);
  }
}
