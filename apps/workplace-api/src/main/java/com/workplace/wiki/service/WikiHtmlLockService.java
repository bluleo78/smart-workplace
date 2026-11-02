package com.workplace.wiki.service;

import com.workplace.wiki.dto.HtmlLockHeartbeatRequest;
import com.workplace.wiki.dto.WikiHtmlDraftInfo;
import com.workplace.wiki.dto.WikiHtmlLockAcquired;
import com.workplace.wiki.dto.WikiHtmlLockStatus;
import com.workplace.wiki.dto.WikiPageKind;
import com.workplace.wiki.exception.WikiHtmlLockedException;
import com.workplace.wiki.exception.WikiPageKindMismatchException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiHtmlLockChangedEvent;
import com.workplace.wiki.repository.WikiHtmlLockRepository;
import com.workplace.wiki.repository.WikiHtmlLockRepository.LockRow;
import com.workplace.wiki.repository.WikiHtmlLockRepository.PageBasis;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「HTML 문서」 편집 잠금(WP-1308) — 「편집」을 누른 한 편집 세션(창 하나)만 원본을 고치고, 다른 사람·창·MCP·AI 는 저장될 때까지 보기만 한다.
 *
 * <ul>
 *   <li>잠금은 편집 세션 표지(token)로 가른다 — 「편집」({@link #acquire})이 새 표지를 만들어 돌려주고, 편집 중 신호·취소·저장이 그 표지를
 *       돌려준다. 같은 사람이 다른 창에서 다시 「편집」하면 새 표지로 넘어가고, 먼저 연 창의 신호는 mine=false 를 받아 편집을 끝낸다(내용은 임시 저장본으로
 *       남는다).
 *   <li>표지 없이 원본을 바꾸는 쓰기(MCP·AI·되돌리기·편집을 거치지 않은 다시 올리기)는 살아 있는 잠금이 하나라도 있으면 409 다 — 편집하는 사람 이름으로 도는
 *       AI 저장도 그 사람의 편집을 끝내거나 임시 저장본을 지우지 않는다. 판정은 원본을 쓰는 한 곳({@link WikiHtmlPageService})의 UPDATE
 *       가 한다.
 *   <li>잠금은 저장·취소로 풀린다. 입력이 {@link #IDLE_TIMEOUT} 동안 없으면(창 닫힘·연결 끊김 포함) 저절로 풀린 것으로 본다 — 지우는 작업 없이
 *       마지막 입력 시각으로 읽을 때 판정한다({@link WikiHtmlLockClock}). 잠금을 다시 쥐는 것은 「편집」뿐이다(늦은·남은 신호는 거절만 된다).
 *   <li>편집 중 신호({@link #heartbeat})가 고치던 소스를 그 사람의 임시 저장본으로 남긴다. 저장·취소 없이 끝난 편집(10분·강제 풀기·다른 창)의
 *       내용은 임시 저장본으로 남아, 다음 「편집」 때 이어 고칠지 묻는다.
 *   <li>스페이스 소유자는 남의 잠금을 강제로 풀 수 있다(임시 저장본은 남긴다).
 * </ul>
 *
 * <p>권한은 스페이스 멤버 역할로만 판정한다 — 공유 링크 화면은 보기만 한다(WP-1307 결정)는 원본 저장 경로와 같다.
 */
@Service
@RequiredArgsConstructor
public class WikiHtmlLockService {
  /** 입력이 이만큼 없으면 잠금이 저절로 풀린다. */
  public static final Duration IDLE_TIMEOUT = Duration.ofMinutes(10);

  private final WikiHtmlLockRepository locks;
  private final WikiPermissions perms;
  private final WikiHtmlLockClock clock;
  private final ApplicationEventPublisher publisher;

  /** 잠금 상태(mine = 요청자가 쥠 — 사람으로 가른다). 스페이스 VIEWER 이상(비멤버·없는 페이지 404). */
  @Transactional(readOnly = true)
  public WikiHtmlLockStatus status(long callerId, long pageId) {
    Access access = requireHtml(callerId, pageId, "VIEWER");
    OffsetDateTime now = now();
    return live(locks.find(pageId), now)
        .map(l -> statusOf(l, l.userId() == callerId, access.role()))
        .orElse(WikiHtmlLockStatus.unlocked());
  }

  /**
   * 「편집」 — 새 편집 세션으로 잠금을 얻는다. EDITOR 이상, HTML 문서만. 남이 살아 있는 잠금을 쥐고 있으면 409({@link
   * WikiHtmlLockedException}). 내 잠금이면(다른 창에서 다시 눌렀다) 새 세션으로 넘겨받는다. 남아 있던 내 임시 저장본을 함께 돌려준다.
   */
  @Transactional
  public WikiHtmlLockAcquired acquire(long callerId, long pageId) {
    Access access = requireHtml(callerId, pageId, "EDITOR");
    PageBasis page = access.page();
    UUID token = UUID.randomUUID();
    LockRow held = take(pageId, callerId, token);
    WikiHtmlLockStatus status = statusOf(held, true, access.role());
    publishChanged(page.spaceId(), pageId, callerId, status);
    WikiHtmlDraftInfo draft =
        locks
            .findDraft(pageId, callerId)
            .map(
                d ->
                    new WikiHtmlDraftInfo(
                        d.html(),
                        d.baseVersion(),
                        d.updatedAt(),
                        d.baseVersion() != page.version()))
            .orElse(null);
    return new WikiHtmlLockAcquired(token, status, draft);
  }

  /**
   * 편집 중 신호 — 그 세션(token)의 살아 있는 잠금이면 마지막 입력 시각을 새로 하고, 소스가 오면 임시 저장본으로 남긴다. EDITOR 이상, 5MB 초과 413.
   *
   * <p>세션이 맞지 않으면(남·다른 창이 가져감, 저장·취소·강제 풀기로 풀림, 10분 지나 만료) 아무것도 바꾸지 않고 지금 상태(mine=false)를 돌려준다 —
   * 잠금을 다시 쥐지 않고(「편집」만 쥔다) 임시 저장본도 건드리지 않는다(저장·취소 직전에 떠난 늦은 신호가 지운 저장본을 되살리거나, 다른 창의 저장본을 덮지 않게).
   * 화면은 이 응답을 보고 편집이 끝났음을 알린다.
   */
  @Transactional
  public WikiHtmlLockStatus heartbeat(long callerId, long pageId, HtmlLockHeartbeatRequest req) {
    Access access = requireHtml(callerId, pageId, "EDITOR");
    if (req.html() != null) {
      WikiHtmlPageService.requireWithinLimit(req.html());
    }
    OffsetDateTime now = now();
    boolean mine =
        req.token() != null && locks.touch(pageId, req.token(), now, now.minus(IDLE_TIMEOUT));
    if (mine && req.html() != null) {
      int base = req.baseVersion() != null ? req.baseVersion() : access.page().version();
      locks.upsertDraft(pageId, callerId, req.html(), base, now);
    }
    return live(locks.find(pageId), now)
        .map(l -> statusOf(l, mine && l.token().equals(req.token()), access.role()))
        .orElse(WikiHtmlLockStatus.unlocked());
  }

  /**
   * 그 세션(token)의 잠금을 푼다. discardDraft=true 면 「취소」 — 고치던 임시 저장본도 지운다. false 면 내용을 남긴 채 편집만 끝낸다(입력 없이
   * 오래 둔 화면·화면 떠남). 세션이 맞지 않으면(이미 다른 창·남이 가져감) 잠금도 임시 저장본도 그대로다. VIEWER 이상(역할을 잃은 사람도 자기 잠금은 풀 수
   * 있게).
   */
  @Transactional
  public void release(long callerId, long pageId, UUID token, boolean discardDraft) {
    PageBasis page = requireHtml(callerId, pageId, "VIEWER").page();
    endSession(page.spaceId(), pageId, callerId, token, discardDraft);
  }

  /**
   * 「잠금 풀기」 — 스페이스 소유자가 누구의 잠금이든 강제로 푼다(편집하던 사람의 임시 저장본은 남긴다 — 다음 「편집」 때 이어 고칠 수 있게). 소유자가 아니면 403.
   */
  @Transactional
  public void forceRelease(long callerId, long pageId) {
    PageBasis page = requireHtml(callerId, pageId, "OWNER").page();
    if (locks.releaseAny(pageId)) {
      publishChanged(page.spaceId(), pageId, callerId, WikiHtmlLockStatus.unlocked());
    }
  }

  /** 원본 UPDATE 가 볼 만료 기준(지금 − 10분) — 이보다 오래전에 마지막으로 입력한 잠금은 쓰기를 막지 않는다. */
  OffsetDateTime liveCutoff() {
    return now().minus(IDLE_TIMEOUT);
  }

  /**
   * 원본 쓰기가 0 행이었을 때(트랜잭션 안) — 그 세션(token)과 다른 살아 있는 잠금 때문이면 409({@link WikiHtmlLockedException})를
   * 던진다. 아니면 돌아온다(호출자가 version 충돌로 알린다).
   */
  void throwIfLockedByOther(long pageId, UUID token) {
    live(locks.find(pageId), now())
        .filter(l -> !l.token().equals(token))
        .ifPresent(
            l -> {
              throw new WikiHtmlLockedException(l.userId(), l.userName());
            });
  }

  /**
   * 원본을 쓴 뒤(트랜잭션 안) — 편집 「저장」(token 있음)이면 그 세션을 끝낸다: 잠금을 풀고 저장한 사람의 임시 저장본을 지운다(저장이 편집을 끝낸다). token
   * 이 없는 쓰기(MCP·AI·되돌리기·다시 올리기)는 잠금·임시 저장본을 건드리지 않는다.
   */
  void afterWrite(long spaceId, long pageId, long callerId, UUID token) {
    endSession(spaceId, pageId, callerId, token, true);
  }

  /**
   * 편집 세션을 끝낸다(저장·취소·편집 끝내기 공통) — 그 세션(token)의 잠금 줄을 지우고, 지웠을 때만 dropDraft 에 따라 임시 저장본을 지우고 화면에
   * 알린다. 세션이 맞지 않으면(다른 창·남이 가져감) 아무것도 하지 않는다 — 다른 창이 쓰는 같은 사람의 임시 저장본을 지우지 않게.
   */
  private void endSession(long spaceId, long pageId, long callerId, UUID token, boolean dropDraft) {
    if (token == null || !locks.release(pageId, token)) {
      return;
    }
    if (dropDraft) {
      locks.deleteDraft(pageId, callerId);
    }
    publishChanged(spaceId, pageId, callerId, WikiHtmlLockStatus.unlocked());
  }

  /**
   * 새 세션으로 잠금을 쥐고 쥔 줄(이름 포함)을 돌려준다. 남의 살아 있는 잠금이면 409. 얻지 못했는데 다시 읽으니 쥔 사람이 없으면(그 사이 저장·취소로 풀림) 한 번
   * 더 해 본다.
   */
  private LockRow take(long pageId, long callerId, UUID token) {
    for (int attempt = 0; attempt < 2; attempt++) {
      OffsetDateTime now = now();
      boolean took = locks.tryAcquire(pageId, callerId, token, now, now.minus(IDLE_TIMEOUT));
      Optional<LockRow> row = live(locks.find(pageId), now);
      if (took) {
        return row.orElseThrow(() -> new IllegalStateException("얻은 잠금이 없다: page=" + pageId));
      }
      if (row.isPresent()) {
        throw new WikiHtmlLockedException(row.get().userId(), row.get().userName());
      }
    }
    throw new IllegalStateException("잠금을 얻지 못했는데 쥔 사람이 없다: page=" + pageId);
  }

  /** 살아 있는(마지막 입력이 10분 안) 잠금만 남긴다. */
  private static Optional<LockRow> live(Optional<LockRow> row, OffsetDateTime now) {
    OffsetDateTime cutoff = now.minus(IDLE_TIMEOUT);
    return row.filter(l -> !l.lastActiveAt().isBefore(cutoff));
  }

  /** 살아 있는 잠금 줄의 상태. 강제로 풀 수 있는지는 남의 잠금을 보는 스페이스 소유자만. */
  private static WikiHtmlLockStatus statusOf(LockRow l, boolean mine, String role) {
    return new WikiHtmlLockStatus(
        true,
        mine,
        l.userId(),
        l.userName(),
        l.acquiredAt(),
        l.lastActiveAt().plus(IDLE_TIMEOUT),
        !mine && WikiPermissions.atLeast(role, "OWNER"));
  }

  /** 판정 결과 — 페이지 정보와 요청자의 스페이스 역할. */
  private record Access(PageBasis page, String role) {}

  /** 역할을 먼저 보고(없는 페이지·비멤버 404, 역할 미달 403) 그다음 종류를 본다(노트면 409) — 볼 수 없는 페이지의 종류에 따라 응답이 갈리지 않게. */
  private Access requireHtml(long callerId, long pageId, String minRole) {
    PageBasis page =
        locks.findPageBasis(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    String role = perms.requireRole(page.spaceId(), callerId, minRole);
    if (page.kind() != WikiPageKind.HTML) {
      throw new WikiPageKindMismatchException("HTML 문서가 아닌 노트에는 편집 잠금이 없습니다");
    }
    return new Access(page, role);
  }

  /** 잠금이 바뀌었음을 알린다 — 바뀐 뒤의 상태(쥔 사람·시각)를 실어 화면이 다시 받지 않게. */
  private void publishChanged(long spaceId, long pageId, long actorId, WikiHtmlLockStatus s) {
    publisher.publishEvent(
        new WikiHtmlLockChangedEvent(
            spaceId,
            pageId,
            actorId,
            s.holderId(),
            s.holderName(),
            s.acquiredAt(),
            s.expiresAt(),
            clock.now()));
  }

  /** 지금(UTC) — DB(TIMESTAMPTZ)가 마이크로초까지 담으므로 맞춰 자른다(찍은 값과 다시 읽은 값이 같게). */
  private OffsetDateTime now() {
    return clock.now().truncatedTo(ChronoUnit.MICROS).atOffset(ZoneOffset.UTC);
  }
}
