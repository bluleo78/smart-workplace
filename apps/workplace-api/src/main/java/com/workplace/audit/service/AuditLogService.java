package com.workplace.audit.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.audit.dto.AuditLogResponse;
import com.workplace.audit.repository.AuditLogRepository;
import com.workplace.global.dto.PageResponse;
import com.workplace.global.util.RequestInfo;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jooq.JSONB;
import org.springframework.stereotype.Service;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
@RequiredArgsConstructor
@Slf4j
public class AuditLogService {

  private final AuditLogRepository auditLogRepository;
  private final ObjectMapper objectMapper;

  /**
   * 감사 로그 한 건을 남긴다. ipAddress 를 넘기지 않으면(null) 지금 처리 중인 HTTP 요청의 클라이언트 IP 를 쓴다(WP-706) — 관리 작업 호출부
   * 대부분이 IP 를 넘기지 않아 감사 로그의 IP 열이 로그인 행 말고는 늘 비어 있었다. 요청 밖(스케줄러·비동기)이면 null 그대로.
   */
  public Long log(
      Long userId,
      String username,
      String actionType,
      String resource,
      String resourceId,
      String description,
      String ipAddress,
      String userAgent,
      String result,
      String errorMessage,
      Object metadata) {
    if (ipAddress == null) {
      ipAddress = RequestInfo.current().ip();
    }
    JSONB metadataJsonb = null;
    if (metadata != null) {
      try {
        metadataJsonb = JSONB.jsonb(objectMapper.writeValueAsString(metadata));
      } catch (Exception e) {
        log.warn("Failed to serialize audit metadata", e);
      }
    }

    return auditLogRepository.save(
        userId,
        username,
        actionType,
        resource,
        resourceId,
        description,
        ipAddress,
        userAgent,
        result,
        errorMessage,
        metadataJsonb);
  }

  /**
   * tenantId 워크스페이스의 감사 로그로 남긴다(WP-598). 로그인·워크스페이스 선택은 테넌트를 고르기 전(GUC 없음)이나 다른 테넌트 토큰으로 오는 요청이라
   * 그대로 두면 tenant_id 가 비거나 엉뚱한 곳에 남아, 실제로 들어간 워크스페이스 관리자의 감사 로그에 보이지 않는다.
   *
   * <p>현재 트랜잭션의 GUC 를 잠시 그 테넌트로 바꿔 넣고(tenant_id DEFAULT·RLS WITH CHECK 가 GUC 를 따른다) 이전 값으로 되돌린다. 새
   * 트랜잭션이 아니라 같은 커넥션이라 같은 트랜잭션에서 만든 행도 FK 로 참조할 수 있고, 로그인이 롤백되면 기록도 함께 롤백된다.
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public Long logInTenant(
      long tenantId,
      Long userId,
      String username,
      String actionType,
      String resource,
      String resourceId,
      String description,
      String ipAddress,
      String userAgent,
      String result,
      String errorMessage,
      Object metadata) {
    return withTenantGuc(
        String.valueOf(tenantId),
        () ->
            log(
                userId,
                username,
                actionType,
                resource,
                resourceId,
                description,
                ipAddress,
                userAgent,
                result,
                errorMessage,
                metadata));
  }

  /** 현재 트랜잭션의 GUC 를 잠시 guc 로 바꿔 body 를 돌리고 이전 값으로 되돌린다. 이미 그 값이면 바꾸지 않는다(문장 둘을 아낀다). */
  private Long withTenantGuc(String guc, Supplier<Long> body) {
    String previous = auditLogRepository.currentTenantGuc();
    if (guc.equals(previous == null ? "" : previous)) {
      return body.get();
    }
    auditLogRepository.setTenantGuc(guc);
    try {
      return body.get();
    } finally {
      auditLogRepository.setTenantGuc(previous == null ? "" : previous);
    }
  }

  /**
   * tenantId 가 있으면 그 워크스페이스의 감사로({@link #logInTenant}), 없으면 워크스페이스 없는 행(운영자 열람)으로 남긴다. 인증
   * 감사(로그인·로그아웃·로그인 실패)가 들어갈 워크스페이스를 고르기 전일 수 있어 같은 분기를 호출부마다 되풀이하던 것을 모은다(WP-1161). tenantId 가 있으면
   * 트랜잭션 안에서 불러야 한다.
   */
  public Long logInTenantOrGlobal(
      Long tenantId,
      Long userId,
      String username,
      String actionType,
      String resource,
      String description,
      RequestInfo request,
      String result,
      String errorMessage,
      Object metadata) {
    Supplier<Long> write =
        () ->
            log(
                userId,
                username,
                actionType,
                resource,
                null,
                description,
                request.ip(),
                request.userAgent(),
                result,
                errorMessage,
                metadata);
    boolean inTx = TransactionSynchronizationManager.isActualTransactionActive();
    if (tenantId != null) {
      // 자기 호출이라 logInTenant 의 MANDATORY 가 프록시로 걸리지 않는다 — 같은 조건을 직접 지킨다. 트랜잭션 밖이면 GUC 바꾸기가 INSERT 와
      // 다른
      // 문장으로 흩어져 행이 엉뚱한 워크스페이스에 들어간다.
      if (!inTx) {
        throw new IllegalTransactionStateException("워크스페이스 감사는 트랜잭션 안에서 남겨야 합니다");
      }
      return withTenantGuc(String.valueOf(tenantId), write);
    }
    // 트랜잭션 안이면 GUC 를 비워 워크스페이스 없는 행임을 못 박는다 — 커넥션에 남은 GUC(테스트 DB 의 세션 기본값 등)가 행을 엉뚱한 워크스페이스에 넣지 않게.
    return inTx ? withTenantGuc("", write) : write.get();
  }

  @Transactional(readOnly = true)
  public List<AuditLogResponse> findByResource(
      String actionType, String resource, String resourceId) {
    return auditLogRepository.findByResource(actionType, resource, resourceId);
  }

  @Transactional(readOnly = true)
  public Optional<AuditLogResponse> findById(Long id) {
    return auditLogRepository.findById(id);
  }

  /**
   * 감사 로그 목록 페이지 조회
   *
   * @param userId 특정 사용자 ID 정확 일치 필터 (null이면 무제한, #89)
   * @param startDate 날짜 범위 시작 (null이면 무제한)
   * @param endDate 날짜 범위 종료 (null이면 무제한)
   */
  @Transactional(readOnly = true)
  public PageResponse<AuditLogResponse> getAuditLogs(
      String search,
      Long userId,
      String actionType,
      String resource,
      String result,
      LocalDateTime startDate,
      LocalDateTime endDate,
      int page,
      int size) {
    return auditLogRepository.findAll(
        search, userId, actionType, resource, result, startDate, endDate, page, size);
  }
}
