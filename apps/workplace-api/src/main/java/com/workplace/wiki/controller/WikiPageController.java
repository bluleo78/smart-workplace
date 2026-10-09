package com.workplace.wiki.controller;

import com.workplace.global.security.AuthDetails;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.wiki.dto.CollabAccessResponse;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiBacklinksResponse;
import com.workplace.wiki.dto.WikiMentionRef;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiRevisionDetail;
import com.workplace.wiki.dto.WikiRevisionListResponse;
import com.workplace.wiki.service.WikiCollabDocService;
import com.workplace.wiki.service.WikiHydrationService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiRevisionService;
import jakarta.validation.Valid;
import java.util.List;
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

/** 위키 단건 페이지 API. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/wiki/pages")
public class WikiPageController {
  private final WikiPageService pageService;
  private final WikiHydrationService hydrationService;
  private final WikiCollabDocService collabService;
  private final WikiRevisionService revisionService;
  private final JwtTokenProvider jwtTokenProvider;

  /** 단건 상세. base=false 면 AI 병합 기준본을 남기지 않는다(새 웹 에디터 — 본문은 동기화 서버로 저장). */
  @GetMapping("/{id}")
  public ResponseEntity<WikiPageDetail> get(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @RequestParam(value = "base", defaultValue = "true") boolean base) {
    return ResponseEntity.ok(pageService.read(callerId, pageId, base));
  }

  /**
   * 본문 토큰(유저/페이지/이슈)을 칩 라벨·라우트 메타로 하이드레이션. get() 으로 VIEWER 가드 후 그 페이지의 현재 본문으로 해석한다. 비가시/비실존 대상은
   * 제외.
   */
  @GetMapping("/{id}/mentions")
  public ResponseEntity<List<WikiMentionRef>> mentions(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    WikiPageDetail page = pageService.get(callerId, pageId);
    return ResponseEntity.ok(hydrationService.resolveMentions(callerId, page.body()));
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
      @RequestHeader(value = "Authorization", required = false) String auth) {
    return ResponseEntity.ok(collabService.access(callerId, pageId, jwtExpOf(auth)));
  }

  /** Bearer 가 서명 검증되는 access JWT 일 때만 exp 를 돌려준다(swp_/ak_ 같은 Bearer PAT·API 키는 검증 실패 → null). */
  private Long jwtExpOf(String auth) {
    if (auth == null || !auth.startsWith("Bearer ")) {
      return null;
    }
    return jwtTokenProvider.accessTokenExpEpochSeconds(auth.substring("Bearer ".length()));
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
      Authentication authentication) {
    boolean ai = AuthDetails.methodOf(authentication) == null;
    return ResponseEntity.ok(pageService.save(callerId, pageId, req, ai));
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
