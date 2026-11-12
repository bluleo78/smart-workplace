package com.workplace.drive.controller;

import com.workplace.drive.dto.DrivePlaybackUrlResponse;
import com.workplace.drive.service.DrivePlaybackService;
import com.workplace.global.security.RequireWebSession;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 드라이브 재생 주소 발급(WP-1532, 로그인 필요). 미리보기가 영상·오디오를 blob 으로 다 받지 않고 이 주소를 미디어 요소에 바로 넣어 재생한다.
 *
 * <p>POST 인 이유 — 발급이 감사 로그를 남기는 쓰기이고, 링크 미리보기·프리페치가 GET 으로 불러 감사가 쌓이지 않게 한다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive")
public class DrivePlaybackController {
  private final DrivePlaybackService playback;

  /**
   * 볼 수 있는 영상·오디오 파일의 봉인 재생 주소. 볼 수 없으면 404, 재생 목록 밖 형식이면 409.
   *
   * <p>웹 로그인 세션 전용({@link RequireWebSession}) — PAT·AI 키·Internal 인증은 403. 재생 주소는 4시간 동안 인증 없이 열리는
   * 자격이라, 회수할 수 있는 API 토큰으로 만들어 두면 토큰을 회수해도 주소가 남는다(WP-597·WP-845 와 같은 기준). 웹 미리보기만 이 주소를 쓴다.
   */
  @RequireWebSession
  @PostMapping("/files/{id}/playback-url")
  public ResponseEntity<DrivePlaybackUrlResponse> issue(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId) {
    return ResponseEntity.ok(playback.issue(callerId, driveFileId));
  }
}
