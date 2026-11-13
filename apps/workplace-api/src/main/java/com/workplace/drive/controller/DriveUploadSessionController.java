package com.workplace.drive.controller;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.StartUploadSessionRequest;
import com.workplace.drive.dto.UploadChunkResponse;
import com.workplace.drive.dto.UploadSessionResponse;
import com.workplace.drive.exception.DriveUploadSessionNotFoundException;
import com.workplace.drive.service.DriveUploadSessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.io.IOException;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 드라이브 나눠 올리기(이어 올리기, WP-1520) API — 시작 → 조각 PUT(offset) → 상태 조회 → 완료 / 취소. 모두 인증이 필요하고 세션 소유자만 쓸 수
 * 있다(남의 세션은 404). 20MB 이하 파일은 화면이 기존 멀티파트 업로드를 그대로 쓴다.
 *
 * <p>조각 본문은 {@code @RequestBody byte[]} 가 아니라 요청 스트림으로 받는다 — 메모리에 통째로 올리지 않고 세면서 임시 파일로 흘려보낸다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive")
public class DriveUploadSessionController {
  private final DriveUploadSessionService uploadSessions;

  /** 세션 시작 — 권한·폴더·범주 한도·회사 용량을 바이트 전에 본다. 201 + 세션 상태. */
  @PostMapping("/spaces/{spaceId}/upload-sessions")
  public ResponseEntity<UploadSessionResponse> start(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("spaceId") long spaceId,
      @Valid @RequestBody StartUploadSessionRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(uploadSessions.start(callerId, spaceId, req));
  }

  /** 상태 조회(재개) — 지금 받은 바이트. 없음·만료·남의 것은 404. */
  @GetMapping("/upload-sessions/{id}")
  public UploadSessionResponse status(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") String id) {
    return uploadSessions.status(callerId, parseId(id));
  }

  /** 조각 PUT — offset 이 받은 바이트와 같을 때만 이어 쓴다(다르면 409 + receivedBytes). */
  @PutMapping("/upload-sessions/{id}/chunks")
  public UploadChunkResponse putChunk(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") String id,
      @RequestParam("offset") long offset,
      HttpServletRequest request)
      throws IOException {
    long received =
        uploadSessions.receiveChunk(
            callerId,
            parseId(id),
            offset,
            request.getContentLengthLong(),
            request.getInputStream());
    return new UploadChunkResponse(received);
  }

  /** 완료 — 다 받았으면 드라이브 파일로 저장한다. 201 + 일반 업로드와 같은 DriveFileResponse. */
  @PostMapping("/upload-sessions/{id}/complete")
  public ResponseEntity<DriveFileResponse> complete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") String id) throws IOException {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(uploadSessions.complete(callerId, parseId(id)));
  }

  /** 취소 — 세션과 받아 둔 바이트를 지운다. 204. */
  @DeleteMapping("/upload-sessions/{id}")
  public ResponseEntity<Void> cancel(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") String id) {
    uploadSessions.cancel(callerId, parseId(id));
    return ResponseEntity.noContent().build();
  }

  /** 경로의 세션 id — UUID 형식이 아니면 없는 세션과 같은 404(형식 오류 400 으로 존재 여부 단서를 주지 않는다). */
  private static UUID parseId(String id) {
    try {
      return UUID.fromString(id);
    } catch (IllegalArgumentException e) {
      throw new DriveUploadSessionNotFoundException();
    }
  }
}
