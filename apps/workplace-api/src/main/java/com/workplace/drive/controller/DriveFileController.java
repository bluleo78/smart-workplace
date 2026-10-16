package com.workplace.drive.controller;

import com.workplace.drive.dto.CreateTextFileRequest;
import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveFileVersionResponse;
import com.workplace.drive.dto.FileSummaryResponse;
import com.workplace.drive.dto.RenameFileRequest;
import com.workplace.drive.dto.TargetFolderRequest;
import com.workplace.drive.dto.UpdateTextFileRequest;
import com.workplace.drive.service.DriveFileService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.fileai.controller.ViewImageResponses;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.service.AttachmentViewService;
import com.workplace.filepreview.PreviewResponses;
import com.workplace.filepreview.service.FilePreviewService;
import jakarta.validation.Valid;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** 드라이브 파일 업로드/다운로드/이름 변경/삭제 API. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive")
public class DriveFileController {
  private final DriveFileService fileService;

  private final AttachmentViewService attachmentView;

  private final FilePreviewService previewService;

  @PostMapping(value = "/spaces/{id}/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ResponseEntity<DriveFileResponse> upload(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @RequestParam(value = "folderId", required = false) Long folderId,
      @RequestParam("file") MultipartFile file)
      throws IOException {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(fileService.upload(callerId, spaceId, folderId, file));
  }

  /**
   * 텍스트로 파일 만들기(WP-369) — 본문의 content 를 UTF-8 파일로 저장한다(EDITOR 이상). 같은 이름이 있으면 새 버전. 201 + 업로드와 같은
   * DriveFileResponse.
   */
  @PostMapping("/spaces/{id}/files/text")
  public ResponseEntity<DriveFileResponse> createText(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @Valid @RequestBody CreateTextFileRequest req)
      throws IOException {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            fileService.createTextFile(
                callerId, spaceId, req.folderId(), req.name(), req.content(), req.mimeType()));
  }

  /**
   * 기존 파일을 텍스트 내용으로 갱신(WP-369) — 그 파일에 새 버전을 더한다(EDITOR 이상, 이름·폴더는 그대로). 텍스트 계열이 아닌 파일은 409. 200 +
   * versionCount 가 늘어난 DriveFileResponse(롤백과 같이 기존 자원 갱신이라 200).
   */
  @PostMapping("/files/{id}/text")
  public ResponseEntity<DriveFileResponse> updateText(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @Valid @RequestBody UpdateTextFileRequest req)
      throws IOException {
    return ResponseEntity.ok(
        fileService.updateTextFile(callerId, driveFileId, req.content(), req.mimeType()));
  }

  @GetMapping("/files/{id}/download")
  public ResponseEntity<Resource> download(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId)
      throws IOException {
    FileContentResult c = fileService.download(callerId, driveFileId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(c.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.attachment().filename(c.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(c.size());
    return ResponseEntity.ok().headers(headers).body(c.resource());
  }

  /** 인라인 미리보기 — download 와 동일 콘텐츠를 inline disposition 으로 서빙. */
  @GetMapping("/files/{id}/content")
  public ResponseEntity<Resource> content(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId)
      throws IOException {
    FileContentResult c = fileService.download(callerId, driveFileId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(c.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.inline().filename(c.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(c.size());
    return ResponseEntity.ok().headers(headers).body(c.resource());
  }

  /** 썸네일 — 없으면 404(프론트가 원본 인라인으로 폴백). */
  @GetMapping("/files/{id}/thumbnail")
  public ResponseEntity<Resource> thumbnail(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId)
      throws IOException {
    Optional<FileContentResult> opt = fileService.thumbnail(callerId, driveFileId);
    if (opt.isEmpty()) {
      return ResponseEntity.notFound().build();
    }
    FileContentResult c = opt.get();
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.IMAGE_PNG);
    headers.setContentLength(c.size());
    return ResponseEntity.ok().headers(headers).body(c.resource());
  }

  @DeleteMapping("/files/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId) {
    fileService.delete(callerId, driveFileId);
    return ResponseEntity.noContent().build();
  }

  /** 파일 이름 변경(WP-335) — 같은 폴더 동명 활성 파일이 있으면 409. */
  @PatchMapping("/files/{id}")
  public ResponseEntity<DriveFileResponse> rename(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @Valid @RequestBody RenameFileRequest req) {
    return ResponseEntity.ok(fileService.rename(callerId, driveFileId, req.name()));
  }

  @PatchMapping("/files/{id}/move")
  public ResponseEntity<Void> move(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @RequestBody TargetFolderRequest req) {
    fileService.move(callerId, driveFileId, req.targetFolderId());
    return ResponseEntity.noContent().build();
  }

  /** 파일 콘텐츠 요약(#526) — 파이프라인이 저장한 요약·상태 조회. download 와 동일 게이트. */
  @GetMapping("/files/{id}/summary")
  public ResponseEntity<FileSummaryResponse> summary(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId) {
    return ResponseEntity.ok(fileService.fileSummary(callerId, driveFileId));
  }

  /**
   * 파일 추출 텍스트 구간 읽기(WP-346) — 이슈 첨부 /text 와 같은 요청·응답 형식. 에이전트가 PDF·오피스 파일을 글자로 나눠 읽는다. limit 상한
   * 32,000자(초과분은 클램프). download 와 동일 게이트.
   */
  @GetMapping("/files/{id}/text")
  public ResponseEntity<ExtractedTextSlice> readText(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @RequestParam(defaultValue = "0") int offset,
      @RequestParam(defaultValue = "32000") int limit) {
    return ResponseEntity.ok(fileService.readText(callerId, driveFileId, offset, limit));
  }

  /** 첨부를 모델 입력용 이미지로 보여 준다(WP-250) — 규칙·권한·트랜잭션(R5)은 {@link AttachmentViewService} 참조. */
  @GetMapping("/files/{id}/view")
  public ResponseEntity<byte[]> view(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @RequestParam(required = false) Integer page) {
    return ViewImageResponses.of(
        attachmentView.view(fileService.resolveViewFileId(callerId, driveFileId), page));
  }

  /**
   * 문서 미리보기(서버 변환 PDF, WP-431) — HWP·HWPX·PPTX·PPT·DOC 를 원래 모양 그대로 보여 준다. 권한은 /view 와 같은 가드(VIEWER
   * 이상, 비멤버는 존재 은닉 404)를 거친 현재 버전 core file.id 로 판정한다.
   *
   * <p>응답 계약(200·202·422·404 NOT_APPLICABLE, ETag·304)은 {@link PreviewResponses} 가 맡는다. ETag 는
   * {@code "<core file id>-<엔진 버전>-<PDF 수정 시각>"} — 원본 새 버전이면 drive 파일 id 가 같아도 달라진다. 휴지통·권한 없음·원본
   * 유실은 예외 봉투의 다른 404 다.
   *
   * @param start 시도의 첫 요청(뷰어 열기·[다시 시도])이면 true — 이때만 실패 행을 다시 선점한다. 폴링은 생략
   */
  @GetMapping("/files/{id}/preview")
  public ResponseEntity<?> preview(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @RequestParam(defaultValue = "false") boolean start) {
    long fileId = fileService.resolveViewFileId(callerId, driveFileId);
    return PreviewResponses.of(previewService.open(fileId, start));
  }

  /** 버전 이력 목록(#79). */
  @GetMapping("/files/{id}/versions")
  public ResponseEntity<java.util.List<DriveFileVersionResponse>> versions(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId) {
    return ResponseEntity.ok(fileService.listVersions(callerId, driveFileId));
  }

  /** 특정 버전 다운로드(#79). */
  @GetMapping("/files/{id}/versions/{versionNo}/download")
  public ResponseEntity<Resource> downloadVersion(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @PathVariable("versionNo") int versionNo)
      throws IOException {
    FileContentResult c = fileService.downloadVersion(callerId, driveFileId, versionNo);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(c.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.attachment().filename(c.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(c.size());
    return ResponseEntity.ok().headers(headers).body(c.resource());
  }

  /** 특정 버전으로 롤백(#79) — 새 버전 생성. */
  @PostMapping("/files/{id}/versions/{versionNo}/rollback")
  public ResponseEntity<DriveFileResponse> rollback(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @PathVariable("versionNo") int versionNo)
      throws IOException {
    return ResponseEntity.ok(fileService.rollback(callerId, driveFileId, versionNo));
  }

  @PostMapping("/files/{id}/copy")
  public ResponseEntity<DriveFileResponse> copy(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @RequestBody TargetFolderRequest req)
      throws IOException {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(fileService.copy(callerId, driveFileId, req.targetFolderId()));
  }
}
