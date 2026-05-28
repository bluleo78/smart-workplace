package com.workplace.chat.controller;

import com.workplace.chat.dto.AddChatMemberRequest;
import com.workplace.chat.service.ChatMembershipService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** chat thread 멤버 추가/탈퇴. 본인 탈퇴만 허용, 타인 탈퇴 시 403. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/chat/threads/{id}/members")
public class ChatThreadMemberController {

  private final ChatMembershipService membershipService;

  @PostMapping
  public ResponseEntity<Void> add(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long threadId,
      @Valid @RequestBody AddChatMemberRequest req) {
    membershipService.add(callerId, threadId, req.userId());
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/{userId}")
  public ResponseEntity<Void> leave(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long threadId,
      @PathVariable long userId) {
    if (userId != callerId) {
      return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
    }
    membershipService.leave(callerId, threadId);
    return ResponseEntity.noContent().build();
  }
}
