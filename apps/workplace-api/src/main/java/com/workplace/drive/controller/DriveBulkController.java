package com.workplace.drive.controller;

import com.workplace.drive.dto.BulkDeleteRequest;
import com.workplace.drive.dto.BulkDownloadRequest;
import com.workplace.drive.dto.BulkMoveRequest;
import com.workplace.drive.service.DriveBulkService;
import com.workplace.drive.service.DriveZipService;
import com.workplace.drive.service.DriveZipService.ZipEntrySource;
import com.workplace.global.tenant.TenantContext;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.util.StreamUtils;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/** 드라이브 벌크 작업 — 이동/삭제/ZIP 다운로드. 모두 단일 space scope. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive")
public class DriveBulkController {
  private static final Logger log = LoggerFactory.getLogger(DriveBulkController.class);

  private final DriveBulkService bulkService;
  private final DriveZipService zipService;

  @DeleteMapping("/spaces/{id}/items")
  public ResponseEntity<Void> bulkDelete(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @RequestBody BulkDeleteRequest req) {
    bulkService.bulkDelete(callerId, spaceId, req.fileIds(), req.folderIds());
    return ResponseEntity.noContent().build();
  }

  @PatchMapping("/spaces/{id}/items/move")
  public ResponseEntity<Void> bulkMove(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @RequestBody BulkMoveRequest req) {
    bulkService.bulkMove(callerId, spaceId, req.fileIds(), req.folderIds(), req.targetFolderId());
    return ResponseEntity.noContent().build();
  }

  /**
   * 선택 항목을 ZIP 으로 스트리밍. 엔트리 메타 수집은 트랜잭션 안에서 끝내고, 바이트는 스트리밍 스레드에서 한 파일씩 lazy 하게 연다. 스트리밍 스레드는 요청 스레드
   * 밖이라 TenantContext 가 비므로 캡처한 tenantId 를 다시 설정한다(RLS). 스트림이 이미 200 으로 시작되므로 개별 파일 읽기 실패는 스킵+로그(전체
   * 중단 아님).
   */
  @PostMapping("/spaces/{id}/download-zip")
  public ResponseEntity<StreamingResponseBody> downloadZip(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @RequestBody BulkDownloadRequest req) {
    List<ZipEntrySource> entries =
        zipService.collectEntries(callerId, spaceId, req.fileIds(), req.folderIds());
    Long tenantId = TenantContext.get();
    StreamingResponseBody body =
        out -> {
          if (tenantId != null) {
            TenantContext.set(tenantId);
          }
          try (ZipOutputStream zip = new ZipOutputStream(out)) {
            for (ZipEntrySource e : entries) {
              if (e.directory()) {
                zip.putNextEntry(new ZipEntry(e.path()));
                zip.closeEntry();
                continue;
              }
              try {
                var c = zipService.openContent(e.coreFileId());
                zip.putNextEntry(new ZipEntry(e.path()));
                StreamUtils.copy(c.resource().getInputStream(), zip);
                zip.closeEntry();
              } catch (Exception ex) {
                // 개별 파일 실패는 스킵 — 스트림은 이미 200 이라 상태코드 변경 불가.
                log.warn("ZIP 엔트리 스킵: {} ({})", e.path(), ex.getMessage());
              }
            }
          } finally {
            if (tenantId != null) {
              TenantContext.clear();
            }
          }
        };
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType("application/zip"));
    headers.setContentDisposition(
        ContentDisposition.attachment().filename("drive-export.zip").build());
    return ResponseEntity.ok().headers(headers).body(body);
  }
}
