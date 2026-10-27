package com.workplace.wiki.service;

import com.workplace.wiki.dto.WikiPageEntryResponse;
import com.workplace.wiki.dto.WikiShareGrant;
import com.workplace.wiki.exception.WikiForbiddenException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.exception.WikiShareForbiddenException;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiShareRepository;
import com.workplace.wiki.repository.WikiShareRepository.RequestFlags;
import com.workplace.wiki.repository.WikiShareRepository.ShareRow;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 페이지 공유 링크 접근 판정 — 한 곳에서만 한다(WP-579, 설계 「접근 판정」).
 *
 * <p>요청이 {@link #HEADER} 로 공유 토큰을 실어 오면, 스페이스 멤버 역할과 공유가 주는 역할 중 높은 쪽을 준다. 토큰이 없으면 지금과 똑같이 스페이스 멤버
 * 판정만 한다({@link WikiPermissions#requireRole}). 판정은 요청마다 DB 에서 다시 한다(캐시 없음) — 해제·재발급·만료·트리 이동이 다음
 * 요청부터 바로 반영돼야 하기 때문이다.
 *
 * <p>공유 S 가 페이지 P 를 여는 조건:
 *
 * <ol>
 *   <li>토큰의 공유가 (이 테넌트에) 있고 만료 전이다. 다른 테넌트의 토큰은 RLS 로 보이지 않아 없는 공유다.
 *   <li>범위: 하위 포함이면 S 의 페이지가 P 의 <b>지금</b> 조상(자기 포함)에 있고, 아니면 S 의 페이지가 곧 P 다. 범위 밖이면 대상(audience)을
 *       보기 전에 끝낸다 — 토큰이 다른 페이지의 열쇠가 되거나, 범위 밖에서 403 으로 토큰의 유효성을 드러내지 않게.
 *   <li>대상: WORKSPACE 는 로그인 사용자 누구나(같은 테넌트는 RLS 가 보장), PEOPLE 은 지정한 사람과 지정한 조직도 부서(하위 부서 포함)의 지금
 *       구성원만(WP-1023, 아니면 403 + 접근 요청 가능 — 단 스페이스 멤버는 403 없이 공유 없음으로 보고 자기 역할로 연다), PUBLIC 은 테넌트가
 *       외부 공유를 허용할 때만(로그인 여부 무관).
 *   <li>역할: 편집 권한이고 PUBLIC 이 아니면 EDITOR, 그 외 VIEWER.
 * </ol>
 */
@Component
@RequiredArgsConstructor
public class WikiShareAccess {
  /** 공유 화면이 모든 노트 요청에 싣는 공유 토큰 헤더. */
  public static final String HEADER = "X-Wiki-Share-Token";

  private final WikiShareRepository shares;
  private final WikiPageRepository pages;
  private final WikiSpaceMemberRepository members;
  private final WikiPermissions perms;
  private final WikiShareClock clock;

  /**
   * 판정 메서드의 트랜잭션 — 읽기 전용이고, 판정 거절(404·403)은 읽기 실패일 뿐이라 호출자의 쓰기 트랜잭션에 합류해 있어도 rollback-only 로 만들지
   * 않는다(WikiPermissions 처럼 호출자가 잡아서 다른 응답으로 바꿀 수 있게).
   */
  @Retention(RetentionPolicy.RUNTIME)
  @Target(ElementType.METHOD)
  @Transactional(
      readOnly = true,
      noRollbackFor = {
        WikiShareForbiddenException.class,
        WikiPageNotFoundException.class,
        WikiSpaceNotFoundException.class,
        WikiForbiddenException.class
      })
  @interface DecisionTx {}

  /**
   * 토큰이 이 페이지에 주는 권한. 로그인 경로 — userId 가 null(비로그인)이면 PUBLIC 공유만 연다.
   *
   * @return 없음(토큰 없음·없는 공유·만료·범위 밖·정책 꺼짐) 또는 공유 권한
   * @throws WikiShareForbiddenException PEOPLE 공유의 범위 안 페이지인데 지정한 사람이 아닐 때(403, 접근 요청 가능)
   */
  @DecisionTx
  public Optional<WikiShareGrant> grant(long pageId, Long userId, String token) {
    return grantOf(decide(pageId, userId, token), userId);
  }

  /**
   * {@link #grant(long, Long, String)} 과 같은 판정을 호출자가 이미 토큰으로 읽은 공유 행으로 한다 — 같은 요청에서 토큰 조회를 되풀이하지
   * 않게(링크 열기·외부 보기). 행은 {@link WikiShareRepository#findActiveByToken} 결과여야 한다(만료 전).
   *
   * @throws WikiShareForbiddenException PEOPLE 공유의 범위 안 페이지인데 지정한 사람이 아닐 때(403)
   */
  @DecisionTx
  public Optional<WikiShareGrant> grant(ShareRow share, long pageId, Long userId) {
    return grantOf(decide(share, pageId, userId), userId);
  }

  /** 판정 결과를 grant 응답으로 — PEOPLE 미지정이면 403 을 던진다. */
  private Optional<WikiShareGrant> grantOf(Decision d, Long userId) {
    if (d.peopleDenied() != null) {
      throw forbidden(d.peopleDenied().pageId(), userId);
    }
    return Optional.ofNullable(d.grant());
  }

  /**
   * 이 페이지에 대한 호출자의 실제 역할 — 멤버 역할과 공유 역할 중 높은 쪽. 토큰이 없으면 {@link WikiPermissions#requireRole} 그대로(비멤버
   * 404·역할 미달 403).
   *
   * <p>멤버 역할만으로 minRole 을 채우면 공유 쪽 거절(지정한 사람 아님 등)은 무시한다 — 공유 화면 헤더를 단 멤버가 자기 페이지를 못 여는 일이 없게.
   *
   * @throws WikiPageNotFoundException 멤버도 아니고 공유도 없을 때(404 — 없는 페이지와 같은 응답)
   * @throws WikiShareForbiddenException 멤버가 아니고 PEOPLE 공유의 지정한 사람이 아닐 때(403)
   * @throws WikiForbiddenException 역할이 minRole 에 못 미칠 때(403)
   */
  @DecisionTx
  public String effectiveRole(
      long spaceId, long pageId, long userId, String token, String minRole) {
    return effectiveAccess(spaceId, pageId, userId, token, minRole).role();
  }

  /**
   * {@link #effectiveRole} 과 같은 판정 + 그 역할이 공유에서 왔을 때 공유 만료 시각. 동기화 서버 연결 판정(collab-access)이 쓴다 —
   * 공유로 정해진 역할은 공유가 만료되는 순간 끝나므로, 서버가 그 시각에 연결을 다시 판정한다. 멤버 역할이 이기거나(같으면 멤버) 공유가 무기한이면 null. 멘션
   * 가림(페이지 mentions)도 같은 판정 결과의 {@link EffectiveAccess#maskingGrant} 를 쓴다 — 판정을 두 번 돌지 않게.
   */
  @DecisionTx
  public EffectiveAccess effectiveAccess(
      long spaceId, long pageId, long userId, String token, String minRole) {
    if (isBlank(token)) {
      return new EffectiveAccess(perms.requireRole(spaceId, userId, minRole), null, null);
    }
    String memberRole = members.findRole(spaceId, userId).orElse(null);
    Decision d = decide(pageId, userId, token);
    String shareRole = d.grant() != null ? d.grant().role() : null;
    String best = WikiPermissions.higher(memberRole, shareRole);
    if (best == null) {
      if (d.peopleDenied() != null) {
        throw forbidden(d.peopleDenied().pageId(), userId);
      }
      throw new WikiPageNotFoundException(pageId);
    }
    if (!WikiPermissions.atLeast(best, minRole)) {
      throw new WikiForbiddenException(spaceId, userId);
    }
    boolean fromShare =
        shareRole != null
            && (memberRole == null || !WikiPermissions.atLeast(memberRole, shareRole));
    // 멘션 가림은 멤버가 아니고 공유로 들어왔을 때만 — 멤버는 지금과 같은 멘션을 본다(여기까지 왔으면 비멤버의 공유 권한은 있다).
    return new EffectiveAccess(
        best, fromShare ? d.grant().expiresAt() : null, memberRole == null ? d.grant() : null);
  }

  /**
   * 실제 역할과, 그 역할이 공유에서 왔을 때 공유 만료 시각.
   *
   * @param shareExpiresAt 역할을 정한 공유의 만료(null = 멤버 역할이거나 무기한 공유)
   * @param maskingGrant 멘션 가림용 공유 권한 — 호출자가 이 스페이스 멤버가 아니고 공유로 들어왔을 때만, 아니면 null(토큰 없음·멤버)
   */
  public record EffectiveAccess(
      String role, OffsetDateTime shareExpiresAt, WikiShareGrant maskingGrant) {}

  /**
   * 노트로 들어갈 때 어디로 보낼지(WP-579) — 멤버면 노트 주소(spaceId), 아니면 이 페이지를 지금 덮는 공유의 <b>현재</b> 토큰(공유 주소 {@code
   * /wiki/share/{token}/pages/{pageId}} 를 만드는 데 쓴다). 둘 다 아니면 없는 페이지와 같은 404.
   *
   * <ul>
   *   <li>알림(withWorkspace=false): 지정한 사람으로 들어 있는 공유만 — 토큰은 지정 대상에게만 돌려준다.
   *   <li>노트 주소로 연 비멤버(withWorkspace=true, WP-987): 워크스페이스 전체 공유도 — 하위 페이지의 노트 주소를 받은 비멤버가 그 페이지를
   *       덮는 공유 보기로 바로 옮겨 열게. 워크스페이스 멤버 누구나 열 수 있는 공유라 그 범위 안 페이지는 토큰을 몰라도 이 경로로 열린다(결정: 추천안 그대로).
   *       외부 공개 공유의 토큰은 어느 경로로도 돌려주지 않는다.
   * </ul>
   *
   * <p>토큰마다 {@link #decide} 로 다시 판정해 열리지 않는 것(상속이 멈춘 하위·정책이 꺼진 외부 링크 등)은 건너뛴다.
   *
   * @throws WikiPageNotFoundException 없는 페이지·멤버도 공유 대상도 아님
   */
  @Transactional(readOnly = true)
  public WikiPageEntryResponse entry(long pageId, long userId, boolean withWorkspace) {
    long spaceId =
        pages.findSpaceId(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    if (members.findRole(spaceId, userId).isPresent()) {
      return new WikiPageEntryResponse(spaceId, true, null);
    }
    List<Long> ancestors = pages.ancestorIdsInclusive(pageId);
    for (String token : shares.findCoveringTokens(pageId, userId, ancestors, withWorkspace)) {
      if (decide(pageId, userId, token).grant() != null) {
        return new WikiPageEntryResponse(spaceId, false, token);
      }
    }
    throw new WikiPageNotFoundException(pageId);
  }

  /**
   * pageIds 중 이 공유의 지금 범위 안에 있는 페이지 — 멘션 가림이 범위 안 페이지의 제목을 보일 때 쓴다. 규칙은 {@link #inScope} 와 같다(하위
   * 포함이면 상속이 멈추는 곳에서 내려가지 않는 지금 서브트리). 공유의 범위 설정은 판정 때 grant 에 실려 온 값을 쓴다(공유 행을 다시 읽지 않는다).
   */
  @Transactional(readOnly = true)
  public List<Long> coveredAmong(WikiShareGrant grant, Collection<Long> pageIds) {
    long root = grant.rootPageId();
    if (!grant.includeChildren()) {
      return pageIds.stream().distinct().filter(pid -> pid == root).toList();
    }
    // 하위 포함이면 공유가 덮는 서브트리를 한 번만 구해 교집합 — 페이지마다 조상 체인을 묻던 N+1 을 없앤다(판정은 inScope 와 같다: 지금 트리 기준).
    Set<Long> subtree = new HashSet<>(shares.coveredSubtree(root));
    return pageIds.stream().distinct().filter(subtree::contains).toList();
  }

  /**
   * 지정한 사람이 아닐 때의 403 — 받는 화면이 버튼을 고르도록 대기 요청 여부와 최근 거절 여부를 싣는다(한 번의 조회). 거절 기준은 접근 요청 서비스의 재요청 대기와
   * 같은 기준 시각({@link WikiShareAccessRequestService#denialCutoff})이다.
   */
  private WikiShareForbiddenException forbidden(long sharePageId, long userId) {
    RequestFlags f =
        shares.findRequestFlags(
            sharePageId, userId, WikiShareAccessRequestService.denialCutoff(clock));
    return new WikiShareForbiddenException(f.pending(), f.recentlyDenied());
  }

  /** 공유 권한이 주는 역할 — 편집 권한이고 외부 공개가 아니면 EDITOR, 그 외 VIEWER(외부는 언제나 보기만). */
  public static String roleOf(String audience, String permission) {
    return "EDIT".equals(permission) && !"PUBLIC".equals(audience) ? "EDITOR" : "VIEWER";
  }

  /** 판정 본체 — 거절 사유(PEOPLE 미지정)를 결과로 돌려 호출자가 던질지 정하게 한다. */
  private Decision decide(long pageId, Long userId, String token) {
    if (isBlank(token)) {
      return Decision.NONE;
    }
    ShareRow s = shares.findActiveByToken(token).orElse(null);
    return s == null ? Decision.NONE : decide(s, pageId, userId);
  }

  /** 토큰으로 읽은(만료 전) 공유 행으로 판정한다. */
  private Decision decide(ShareRow s, long pageId, Long userId) {
    // 범위를 대상보다 먼저 본다 — 범위 밖 페이지는 어떤 토큰이든 404.
    if (!inScope(s, pageId)) {
      return Decision.NONE;
    }
    switch (s.audience()) {
      case "PUBLIC" -> {
        if (!s.externalShareEnabled()) {
          return Decision.NONE;
        }
      }
      case "WORKSPACE" -> {
        if (userId == null) {
          return Decision.NONE;
        }
      }
      case "PEOPLE" -> {
        if (userId == null) {
          return Decision.NONE;
        }
        // 지정한 사람이거나 지정한 부서(하위 부서 포함)의 구성원인지 — 한 번의 조회(WP-1023).
        if (!shares.isListed(s.id(), userId)) {
          // 스페이스 멤버는 지정되지 않았어도 접근 요청(403) 대상이 아니다 — 「스페이스 역할과 공유 역할 중 높은 쪽」이라 적어도 자기 역할로 열린다.
          // 공유는 아무것도 더해 주지 않으므로(NONE) 호출자는 멤버 역할로 판정한다(effectiveRole·링크 열기의 멤버 화면).
          if (members.findRole(s.spaceId(), userId).isPresent()) {
            return Decision.NONE;
          }
          return new Decision(null, s);
        }
      }
      default -> {
        return Decision.NONE;
      }
    }
    return new Decision(
        new WikiShareGrant(
            s.id(),
            s.pageId(),
            s.includeChildren(),
            roleOf(s.audience(), s.permission()),
            s.createdBy(),
            s.expiresAt()),
        null);
  }

  /**
   * 공유 범위 — 공유 페이지 자신이거나, 하위 포함이면 지금 조상 체인(자기 포함)에 공유 페이지가 있고 그 사이에 상속이 멈추는 페이지가 없는지(WP-987 — 상위 공유
   * 제외 표시, 따로 켠 공유). 이동·제외·하위 공유 변경이 즉시 반영된다.
   */
  private boolean inScope(ShareRow s, long pageId) {
    if (s.pageId() == pageId) {
      return true;
    }
    return s.includeChildren() && shares.isCoveredBy(s.pageId(), pageId);
  }

  private static boolean isBlank(String token) {
    return token == null || token.isBlank();
  }

  /**
   * 판정 결과.
   *
   * @param grant 열리면 그 권한, 아니면 null
   * @param peopleDenied PEOPLE 공유 범위 안인데 지정한 사람이 아니면 그 공유, 아니면 null
   */
  private record Decision(WikiShareGrant grant, ShareRow peopleDenied) {
    static final Decision NONE = new Decision(null, null);
  }
}
