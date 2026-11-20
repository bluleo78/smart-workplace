package com.workplace.airun.controller;

import com.workplace.airun.dto.AiRunBatchRequest;
import com.workplace.airun.dto.AiRunBatchResponse;
import com.workplace.airun.service.AiRunRecorder;
import com.workplace.global.outbound.AiAgentProperties;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI 처리 기록 묶음 수신(WP-1827) — ai-agent 등 내부 서비스가 보고한다.
 *
 * <p>SecurityConfig 에서 permitAll 이므로 컨트롤러가 {@code Authorization: Internal {token}} 을 상수 시간으로 직접
 * 검증한다.
 */
@RestController
@RequestMapping("/api/v1/internal/ai-runs")
public class AiRunInternalController {

  /** 한 요청 최대 건수 — 넘으면 400. */
  static final int MAX_RUNS = 500;

  private final AiRunRecorder recorder;
  private final AiAgentProperties aiAgentProperties;

  public AiRunInternalController(AiRunRecorder recorder, AiAgentProperties aiAgentProperties) {
    this.recorder = recorder;
    this.aiAgentProperties = aiAgentProperties;
  }

  /** 묶음을 저장하고 수락·버림 건수를 돌려준다. 토큰 불일치 401, runs 없음·500건 초과 400. */
  @PostMapping
  public ResponseEntity<AiRunBatchResponse> receive(
      @RequestBody AiRunBatchRequest body, HttpServletRequest request) {
    if (!validateInternalToken(request)) {
      return ResponseEntity.status(401).build();
    }
    if (body == null || body.runs() == null || body.runs().size() > MAX_RUNS) {
      return ResponseEntity.badRequest().build();
    }
    return ResponseEntity.ok(recorder.ingest(body.runs()));
  }

  /**
   * Authorization: Internal {token} 을 길이 확인 후 MessageDigest.isEqual 로 비교한다(WorkerCallbackController
   * 와 같은 방식).
   */
  private boolean validateInternalToken(HttpServletRequest request) {
    String token = aiAgentProperties.internalToken();
    if (!StringUtils.hasText(token)) return false;
    String authHeader = request.getHeader("Authorization");
    if (authHeader == null || !authHeader.startsWith("Internal ")) return false;
    byte[] a = authHeader.substring(9).getBytes(StandardCharsets.UTF_8);
    byte[] b = token.getBytes(StandardCharsets.UTF_8);
    return a.length == b.length && MessageDigest.isEqual(a, b);
  }
}
