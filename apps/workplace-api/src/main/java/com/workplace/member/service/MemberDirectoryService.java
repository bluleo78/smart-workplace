package com.workplace.member.service;

import com.workplace.global.dto.PageResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.member.dto.MemberSummary;
import com.workplace.member.repository.MemberDirectoryRepository;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 구성원 디렉터리 서비스 (#833).
 *
 * <p>테넌트 경계를 이 레이어에서 확정한다 — user/membership 은 RLS 비대상 전역 테이블이라 컨텍스트를 읽어 명시적으로 넘기지 않으면 경계가 사라진다. 인증된
 * 요청이므로 active 테넌트가 반드시 있어야 한다.
 */
@Service
@RequiredArgsConstructor
public class MemberDirectoryService {

  private final MemberDirectoryRepository repository;

  @Transactional(readOnly = true)
  public PageResponse<MemberSummary> list(
      String search, String kind, boolean includeInactive, int page, int size) {
    long tenantId = TenantContext.require();
    List<MemberSummary> content =
        repository.findPage(tenantId, search, kind, includeInactive, page * size, size);
    // 카운트도 같은 검색·필터 조건으로 — 조건이 갈라지면 검색 중 totalPages 가 부풀어 빈 페이지가 생긴다.
    int total = repository.count(tenantId, search, kind, includeInactive);
    return new PageResponse<>(content, page, size, total, (int) Math.ceil((double) total / size));
  }

  @Transactional(readOnly = true)
  public Optional<MemberSummary> get(long userId) {
    return repository.findOne(TenantContext.require(), userId);
  }
}
