package com.workplace.home.controller;

import com.workplace.home.dto.HomeProposalOutcome;
import com.workplace.home.dto.HomeProposalResponse;
import com.workplace.home.service.HomeProposalService;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 홈 AI 채팅 확인카드 — 복원·승인·거부(#843). 기존 {@code /home/actions/confirm}(제안 id 없이 params 를 그대로 받던 중복 경로)을
 * 대체한다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/home")
public class HomeProposalController {
  private final HomeProposalService proposalService;

  /** 세션의 미처리 확인카드 — 새로고침·세션 복원 시 카드 재표시. */
  @GetMapping("/sessions/{sessionId}/proposals")
  public List<HomeProposalResponse> pending(
      @AuthenticationPrincipal Long callerId, @PathVariable UUID sessionId) {
    return proposalService.listPending(callerId, sessionId);
  }

  /** 승인 — 실행 실패도 200(status=FAILED + 사유). 없음 404 · 이미 처리됨 409. */
  @PostMapping("/proposals/{id}/confirm")
  public HomeProposalOutcome confirm(
      @AuthenticationPrincipal Long callerId, @PathVariable long id) {
    return proposalService.confirm(callerId, id);
  }

  /** 거부 — REJECTED + 이력 기록. 없음 404 · 이미 처리됨 409. */
  @PostMapping("/proposals/{id}/reject")
  public HomeProposalOutcome reject(@AuthenticationPrincipal Long callerId, @PathVariable long id) {
    return proposalService.reject(callerId, id);
  }
}
