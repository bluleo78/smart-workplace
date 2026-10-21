package com.workplace.wiki.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.wiki.dto.WikiShareAccessRequestResult;
import com.workplace.wiki.exception.WikiShareNotFoundException;
import com.workplace.wiki.outbound.WikiShareNotifyEvents.WikiShareAccessApprovedEvent;
import com.workplace.wiki.outbound.WikiShareNotifyEvents.WikiShareAccessRequestedEvent;
import com.workplace.wiki.repository.WikiShareRepository;
import com.workplace.wiki.repository.WikiShareRepository.ShareDetail;
import com.workplace.wiki.repository.WikiShareRepository.ShareRow;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 공유 접근 요청(WP-579, 설계 「접근 요청·알림」) — 지정한 사람(PEOPLE) 링크를 지정되지 않은 사람이 열었을 때의 「접근 요청」과, 공유한 편집자의
 * 승인·거절.
 *
 * <p>요청은 공유 <b>루트</b> 페이지 id 로 저장한다 — 403 응답의 {@code requested}({@code WikiShareAccess})가 같은 id 로
 * 대기 요청을 찾는다. 요청·승인·거절은 공유 기록(wiki_page_share_event)에 남고, 거절은 관리자 감사 로그(WIKI_SHARE_ACCESS_DENIED)에도
 * 남는다. 승인은 설정 저장과 같은 사람 차이 경로로 요청자를 지정한 사람에 더한다. 알림은 이벤트만 발행한다({@code WikiShareNotifyEvents}) — 받는
 * 쪽은 notify 모듈이 커밋 뒤에 처리한다.
 */
@Service
@RequiredArgsConstructor
public class WikiShareAccessRequestService {
  private final WikiShareRepository shares;
  private final WikiSpaceMemberRepository members;
  private final WikiShareService shareService;
  private final WikiShareAudit audit;
  private final ApplicationEventPublisher publisher;
  private final WikiShareClock clock;

  /**
   * 거절 뒤 같은 사람이 같은 공유에 다시 요청할 수 없는 시간 — 거절할 때마다 공유한 사람에게 알림이 다시 가는 재요청 폭주를 막는다. 하루면 「잘못 눌렀다」· 「상황이
   * 바뀌었다」는 정당한 재요청은 다음 날 다시 할 수 있다. 403 응답의 denied 판정({@link WikiShareAccess})도 같은 값을 쓴다({@link
   * #denialCutoff}).
   */
  static final Duration DENIAL_COOLDOWN = Duration.ofHours(24);

  /**
   * 재요청 대기의 기준 시각 — 이 시각 뒤에 결정된 거절이면 아직 다시 요청할 수 없다. 요청 판정과 403 응답의 denied({@link
   * WikiShareAccess})가 이 한 곳에서 같은 앱 시계로 잰다(테스트가 시각을 옮겨 결정적으로 본다).
   */
  static OffsetDateTime denialCutoff(WikiShareClock clock) {
    return OffsetDateTime.ofInstant(clock.now().minus(DENIAL_COOLDOWN), ZoneOffset.UTC);
  }

  /**
   * 접근 요청을 보낸다(요청자 = 호출자). 요청이 필요한 경우 — PEOPLE 링크이고 호출자가 지정한 사람도 스페이스 멤버도 아님 — 에만 대기 요청을 만든다. 이미 대기
   * 중이면 그대로 PENDING(멱등), 같은 공유에 {@link #DENIAL_COOLDOWN} 안에 거절됐으면 새 요청·기록·알림 없이 DENIED. 새로 만들었을 때만
   * 기록과 공유한 사람 알림 이벤트를 낸다. 요청은 공유 행을 잠근 뒤 만든다 — 해제·재공유와 엇갈려 요청이 새 공유 밑에 남지 않는다.
   *
   * @throws WikiShareNotFoundException 없음·해제·재발급·만료·다른 워크스페이스 링크, 요청 도중 해제·재발급된 링크(404)
   */
  @Transactional
  public WikiShareAccessRequestResult request(long userId, String token) {
    // 처음부터 공유 행을 잠그고 읽는다(해제·재발급·승인·거절과 같은 공유 행 잠금) — 잠근 행이 곧 판단 대상이다. 잠그지 않으면 해제→재공유와 엇갈릴 때
    // 해제가 대기 요청을 지운 뒤에 옛 공유를 보고 만든 요청이 새 공유 밑에 고아로 남는다. 잠금을 기다린 사이 해제·재발급·만료됐으면 행이 조건에서 빠져
    // 처음부터 닫힌 링크였던 것처럼 404 — 요청·기록·알림을 남기지 않는다. 대상이 바뀐 경우(지정한 사람 → 워크스페이스 등)도 잠근 최신 값으로 판정해
    // 요청할 것이 없다(대상 변경 저장이 대기 요청을 지운 뒤라 새로 만들면 고아가 된다).
    ShareRow share =
        shares
            .findActiveByTokenForUpdate(token)
            .orElseThrow(() -> new WikiShareNotFoundException("열 수 없는 링크입니다"));
    if (!"PEOPLE".equals(share.audience()) || shares.isListed(share.id(), userId)) {
      return WikiShareAccessRequestResult.NOT_NEEDED;
    }
    // 스페이스 멤버는 요청하지 않는다 — 지정되지 않은 PEOPLE 링크도 자기 역할로 열리므로 403(요청 화면)을 보지 않는다(WikiShareAccess 판정과 같은
    // 규칙).
    if (members.findRole(share.spaceId(), userId).isPresent()) {
      return WikiShareAccessRequestResult.NOT_NEEDED;
    }
    if (shares.hasDenialSince(share.pageId(), userId, denialCutoff(clock))) {
      return WikiShareAccessRequestResult.DENIED;
    }
    if (!shares.insertPendingRequest(share.pageId(), userId)) {
      return WikiShareAccessRequestResult.PENDING;
    }
    shares.insertEvent(
        share.pageId(),
        userId,
        "ACCESS_REQUESTED",
        shareService.detail(shareService.nameOf(userId) + " 님이 접근을 요청했습니다"));
    publisher.publishEvent(
        new WikiShareAccessRequestedEvent(
            TenantContext.require(), share.pageId(), userId, share.createdBy()));
    return WikiShareAccessRequestResult.PENDING;
  }

  /** 결정 시각 — 재요청 대기와 같은 앱 시계로 남긴다. */
  private OffsetDateTime decidedAt() {
    return OffsetDateTime.ofInstant(clock.now(), ZoneOffset.UTC);
  }

  /**
   * 승인 — 요청자를 지정한 사람에 더하고(기록 PEOPLE_ADDED + 감사 WIKI_SHARE_PEOPLE_CHANGED viaRequest=true) 요청을
   * APPROVED 로, 요청자에게 승인 알림 이벤트. 스페이스 EDITOR 이상.
   *
   * @throws WikiShareNotFoundException 이 페이지의 공유 또는 대기 중 요청이 없음(이미 결정됐거나 다른 페이지의 요청 — 404)
   * @throws IllegalStateException 공유가 지정한 사람(PEOPLE)이 아님(409) — 대상 변경과 엇갈려 남은 요청
   */
  @Transactional
  public void approve(long callerId, long pageId, long requestId) {
    Pending p = lockForDecision(callerId, pageId, requestId);
    ShareDetail share = p.share();
    long requesterId = p.requesterId();
    // 대상이 지정한 사람이 아니면 더할 목록이 없다 — 승인 기록·알림만 남는 「승인」을 막는다(대상 변경 저장이 대기 요청을 지우므로 경합에서만 온다).
    if (!"PEOPLE".equals(share.audience())) {
      throw new IllegalStateException("지정한 사람 공유가 아니라 접근 요청을 승인할 수 없습니다");
    }
    shareService.addRequester(callerId, share, requesterId);
    shares.decideRequest(requestId, "APPROVED", callerId, decidedAt());
    shares.insertEvent(
        pageId,
        callerId,
        "ACCESS_APPROVED",
        shareService.detail(shareService.nameOf(requesterId) + " 님의 접근 요청을 승인했습니다"));
    publisher.publishEvent(
        new WikiShareAccessApprovedEvent(TenantContext.require(), pageId, callerId, requesterId));
  }

  /**
   * 거절 — 요청을 DENIED 로, 기록 ACCESS_DENIED, 감사 WIKI_SHARE_ACCESS_DENIED(requesterId). 알림은 없다. 스페이스
   * EDITOR 이상. 권한 판정은 승인과 같은 {@code lockEditor}(멤버 행을 잠근 뒤 읽은 역할) — 커밋 전 강등이 있으면 그 커밋을 기다려 바뀐 역할로
   * 판정한다(잠그지 않으면 강등된 사람이 옛 역할로 요청을 결정한다). 잠금 순서도 승인과 같아 서로 교착하지 않는다.
   */
  @Transactional
  public void deny(long callerId, long pageId, long requestId) {
    Pending p = lockForDecision(callerId, pageId, requestId);
    ShareDetail share = p.share();
    long requesterId = p.requesterId();
    shares.decideRequest(requestId, "DENIED", callerId, decidedAt());
    shares.insertEvent(
        pageId,
        callerId,
        "ACCESS_DENIED",
        shareService.detail(shareService.nameOf(requesterId) + " 님의 접근 요청을 거절했습니다"));
    Map<String, Object> extra = new LinkedHashMap<>();
    extra.put("audience", share.audience());
    extra.put("permission", share.permission());
    extra.put("requesterId", requesterId);
    audit.log(WikiShareAudit.ACCESS_DENIED, pageId, share.spaceId(), extra);
  }

  /**
   * 승인·거절의 공통 서문 — 권한 판정(멤버 행 잠금 뒤 EDITOR 이상) → 공유 행 잠금 → 대기 중 요청 잠금. 잠금 순서가 둘 다 같아 서로 교착하지 않는다.
   *
   * @throws WikiShareNotFoundException 이 페이지의 공유가 없거나, 대기 중 요청이 없음(이미 결정됐거나 다른 페이지의 요청)
   */
  private Pending lockForDecision(long callerId, long pageId, long requestId) {
    shareService.lockEditor(callerId, pageId);
    ShareDetail share =
        shares.findByPageForUpdate(pageId).orElseThrow(WikiShareNotFoundException::new);
    long requesterId =
        shares
            .findPendingRequesterForUpdate(requestId, pageId)
            .orElseThrow(() -> new WikiShareNotFoundException("대기 중인 접근 요청이 없습니다"));
    return new Pending(share, requesterId);
  }

  /** 잠가 읽은 공유와 대기 중 요청의 요청자. */
  private record Pending(ShareDetail share, long requesterId) {}
}
