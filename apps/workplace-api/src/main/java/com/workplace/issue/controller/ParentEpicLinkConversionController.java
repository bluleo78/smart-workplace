package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.ConvertParentEpicLinksRequest;
import com.workplace.issue.dto.ConvertParentEpicLinksResponse;
import com.workplace.issue.service.ParentEpicLinkConversionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 부모 에픽 외부 링크 일괄 변환 API(WP-1038) — 이관 때 남긴 PARENT_EPIC 외부 링크를 실제 부모 관계(다른 프로젝트 에픽 포함)로 바꾼다. 가져오기
 * API 와 같이 사람 관리자 판정은 서비스가 한다(사유 코드 IMPORT_ADMIN_ONLY).
 */
@RestController
@RequestMapping("/api/v1/admin/issues/parent-epic-links")
@RequiredArgsConstructor
public class ParentEpicLinkConversionController {

  private final ParentEpicLinkConversionService service;

  /** 변환(또는 dryRun 판정) — 200 + 판정별 건수·줄별 결과. */
  @PostMapping("/convert")
  @RequirePermission("issue:write")
  public ConvertParentEpicLinksResponse convert(
      Authentication auth, @Valid @RequestBody ConvertParentEpicLinksRequest req) {
    return service.convert((Long) auth.getPrincipal(), req);
  }
}
