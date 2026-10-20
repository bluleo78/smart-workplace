package com.workplace.audit.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.audit.dto.AuditLogResponse;
import com.workplace.audit.repository.AuditLogRepository;
import com.workplace.global.dto.PageResponse;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jooq.JSONB;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@Slf4j
public class AuditLogService {

  private final AuditLogRepository auditLogRepository;
  private final ObjectMapper objectMapper;

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
    String previous = auditLogRepository.currentTenantGuc();
    auditLogRepository.setTenantGuc(String.valueOf(tenantId));
    try {
      return log(
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
          metadata);
    } finally {
      auditLogRepository.setTenantGuc(previous == null ? "" : previous);
    }
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
