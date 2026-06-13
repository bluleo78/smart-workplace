package com.workplace.file.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.file.dto.FileUploadResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/** 스토리지 경로 테넌트 prefix 검증 — 업로드 파일이 tenant-{tenantId}/ 하위에 저장되는지, 테넌트 컨텍스트가 없으면 차단되는지. */
@Transactional
class FileUploadServiceTenantTest extends IntegrationTestBase {

  @Autowired private FileUploadService fileUploadService;
  @Autowired private DSLContext dsl;

  private Long uploadedId;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ftn_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Ftn" + s)
        .set(USER.EMAIL, "ftn_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @AfterEach
  void cleanup() {
    // 디스크에 기록된 물리 파일 정리 후 ThreadLocal 해제.
    if (uploadedId != null) {
      String p =
          dsl.select(FILE.STORAGE_PATH)
              .from(FILE)
              .where(FILE.ID.eq(uploadedId))
              .fetchOne(FILE.STORAGE_PATH);
      if (p != null) {
        try {
          Files.deleteIfExists(Path.of(p));
        } catch (IOException ignored) {
        }
      }
    }
    TenantContext.clear();
  }

  /** 테넌트#1 컨텍스트에서 업로드 → storage_path 에 "tenant-1/" 가 포함되어야 한다. */
  @Test
  void upload_storesUnderTenantPrefix() throws IOException {
    TenantContext.set(1L);
    long u = seedUser();
    MockMultipartFile file =
        new MockMultipartFile("files", "memo.txt", "text/plain", "hello".getBytes());

    List<FileUploadResponse> res = fileUploadService.uploadFiles(List.of(file), u);
    uploadedId = res.get(0).id();

    String storagePath =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(uploadedId))
            .fetchOne(FILE.STORAGE_PATH);
    assertThat(storagePath).contains("tenant-1" + java.io.File.separator);
  }

  /** 테넌트 컨텍스트가 없으면 업로드가 명시적으로 차단되어야 한다(테넌트 미선택 업로드 금지). */
  @Test
  void upload_withoutTenantContext_isRejected() {
    TenantContext.clear();
    long u = seedUser();
    MockMultipartFile file =
        new MockMultipartFile("files", "memo.txt", "text/plain", "hello".getBytes());

    assertThatThrownBy(() -> fileUploadService.uploadFiles(List.of(file), u))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("테넌트 컨텍스트");
  }
}
