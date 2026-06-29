package com.workplace.file.storage;

import com.workplace.global.tenant.TenantContext;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** 파일 저장 상대경로 생성 단일 책임. 형식: tenant-{id}/{domain}/{yyyy-MM-dd}/{uuid}.{ext}. 디스크를 모른다(순수 문자열). */
@Component
public class FilePathBuilder {

  private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");

  /** 원본 파일명 기준 새 상대경로 생성. 테넌트 컨텍스트 필수. */
  public String build(StorageDomain domain, String originalName) {
    String ext = extensionOf(originalName == null ? "" : originalName);
    return assemble(domain, ext);
  }

  /** 기존 stored/원본 이름의 확장자를 보존하여 새 상대경로 생성(copy 용). */
  public String buildWithExtensionOf(StorageDomain domain, String existingName) {
    return assemble(domain, extensionOf(existingName == null ? "" : existingName));
  }

  private String assemble(StorageDomain domain, String ext) {
    Long tenantId = TenantContext.get();
    if (tenantId == null) {
      throw new IllegalStateException("테넌트 컨텍스트 없이 파일 경로 생성 불가");
    }
    String stored = UUID.randomUUID() + (ext.isEmpty() ? "" : "." + ext);
    return "tenant-"
        + tenantId
        + "/"
        + domain.segment()
        + "/"
        + LocalDate.now().format(DATE)
        + "/"
        + stored;
  }

  /** 확장자 추출(소문자, 점 제외). 없으면 "". */
  public static String extensionOf(String name) {
    int dot = name.lastIndexOf('.');
    if (dot < 0 || dot == name.length() - 1) {
      return "";
    }
    return name.substring(dot + 1).toLowerCase();
  }
}
