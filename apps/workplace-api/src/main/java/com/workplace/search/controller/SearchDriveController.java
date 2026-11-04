package com.workplace.search.controller;

import com.workplace.search.dto.DriveNamePage;
import com.workplace.search.service.SearchDriveService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 통합 검색 팔레트(WP-1353)의 모든 공간 드라이브 이름 검색 API. 서비스만 부른다(RLS 트랜잭션은 서비스가 연다). */
@Validated
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/search")
public class SearchDriveController {

  private final SearchDriveService service;

  /** 호출자가 멤버인 모든 공간의 폴더·파일을 이름으로 찾는다. q 가 2자 미만이면 빈 결과. */
  @GetMapping("/drive")
  public ResponseEntity<DriveNamePage> drive(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "q", required = false) String q,
      @RequestParam(value = "offset", required = false, defaultValue = "0")
          @Min(value = 0, message = "offset 은 0 이상이어야 합니다")
          int offset,
      @RequestParam(value = "size", required = false, defaultValue = "20")
          @Min(value = 1, message = "size 는 1~50 이어야 합니다")
          @Max(value = 50, message = "size 는 1~50 이어야 합니다")
          int size) {
    return ResponseEntity.ok(service.search(callerId, q, offset, size));
  }
}
