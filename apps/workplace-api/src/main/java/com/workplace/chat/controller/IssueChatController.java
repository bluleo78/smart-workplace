package com.workplace.chat.controller;

import com.workplace.chat.dto.ChatThreadResponse;
import com.workplace.chat.service.ChatThreadService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 컨텍스트의 chat thread 조회 (lazy 생성). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/projects/{key}/issues/{number}/chat")
public class IssueChatController {

  private final ChatThreadService threadService;

  @GetMapping("/thread")
  public ResponseEntity<ChatThreadResponse> getOrCreate(
      @AuthenticationPrincipal Long callerId, @PathVariable String key, @PathVariable int number) {
    return ResponseEntity.ok(threadService.getOrCreate(callerId, key, number));
  }
}
