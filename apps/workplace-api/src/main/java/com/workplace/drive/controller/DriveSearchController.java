package com.workplace.drive.controller;

import com.workplace.drive.dto.DriveSearchResponse;
import com.workplace.drive.service.DriveSearchService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 드라이브 공간 이름 검색 API. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive")
public class DriveSearchController {
  private final DriveSearchService searchService;

  @GetMapping("/spaces/{id}/search")
  public ResponseEntity<DriveSearchResponse> search(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @RequestParam(value = "q", required = false) String q) {
    return ResponseEntity.ok(searchService.search(callerId, spaceId, q));
  }
}
