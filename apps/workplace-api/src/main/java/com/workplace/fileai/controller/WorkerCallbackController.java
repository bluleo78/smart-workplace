package com.workplace.fileai.controller;

import com.workplace.fileai.outbound.WorkerProperties;
import com.workplace.fileai.service.FileExtractionPipeline;
import com.workplace.fileai.service.FileExtractionPipeline.ExtractResult;
import com.workplace.global.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 워커→api 콜백 수신 컨트롤러.
 *
 * <p>/internal/** 는 SecurityConfig 에서 anyRequest().permitAll() 에 해당하므로 Spring Security 의 인증 없이 도달.
 * 따라서 컨트롤러에서 직접 Authorization: Internal {token} 헤더를 검증한다(JwtAuthenticationFilter 의 상수 시간 비교 패턴 미러).
 * WorkerProperties.internalToken() (workplace.worker.internal-token) 을 사용해 워커 전용 설정 키로 바인딩한다.
 */
@Slf4j
@RestController
@RequestMapping("/internal/worker")
@RequiredArgsConstructor
public class WorkerCallbackController {

  private final FileExtractionPipeline pipeline;
  private final WorkerProperties workerProperties;

  /**
   * 워커 추출 완료/실패 콜백. worker_job DONE 마킹 + file_extraction EXTRACTING→TEXT_READY/SKIPPED 전이.
   *
   * <p>스테일 콜백(이미 TEXT_READY 인 경우)은 파이프라인에서 CAS 로 무시한다.
   *
   * <p>C1 RLS 수정: 콜백은 Spring Security 인증 컨텍스트 없이 도달하므로 TenantAwareTransactionManager 가 GUC 를 주입하지
   * 못한다. 워커가 에코한 tenantId 를 TenantContext.set 으로 주입해 applyExtractResult 내의 @Transactional 트랜잭션 시작 시
   * GUC 가 올바르게 설정되도록 한다. null-guard: tenantId 미포함 구형 콜백은 기존 동작(세션 GUC 기본값=1)으로 처리된다.
   */
  @PostMapping("/jobs/{jobId}/result")
  public ResponseEntity<Void> onResult(
      @PathVariable long jobId, @RequestBody ExtractResult result, HttpServletRequest request) {
    if (!validateInternalToken(request)) {
      return ResponseEntity.status(401).build();
    }
    // 워커가 에코한 tenantId 로 TenantContext 복원 → @Transactional 진입 시 RLS GUC 주입
    if (result.tenantId() != null) {
      TenantContext.set(result.tenantId());
    }
    try {
      pipeline.applyExtractResult(jobId, result);
    } finally {
      TenantContext.clear();
    }
    return ResponseEntity.ok().build();
  }

  /**
   * Authorization: Internal {token} 헤더를 상수 시간 비교로 검증한다(JwtAuthenticationFilter 패턴 미러).
   *
   * <p>WorkerProperties.internalToken() (workplace.worker.internal-token) 으로 워커 전용 설정 키를 사용한다. 길이
   * 정규화 후 MessageDigest.isEqual 로 타이밍 공격을 방어한다.
   */
  private boolean validateInternalToken(HttpServletRequest request) {
    String token = workerProperties.internalToken();
    if (!StringUtils.hasText(token)) return false;
    String authHeader = request.getHeader("Authorization");
    if (authHeader == null || !authHeader.startsWith("Internal ")) return false;
    String provided = authHeader.substring(9);
    byte[] a = provided.getBytes(StandardCharsets.UTF_8);
    byte[] b = token.getBytes(StandardCharsets.UTF_8);
    return a.length == b.length && MessageDigest.isEqual(a, b);
  }
}
