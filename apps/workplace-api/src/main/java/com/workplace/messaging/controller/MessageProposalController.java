package com.workplace.messaging.controller;

import com.workplace.messaging.dto.ConfirmProposalRequest;
import com.workplace.messaging.dto.CreateProposalRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.dto.ProjectCandidateDto;
import com.workplace.messaging.service.MessagingProposalService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** 채팅 L3 위임 제안 — AI(on-behalf AGENT)가 제안 생성, 위임자가 승인/거부. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class MessageProposalController {

  private final MessagingProposalService proposalService;

  /** AI 제안 생성(내부 on-behalf AGENT). principal = AGENT id. */
  @PostMapping("/channels/{channelId}/proposals")
  public ResponseEntity<MessageResponse> propose(
      @AuthenticationPrincipal Long agentId,
      @PathVariable long channelId,
      @Valid @RequestBody CreateProposalRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(proposalService.propose(agentId, channelId, request));
  }

  /** 위임자 승인 — principal = 위임자(사람). 이슈 생성 + 결과 메시지 게시. body.projectKey 로 팀 프로젝트 override 가능. */
  @PostMapping("/proposals/{id}/confirm")
  public ResponseEntity<MessageResponse> confirm(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @RequestBody(required = false) ConfirmProposalRequest body) {
    return ResponseEntity.ok(
        proposalService.confirm(callerId, id, body == null ? null : body.projectKey()));
  }

  /** 위임자 거부 — 제안 REJECTED, 결과 메시지 없음. */
  @PostMapping("/proposals/{id}/reject")
  public ResponseEntity<MessageResponse> reject(
      @AuthenticationPrincipal Long callerId, @PathVariable long id) {
    return ResponseEntity.ok(proposalService.reject(callerId, id));
  }

  /** AI prefetch — 위임 후보 프로젝트 목록(on-behalf AGENT=principal, delegatorId=쿼리). */
  @GetMapping("/delegation-candidates")
  public List<ProjectCandidateDto> candidates(
      @AuthenticationPrincipal Long agentId, @RequestParam long delegatorId) {
    return proposalService.candidateProjects(delegatorId, agentId);
  }
}
