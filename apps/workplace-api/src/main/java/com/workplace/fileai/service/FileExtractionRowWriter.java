package com.workplace.fileai.service;

import com.workplace.fileai.ExtractableTypes;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.repository.FileExtractionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 추출 행 생성 판정 단일 소스 — 추출 가능하면 PENDING, 아니면(이미지·미지원) SKIPPED + 원시 사유. 업로드 이벤트 리스너와 기존 첨부 백필이 같은 판정을
 * 쓰도록 모았다(WP-244). 이미 행이 있으면 아무것도 바꾸지 않는다(ON CONFLICT DO NOTHING).
 */
@Component
@RequiredArgsConstructor
public class FileExtractionRowWriter {

  private final FileExtractionRepository repo;

  /** 호출자의 트랜잭션(테넌트 GUC 주입) 안에서 호출해야 한다. */
  public void write(long fileId, long tenantId, String mime, ExtractionProfile profile) {
    if (ExtractableTypes.supports(mime)) {
      repo.upsertPending(fileId, tenantId, profile);
    } else {
      repo.markSkipped(fileId, tenantId, profile, ExtractableTypes.skipReason(mime));
    }
  }
}
