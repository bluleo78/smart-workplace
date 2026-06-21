package com.workplace.drive.controller;

import com.workplace.drive.dto.DriveQuotaResponse;
import com.workplace.drive.service.DriveQuotaService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 드라이브 쿼터 조회 — 인증 사용자의 현재 테넌트 사용량/한도. */
@RestController
@RequestMapping("/api/v1/drive")
@RequiredArgsConstructor
public class DriveQuotaController {

  private final DriveQuotaService quota;

  /** 현재 테넌트 드라이브 사용량/한도를 반환한다. */
  @GetMapping("/quota")
  public DriveQuotaResponse getQuota() {
    DriveQuotaService.QuotaView v = quota.view();
    return new DriveQuotaResponse(v.usedBytes(), v.quotaBytes());
  }
}
