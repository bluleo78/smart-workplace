package com.workplace.issue.controller;

import com.workplace.drive.dto.DriveLinkResponse;
import com.workplace.file.service.FileUploadService;
import com.workplace.fileai.security.FileSecurityCheckService;
import com.workplace.fileai.security.dto.SecurityCheckView;
import com.workplace.filepreview.PreviewResponses;
import com.workplace.filepreview.service.FilePreviewService;
import com.workplace.global.security.RequirePermission;
import com.workplace.issue.service.IssueDriveLinkService;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** 이슈 드라이브 링크 엔드포인트. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/drive-links")
@RequiredArgsConstructor
public class IssueDriveLinkController {

  private final IssueDriveLinkService service;

  private final FileSecurityCheckService securityChecks;

  private final FilePreviewService previewService;

  /** 드라이브 링크 추가 요청 바디. */
  public record AddDriveLinkRequest(long driveFileId) {}

  /** 이슈에 드라이브 파일 링크 추가. */
  @PostMapping
  @RequirePermission("issue:write")
  public ResponseEntity<Void> add(
      @AuthenticationPrincipal Long callerId,
      @PathVariable String key,
      @PathVariable int number,
      @RequestBody AddDriveLinkRequest req) {
    service.add(callerId, key, number, req.driveFileId());
    return ResponseEntity.noContent().build();
  }

  /** 이슈에 연결된 드라이브 파일 목록 조회. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<DriveLinkResponse>> list(
      @AuthenticationPrincipal Long callerId, @PathVariable String key, @PathVariable int number) {
    return ResponseEntity.ok(service.list(callerId, key, number));
  }

  /** 이슈 드라이브 링크 삭제. */
  @DeleteMapping("/{driveFileId}")
  @RequirePermission("issue:write")
  public ResponseEntity<Void> remove(
      @AuthenticationPrincipal Long callerId,
      @PathVariable String key,
      @PathVariable int number,
      @PathVariable long driveFileId) {
    service.remove(callerId, key, number, driveFileId);
    return ResponseEntity.noContent().build();
  }

  /** 이슈 링크 드라이브 파일 다운로드. 이슈 멤버십으로 인가. */
  @GetMapping("/{driveFileId}/content")
  @RequirePermission("project:read")
  public ResponseEntity<Resource> content(
      @AuthenticationPrincipal Long callerId,
      @PathVariable String key,
      @PathVariable int number,
      @PathVariable long driveFileId)
      throws IOException {
    FileUploadService.FileContentResult f = service.content(callerId, key, number, driveFileId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(f.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.attachment().filename(f.originalName(), StandardCharsets.UTF_8).build());
    return ResponseEntity.ok().headers(headers).body(f.resource());
  }

  /**
   * 링크된 드라이브 파일의 문서 미리보기(서버 변환 PDF, WP-1457) — /content 와 같은 이슈 조회 가드·링크 확인으로 그 파일의 현재 core file id
   * 를 얻는다. 응답 계약은 {@link PreviewResponses}(드라이브와 같음).
   *
   * @param start 시도의 첫 요청이면 true — 이때만 실패 행을 다시 선점한다. 폴링은 생략
   */
  @GetMapping("/{driveFileId}/preview")
  @RequirePermission("project:read")
  public ResponseEntity<?> preview(
      @AuthenticationPrincipal Long callerId,
      @PathVariable String key,
      @PathVariable int number,
      @PathVariable long driveFileId,
      @RequestParam(defaultValue = "false") boolean start) {
    long fileId = service.linkFileId(callerId, key, number, driveFileId);
    return PreviewResponses.of(previewService.open(fileId, start));
  }

  /** 링크된 드라이브 파일의 HTML 보안 점검 상태(WP-1262) — /content 와 같은 이슈 조회 가드·링크 확인. */
  @GetMapping("/{driveFileId}/security-check")
  @RequirePermission("project:read")
  public SecurityCheckView securityCheck(
      @AuthenticationPrincipal Long callerId,
      @PathVariable String key,
      @PathVariable int number,
      @PathVariable long driveFileId) {
    return securityChecks.view(service.linkFileId(callerId, key, number, driveFileId));
  }

  /** 링크된 드라이브 파일의 HTML 보안 점검 요청(WP-1262) — 가드는 조회와 같다. */
  @PostMapping("/{driveFileId}/security-check")
  @RequirePermission("project:read")
  public SecurityCheckView requestSecurityCheck(
      @AuthenticationPrincipal Long callerId,
      @PathVariable String key,
      @PathVariable int number,
      @PathVariable long driveFileId) {
    return securityChecks.request(service.linkFileId(callerId, key, number, driveFileId));
  }
}
