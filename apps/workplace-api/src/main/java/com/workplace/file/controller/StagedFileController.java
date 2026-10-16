package com.workplace.file.controller;

import com.workplace.file.dto.CreateStagedLinkRequest;
import com.workplace.file.dto.CreateStagedTextRequest;
import com.workplace.file.dto.StagedFileResponse;
import com.workplace.file.dto.StagedUploadLinkResponse;
import com.workplace.file.service.StagedUploadService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 스테이징 파일 API(WP-421) — 이슈·메시지·노트 등에 붙일 파일을 먼저 올려 두는 임시 첨부. 인증만 요구하고 권한 어노테이션은 두지 않는다: 파일을 묶는 쪽
 * 도메인이 클레임 때 자기 권한을 본다. 서비스만 주입하므로 컨트롤러에 {@code @Transactional} 이 필요 없다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/staged-files")
public class StagedFileController {
  private final StagedUploadService service;

  /** 텍스트로 스테이징 파일 만들기 → 201 + fileId(24시간 안에 클레임하지 않으면 지워진다). */
  @PostMapping("/text")
  public ResponseEntity<StagedFileResponse> createText(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody CreateStagedTextRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.createText(callerId, req.name(), req.content()));
  }

  /** 일회용 PUT 링크 발급 → 201 + 10분짜리 URL(평문 토큰 포함, 이 응답에서만). {@code curl -T 파일 URL} 로 올린다. */
  @PostMapping("/upload-link")
  public ResponseEntity<StagedUploadLinkResponse> createUploadLink(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody CreateStagedLinkRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.issueLink(callerId, req.name()));
  }
}
