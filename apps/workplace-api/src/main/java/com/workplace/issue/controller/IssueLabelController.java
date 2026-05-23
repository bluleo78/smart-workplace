package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.service.IssueLabelService;
import com.workplace.label.dto.LabelSummary;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 라벨 집합 교체 — PUT 단일 엔드포인트. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/labels")
@RequiredArgsConstructor
public class IssueLabelController {

  private final IssueLabelService issueLabelService;

  /** 라벨 집합 교체 요청 본문. */
  public record ReplaceLabelsRequest(@NotNull List<Long> labelIds) {}

  /** 라벨 집합 통째로 교체. */
  @PutMapping
  @RequirePermission("issue:write")
  public ResponseEntity<List<LabelSummary>> replace(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody ReplaceLabelsRequest req) {
    return ResponseEntity.ok(
        issueLabelService.replace((Long) auth.getPrincipal(), key, number, req.labelIds()));
  }
}
