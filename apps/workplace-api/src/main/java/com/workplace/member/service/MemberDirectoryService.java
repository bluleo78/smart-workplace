package com.workplace.member.service;

import com.workplace.global.dto.PageResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.UnicodeNames;
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

  /**
   * 보는 사람 없이 부르는 목록 — 개인 비서는 모두 뺀다(WP-638, {@link #list(Long, String, String, boolean, int, int)}).
   */
  @Transactional(readOnly = true)
  public PageResponse<MemberSummary> list(
      String search, String kind, boolean includeInactive, int page, int size) {
    return list(null, search, kind, includeInactive, page, size);
  }

  /**
   * 구성원 목록. viewerId(보는 사람)의 개인 비서만 남기고 남의 개인 비서는 뺀다(WP-638) — 주인 전용 AGENT 가 멘션 후보에 섞여 남이 주인 키로 부르던
   * 문제.
   */
  @Transactional(readOnly = true)
  public PageResponse<MemberSummary> list(
      Long viewerId, String search, String kind, boolean includeInactive, int page, int size) {
    long tenantId = TenantContext.require();
    // 검색어 NFC 정규화(WP-554) — 맥 붙여넣기 등 NFD(자모 분리) 한글이 완성형 저장값과 맞지 않던 것을 맞춘다(UnicodeNames 참조).
    String nfc = UnicodeNames.toNfc(search);
    // offset 은 long 으로 — page×size 가 int 를 넘으면 음수 offset 이 되어 「음수」 400 이 났다(WP-552). 끝을 넘는 page 는 빈
    // 목록.
    List<MemberSummary> content =
        repository.findPage(
            tenantId, viewerId, nfc, kind, includeInactive, (long) page * size, size);
    // 카운트도 같은 검색·필터 조건으로 — 조건이 갈라지면 검색 중 totalPages 가 부풀어 빈 페이지가 생긴다.
    int total = repository.count(tenantId, viewerId, nfc, kind, includeInactive);
    return new PageResponse<>(content, page, size, total, (int) Math.ceil((double) total / size));
  }

  @Transactional(readOnly = true)
  public Optional<MemberSummary> get(long userId) {
    return repository.findOne(TenantContext.require(), userId);
  }
}
