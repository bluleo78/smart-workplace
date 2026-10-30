package com.workplace.user.controller;

import com.workplace.user.service.AvatarService;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 공개 아바타 이미지(WP-1222) — 인증 없이 연다(SecurityConfig permitAll). {@code <img src>} 로 바로 쓰여 토큰을 실을 수 없고,
 * 다른 워크스페이스 화면에서도 같은 주소를 쓴다. 주소의 해시는 결과 이미지에서 나온 추측할 수 없는 값이라 주소를 모르면 볼 수 없다(위험 수용 — 이슈에 기록).
 *
 * <p>해시가 바뀌면 주소가 바뀌므로 응답은 1년 동안 바뀌지 않는 것으로 캐시하게 한다. ETag 도 붙여 캐시가 비워진 뒤 다시 확인하는 요청(If-None-Match)은
 * 본문 없이 304 로 끝낸다(Spring 이 ETag 를 보고 처리). 바꾸기 전 주소·없는 크기·없는 사용자는 모두 404.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping(AvatarService.PUBLIC_PATH)
public class AvatarController {

  /** 해시가 곧 내용이라 영구 캐시해도 된다(바꾸면 주소가 달라진다). */
  static final String IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

  private final AvatarService avatarService;

  /** 아바타 이미지(64·128·256px 정사각, PNG 또는 JPEG). */
  @GetMapping("/{userId}/{hash}/{size}")
  public ResponseEntity<Resource> get(
      @PathVariable("userId") long userId,
      @PathVariable("hash") String hash,
      @PathVariable("size") int size) {
    return avatarService
        .load(userId, hash, size)
        .<ResponseEntity<Resource>>map(
            f ->
                ResponseEntity.ok()
                    .header(HttpHeaders.CACHE_CONTROL, IMMUTABLE_CACHE)
                    // 해시·크기가 곧 내용이라 강한 ETag 로 쓴다.
                    .eTag("\"" + hash + "-" + size + "\"")
                    .contentType(f.contentType())
                    .body(new FileSystemResource(f.path())))
        .orElseGet(() -> ResponseEntity.notFound().build());
  }
}
