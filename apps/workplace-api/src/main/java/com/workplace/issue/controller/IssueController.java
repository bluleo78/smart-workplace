package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueAiClassifyResponse;
import com.workplace.issue.dto.IssueAiContext;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.dto.UpdateStatusRequest;
import com.workplace.issue.outbound.IssueAiSummaryService;
import com.workplace.issue.service.IssueAiClassifyService;
import com.workplace.issue.service.IssueSearchService;
import com.workplace.issue.service.IssueService;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 CRUD REST API. 모든 경로는 프로젝트 key 컨텍스트에 묶인다. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues")
@RequiredArgsConstructor
public class IssueController {

  private final IssueService issueService;
  private final IssueSearchService issueSearchService;
  private final IssueAiSummaryService aiSummaryService;
  private final IssueAiClassifyService issueAiClassifyService;

  /** 검색/필터 + cursor 페이징 단일 엔드포인트. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<IssueSearchResponse> list(
      Authentication auth, @PathVariable String key, @RequestParam Map<String, String> params) {
    return ResponseEntity.ok(issueSearchService.search((Long) auth.getPrincipal(), key, params));
  }

  /** 신규 이슈 생성. */
  @PostMapping
  @RequirePermission("issue:write")
  public ResponseEntity<IssueResponse> create(
      Authentication auth, @PathVariable String key, @Valid @RequestBody CreateIssueRequest req) {
    return ResponseEntity.ok(issueService.create((Long) auth.getPrincipal(), key, req));
  }

  /** 이슈 상세 조회. */
  @GetMapping("/{number}")
  @RequirePermission("project:read")
  public ResponseEntity<IssueDetailResponse> get(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    return ResponseEntity.ok(issueService.get((Long) auth.getPrincipal(), key, number));
  }

  /** 이슈 부분 수정. */
  @PatchMapping("/{number}")
  @RequirePermission("issue:write")
  public ResponseEntity<IssueDetailResponse> update(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody UpdateIssueRequest req) {
    return ResponseEntity.ok(issueService.update((Long) auth.getPrincipal(), key, number, req));
  }

  /** DnD 전용 — status 만 갱신. */
  @PatchMapping("/{number}/status")
  @RequirePermission("issue:write")
  public ResponseEntity<IssueDetailResponse> updateStatus(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody UpdateStatusRequest req) {
    return ResponseEntity.ok(
        issueService.updateStatus((Long) auth.getPrincipal(), key, number, req.status()));
  }

  /** 유형 변경 본문. typeId 필수. */
  public record UpdateTypeRequest(@jakarta.validation.constraints.NotNull Long typeId) {}

  /** 이슈 유형 변경 — 같은 프로젝트의 유형만 허용. */
  @PatchMapping("/{number}/type")
  @RequirePermission("issue:write")
  public ResponseEntity<IssueDetailResponse> updateType(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody UpdateTypeRequest req) {
    return ResponseEntity.ok(
        issueService.setType((Long) auth.getPrincipal(), key, number, req.typeId()));
  }

  /** 이슈 soft-delete. reporter 또는 OWNER 만 가능. */
  @DeleteMapping("/{number}")
  @RequirePermission("issue:write")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    issueService.softDelete((Long) auth.getPrincipal(), key, number);
    return ResponseEntity.noContent().build();
  }

  /**
   * 이슈 AI 분류 제안 — 제목·본문으로 유형·우선순위·라벨을 추천받는다.
   *
   * <p>Migration-0: DB 저장 없음 — 응답을 폼에 채우는 용도.
   */
  @PostMapping("/ai-classify")
  @RequirePermission("project:read")
  public ResponseEntity<IssueAiClassifyResponse> aiClassify(
      Authentication auth, @PathVariable String key, @Valid @RequestBody AiClassifyRequest req) {
    Long callerId = (Long) auth.getPrincipal();
    return ResponseEntity.ok(
        issueAiClassifyService.classify(callerId, key, req.title(), req.body()));
  }

  /** AI 분류 요청 바디 — 제목 필수, 본문 선택. */
  public record AiClassifyRequest(
      @jakarta.validation.constraints.NotBlank String title, String body) {}

  /**
   * 이슈 AI 현황 요약 생성(사용자 요청 버튼).
   *
   * <p>3단계 — issueId 해석(@Transactional) → generateOnDemand(자체 tx + HTTP 는 tx 밖) →
   * 읽기(@Transactional). 각 단계를 분리 호출해 프록시 경유 @Transactional 로 GUC 가 주입되도록
   * 한다(self-invocation·bare-read 시 RLS fail-closed 회피). agent 미설정/빈 요약은 service 가 4xx/5xx 예외로 전파.
   */
  @PostMapping("/{number}/ai-summary")
  @RequirePermission("project:read")
  public ResponseEntity<IssueAiContext> generateAiSummary(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    Long callerId = (Long) auth.getPrincipal();
    long issueId = issueService.resolveAccessibleIssueId(callerId, key, number);
    aiSummaryService.generateOnDemand(issueId);
    return ResponseEntity.ok(issueService.get(callerId, key, number).aiContext());
  }
}
