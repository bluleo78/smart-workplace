package com.workplace.wiki.controller;

import com.workplace.global.security.AuthDetails;
import com.workplace.global.security.BearerTokens;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.wiki.dto.CollabAccessResponse;
import com.workplace.wiki.dto.HtmlLockHeartbeatRequest;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.SaveHtmlPageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiBacklinksResponse;
import com.workplace.wiki.dto.WikiHtmlLockAcquired;
import com.workplace.wiki.dto.WikiHtmlLockStatus;
import com.workplace.wiki.dto.WikiHtmlScriptsCheckResponse;
import com.workplace.wiki.dto.WikiMentionRef;
import com.workplace.wiki.dto.WikiMovePreviewResponse;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageEntryResponse;
import com.workplace.wiki.dto.WikiRevisionDetail;
import com.workplace.wiki.dto.WikiRevisionListResponse;
import com.workplace.wiki.service.WikiCollabDocService;
import com.workplace.wiki.service.WikiHtmlLockService;
import com.workplace.wiki.service.WikiHtmlPageService;
import com.workplace.wiki.service.WikiHtmlScriptsCheckService;
import com.workplace.wiki.service.WikiHydrationService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiRevisionService;
import com.workplace.wiki.service.WikiShareAccess;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 위키 단건 페이지 API.
 *
 * <p>공유 링크(WP-579): 페이지 GET·mentions·collab-access·제목 PUT 은 {@link WikiShareAccess#HEADER} 를 받아 멤버가
 * 아니어도 공유 권한으로 연다. 백링크·버전 기록·복원·이동·삭제는 헤더를 받지 않는다(설계 「접근 판정」 — 공유 화면에서 쓰지 않는 기능).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/wiki/pages")
public class WikiPageController {
  private final WikiPageService pageService;
  private final WikiHydrationService hydrationService;
  private final WikiCollabDocService collabService;
  private final WikiRevisionService revisionService;
  private final WikiHtmlPageService htmlPageService;
  private final WikiHtmlLockService htmlLockService;
  private final JwtTokenProvider jwtTokenProvider;
  private final WikiShareAccess shareAccess;
  private final WikiHtmlScriptsCheckService htmlScriptsCheckService;

  /** 단건 상세. base=false 면 AI 병합 기준본을 남기지 않는다(새 웹 에디터 — 본문은 동기화 서버로 저장). */
  @GetMapping("/{id}")
  public ResponseEntity<WikiPageDetail> get(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @RequestParam(value = "base", defaultValue = "true") boolean base,
      @RequestHeader(value = WikiShareAccess.HEADER, required = false) String shareToken) {
    return ResponseEntity.ok(pageService.read(callerId, pageId, base, shareToken));
  }

  /**
   * HTML 블록 보안 점검 상태(WP-1290) — 저장된 내용의 지문과 점검 결과. 읽기만 한다(점검을 시작하지 않는다). 페이지를 볼 수 있어야 한다(멤버 또는 공유
   * 링크 헤더).
   */
  @GetMapping("/{id}/html-scripts/security-check")
  public ResponseEntity<WikiHtmlScriptsCheckResponse> htmlScriptsCheck(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @RequestHeader(value = WikiShareAccess.HEADER, required = false) String shareToken) {
    return ResponseEntity.ok(htmlScriptsCheckService.view(callerId, pageId, shareToken));
  }

  /**
   * HTML 블록 보안 점검 요청(WP-1290) — 저장된 내용으로 점검 행을 만들거나(FAILED·지난 기준이면 되돌려) 점검을 시작한다. 화면의 「다시 점검」과 공유
   * 창의 게시 전 점검이 부른다. 조회와 같은 권한.
   */
  @PostMapping("/{id}/html-scripts/security-check")
  public ResponseEntity<WikiHtmlScriptsCheckResponse> requestHtmlScriptsCheck(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @RequestHeader(value = WikiShareAccess.HEADER, required = false) String shareToken) {
    return ResponseEntity.ok(htmlScriptsCheckService.request(callerId, pageId, shareToken));
  }

  /**
   * 본문 토큰(유저/페이지/이슈)을 칩 라벨·라우트 메타로 하이드레이션. get() 으로 VIEWER 가드 후 그 페이지의 현재 본문으로 해석한다. 비가시/비실존 대상은
   * 제외. 공유 링크로 들어온 비멤버에게는 볼 수 없는 대상을 빼지 않고 「접근 권한 없음」(inaccessible)으로 가린다(WP-579).
   */
  @GetMapping("/{id}/mentions")
  public ResponseEntity<List<WikiMentionRef>> mentions(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @RequestHeader(value = WikiShareAccess.HEADER, required = false) String shareToken) {
    // 판정은 한 번 — 같은 결과로 VIEWER 가드와 멘션 가림 권한을 함께 얻는다.
    WikiPageService.MentionSource src = pageService.mentionSource(callerId, pageId, shareToken);
    return ResponseEntity.ok(
        hydrationService.resolveMentions(callerId, src.page().body(), src.maskingGrant()));
  }

  /**
   * 노트로 들어갈 사람이 어디로 갈지(WP-579) — 멤버면 노트, 이 페이지를 덮는 공유 대상이면 지금 토큰의 공유 화면. 둘 다 아니거나 없는 페이지는 404. 알림은
   * 지정한 사람 공유만 보고, {@code link=true}(노트 주소로 연 비멤버, WP-987)면 워크스페이스 전체 공유도 본다.
   */
  @GetMapping("/{id}/entry")
  public ResponseEntity<WikiPageEntryResponse> entry(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @RequestParam(name = "link", defaultValue = "false") boolean link) {
    return ResponseEntity.ok(shareAccess.entry(pageId, callerId, link));
  }

  /** 이 페이지를 참조하는 source 페이지(백링크). get() 으로 VIEWER 가드 후 가시 source 만 반환. */
  @GetMapping("/{id}/backlinks")
  public ResponseEntity<WikiBacklinksResponse> backlinks(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    pageService.get(callerId, pageId); // VIEWER 가드(비멤버는 404)
    return ResponseEntity.ok(hydrationService.backlinks(callerId, pageId));
  }

  /**
   * 노트 동시 편집 연결 권한(WP-286) — 웹·동기화 서버가 <b>사용자 토큰으로</b> 호출해 역할·테넌트·표시 이름을 받는다. 스펙은 내부 경로를 가정했지만 사용자
   * 토큰으로 판정해야 "이 사용자가 이 페이지를 볼 수 있는가" 가 기존 인증 필터·RLS 그대로 성립하므로 공개 API 경로에 둔다(의도적 차이). 비멤버·페이지 없음은
   * 404.
   *
   * <p>tokenExp: 요청이 JWT(access) 로 인증됐으면 그 exp(epoch 초), PAT·API 키·내부 토큰 등이면 null — 동기화 서버가 연결을 토큰
   * 만료에 맞춰 끊는 데 쓴다.
   */
  @GetMapping("/{id}/collab-access")
  public ResponseEntity<CollabAccessResponse> collabAccess(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @RequestHeader(value = "Authorization", required = false) String auth,
      @RequestHeader(value = WikiShareAccess.HEADER, required = false) String shareToken) {
    return ResponseEntity.ok(collabService.access(callerId, pageId, jwtExpOf(auth), shareToken));
  }

  /** Bearer 가 서명 검증되는 access JWT 일 때만 exp 를 돌려준다(swp_/ak_ 같은 Bearer PAT·API 키는 검증 실패 → null). */
  private Long jwtExpOf(String auth) {
    // 인증 필터와 같은 규칙(scheme 대소문자 무관, WP-1431)으로 토큰을 꺼낸다 — 필터는 bearer 로 인증했는데 여기서만 null 이 되면
    // 동기화 서버가 만료 시각을 몰라 연결을 토큰 만료에 맞춰 끊지 못한다.
    String token = BearerTokens.extract(auth);
    if (token == null) {
      return null;
    }
    return jwtTokenProvider.accessTokenExpEpochSeconds(token);
  }

  /**
   * 저장. 제목만이면 나중 값 우선, 본문은 동기화 서버로 위임(WP-290·WP-285 — 규칙은 {@link WikiPageService#save}). 기존 낙관적 경로의
   * 충돌은 409, 동기화 서버 장애는 503.
   *
   * <p>ai: 브라우저 JWT 세션(AuthDetails 있음)은 사람, PAT(원격 MCP)·API 키(AGENT)·Internal on-behalf-of(채팅 비서)처럼
   * details 가 없는 인증은 AI 경로로 본다 — 동기화 서버의 ✦ 표시·스냅샷 귀속용.
   */
  @PutMapping("/{id}")
  public ResponseEntity<WikiPageDetail> save(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @Valid @RequestBody SavePageRequest req,
      Authentication authentication,
      @RequestHeader(value = WikiShareAccess.HEADER, required = false) String shareToken) {
    boolean ai = AuthDetails.methodOf(authentication) == null;
    return ResponseEntity.ok(pageService.save(callerId, pageId, req, ai, shareToken));
  }

  /**
   * 「HTML 문서」 원본 저장(WP-1307) — 소스 저장·다시 올리기·MCP 원본 바꾸기. EDITOR 이상, HTML 문서가 아니면 409, version 충돌
   * 409, 5MB 초과 413. 저장할 때마다 직전 판을 버전 기록에 남긴다(AI 경로면 ✦ 귀속 — 판정은 {@link #save} 와 같다). 다른 편집 세션이 편집
   * 중이면 409(errors.code=HTML_LOCKED, WP-1308) — lockToken 이 없는 저장(다시 올리기·MCP·AI)은 누구든 편집 중이면 막힌다.
   * 편집 「저장」(lockToken)이면 그 편집 잠금이 풀린다.
   */
  @PutMapping("/{id}/html")
  public ResponseEntity<WikiPageDetail> saveHtml(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @Valid @RequestBody SaveHtmlPageRequest req,
      Authentication authentication) {
    boolean ai = AuthDetails.methodOf(authentication) == null;
    return ResponseEntity.ok(htmlPageService.save(callerId, pageId, req, ai));
  }

  /**
   * 「HTML 문서」 편집 잠금 상태(WP-1308). VIEWER 이상. 입력 없이 10분이 지난 잠금은 풀린 것으로 본다. canForceRelease 는 스페이스
   * 소유자가 남의 잠금을 볼 때 true.
   */
  @GetMapping("/{id}/html-lock")
  public ResponseEntity<WikiHtmlLockStatus> htmlLock(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    return ResponseEntity.ok(htmlLockService.status(callerId, pageId));
  }

  /**
   * 「편집」 — 새 편집 세션으로 잠금을 얻는다(WP-1308). EDITOR 이상. 남이 편집 중이면 409(errors.code=HTML_LOCKED,
   * holderName). 세션 표지(token)와 남아 있던 내 임시 저장본·그사이 다른 저장이 있었는지를 함께 돌려준다. 내가 다른 창에서 편집 중이면 이 창이
   * 넘겨받는다.
   */
  @PostMapping("/{id}/html-lock")
  public ResponseEntity<WikiHtmlLockAcquired> acquireHtmlLock(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    return ResponseEntity.ok(htmlLockService.acquire(callerId, pageId));
  }

  /**
   * 편집 중 신호(WP-1308) — 그 세션(body.token)의 마지막 입력 시각을 새로 하고 고치던 소스를 임시 저장본으로 남긴다. 세션이 맞지 않으면(잠금을 잃음)
   * 아무것도 바꾸지 않고 mine=false 로 알린다.
   */
  @PutMapping("/{id}/html-lock")
  public ResponseEntity<WikiHtmlLockStatus> heartbeatHtmlLock(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @RequestBody HtmlLockHeartbeatRequest req) {
    return ResponseEntity.ok(htmlLockService.heartbeat(callerId, pageId, req));
  }

  /**
   * 편집 끝내기(WP-1308). 기본은 「취소」 — 그 세션(token)의 잠금을 풀고 임시 저장본도 지운다. keepDraft=true 면 내용을 남긴 채 편집만 끝낸다.
   * 세션이 맞지 않으면 아무것도 바꾸지 않는다. force=true 는 「잠금 풀기」 — 스페이스 소유자가 누구의 잠금이든 푼다(token 불요, 편집하던 사람의 임시
   * 저장본은 남는다, 소유자가 아니면 403).
   */
  @DeleteMapping("/{id}/html-lock")
  public ResponseEntity<Void> releaseHtmlLock(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @RequestParam(value = "force", defaultValue = "false") boolean force,
      @RequestParam(value = "keepDraft", defaultValue = "false") boolean keepDraft,
      @RequestParam(value = "token", required = false) UUID token) {
    if (force) {
      htmlLockService.forceRelease(callerId, pageId);
    } else {
      htmlLockService.release(callerId, pageId, token, !keepDraft);
    }
    return ResponseEntity.noContent().build();
  }

  /** 버전 기록 목록(WP-297) — 현재 판 + 저장된 판 최신순(최대 200). VIEWER 이상, 비멤버·없는 페이지 404. */
  @GetMapping("/{id}/revisions")
  public ResponseEntity<WikiRevisionListResponse> revisions(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    return ResponseEntity.ok(revisionService.list(callerId, pageId));
  }

  /** 버전 기록 단건(본문 포함, WP-297). VIEWER 이상, 없는 판 404. */
  @GetMapping("/{id}/revisions/{version}")
  public ResponseEntity<WikiRevisionDetail> revision(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @PathVariable("version") int version) {
    return ResponseEntity.ok(revisionService.get(callerId, pageId, version));
  }

  /** 그 판의 본문으로 복원(WP-297, 제목은 그대로). EDITOR 이상, 없는 판 404, 동기화 서버 장애 503. 응답은 PUT 저장과 같은 페이지 상세. */
  @PostMapping("/{id}/revisions/{version}/restore")
  public ResponseEntity<WikiPageDetail> restore(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @PathVariable("version") int version) {
    return ResponseEntity.ok(revisionService.restore(callerId, pageId, version));
  }

  /**
   * 다른 스페이스로 옮기기 전의 영향(WP-988) — 함께 옮겨 가는 페이지 수, 더는 볼 수 없게 되는 멤버 수, 옮겨 가는·해제되는 링크 공유. 원본·대상 스페이스 모두
   * EDITOR 이상.
   */
  @GetMapping("/{id}/move-preview")
  public ResponseEntity<WikiMovePreviewResponse> movePreview(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @RequestParam("targetSpaceId") long targetSpaceId) {
    return ResponseEntity.ok(pageService.movePreview(callerId, pageId, targetSpaceId));
  }

  @PatchMapping("/{id}/move")
  public ResponseEntity<Void> move(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @Valid @RequestBody MovePageRequest req) {
    pageService.move(callerId, pageId, req);
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    pageService.delete(callerId, pageId);
    return ResponseEntity.noContent().build();
  }
}
