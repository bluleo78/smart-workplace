package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueLookupItem;
import com.workplace.issue.service.IssueRelationService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 관계 대상 찾기(WP-887) — 관계 추가 창이 호출자가 읽을 수 있는 모든 프로젝트에서 키({@code WPV-28})·번호({@code #12})·제목으로 이슈를
 * 고른다. 프로젝트를 가로지르므로 프로젝트 경로 밖에 둔다.
 */
@RestController
@RequestMapping("/api/v1/issues")
@RequiredArgsConstructor
public class IssueLookupController {

  private final IssueRelationService relationService;

  /**
   * 최대 20건, 최신 수정순. q 가 비면 빈 목록. from 은 현재 이슈의 프로젝트 키 — 개인 프로젝트면 그 프로젝트 안에서만, 아니면 읽을 수 있는 비개인 프로젝트
   * 전부에서 찾는다(걸 수 없는 이슈를 제안하지 않게). type(유형 이름, 예: EPIC)·openOnly(완료·취소 제외)·excludeFrom(from 프로젝트
   * 제외)은 상한 전에 거는 선택 거름이다 — 상위 에픽 고르기가 다른 프로젝트의 열린 에픽만 찾을 때 쓴다(WP-1039).
   */
  @GetMapping("/lookup")
  @RequirePermission("project:read")
  public ResponseEntity<List<IssueLookupItem>> lookup(
      Authentication auth,
      @RequestParam(required = false) String q,
      @RequestParam(required = false) String from,
      @RequestParam(required = false) String type,
      @RequestParam(defaultValue = "false") boolean openOnly,
      @RequestParam(defaultValue = "false") boolean excludeFrom) {
    return ResponseEntity.ok(
        relationService.lookup((Long) auth.getPrincipal(), q, from, type, openOnly, excludeFrom));
  }
}
