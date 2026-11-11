package com.workplace.wiki.controller;

import com.workplace.wiki.dto.LinkProjectSpaceRequest;
import com.workplace.wiki.dto.WikiProjectSpaceResponse;
import com.workplace.wiki.service.ProjectNoteSpaceService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 프로젝트 노트 공간 API(WP-1480) — 프로젝트 화면(노트 탭·설정, WP-1481)이 그 프로젝트의 노트 공간을 찾고, 프로젝트 소유자가 기존 팀 공간을 프로젝트
 * 공간으로 연결한다. 권한 판정은 서비스가 한다(공간 멤버만 조회, 연결은 프로젝트 OWNER + 대상 공간 OWNER).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/wiki/project-spaces")
public class WikiProjectSpaceController {
  private final ProjectNoteSpaceService service;

  /** 프로젝트의 노트 공간 요약 — 공간 멤버(= 프로젝트 멤버)만, 아니면 404. */
  @GetMapping("/{projectKey}")
  public ResponseEntity<WikiProjectSpaceResponse> get(
      @AuthenticationPrincipal Long callerId, @PathVariable("projectKey") String projectKey) {
    return ResponseEntity.ok(service.get(callerId, projectKey));
  }

  /** 기존 팀 공간을 프로젝트 노트 공간으로 연결 — 자동 공간의 「리포트」를 옮기고 멤버를 프로젝트에 맞춘다. */
  @PutMapping("/{projectKey}/link")
  public ResponseEntity<WikiProjectSpaceResponse> link(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("projectKey") String projectKey,
      @Valid @RequestBody LinkProjectSpaceRequest req) {
    return ResponseEntity.ok(service.link(callerId, projectKey, req.spaceId()));
  }
}
