package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueBodyImageResponse;
import com.workplace.issue.service.IssueBodyImageService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** 이슈 본문 이미지 API(WP-199). 프로젝트 단위 인가(생성 가능자)는 서비스가 전담하고, 전역 권한은 이슈 첨부 업로드와 같은 issue:write 를 쓴다. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issue-images")
@RequiredArgsConstructor
public class IssueBodyImageController {

  private final IssueBodyImageService service;

  @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @RequirePermission("issue:write")
  public ResponseEntity<IssueBodyImageResponse> upload(
      @AuthenticationPrincipal Long callerId,
      @PathVariable String key,
      @RequestParam("file") MultipartFile file) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.upload(callerId, key, file));
  }
}
