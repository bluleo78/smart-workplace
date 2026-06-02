package com.workplace.messaging.controller;

import com.workplace.messaging.dto.ReactionRequest;
import com.workplace.messaging.service.ReactionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 메시지 이모지 리액션 토글. 추가=POST(body emoji), 제거=DELETE(query emoji). 모두 204. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class ReactionController {

  private final ReactionService reactionService;

  @PostMapping("/messages/{id}/reactions")
  public ResponseEntity<Void> add(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long messageId,
      @Valid @RequestBody ReactionRequest req) {
    reactionService.add(callerId, messageId, req.emoji());
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/messages/{id}/reactions")
  public ResponseEntity<Void> remove(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long messageId,
      @RequestParam String emoji) {
    reactionService.remove(callerId, messageId, emoji);
    return ResponseEntity.noContent().build();
  }
}
