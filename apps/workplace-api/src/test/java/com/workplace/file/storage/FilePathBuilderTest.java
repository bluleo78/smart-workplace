package com.workplace.file.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class FilePathBuilderTest {

  private final FilePathBuilder builder = new FilePathBuilder();

  @AfterEach
  void clear() {
    TenantContext.clear();
  }

  @Test
  void build_producesTenantDomainDateUuidRelativePath() {
    TenantContext.set(7L);
    String rel = builder.build(StorageDomain.FILES, "보고서.PDF");
    // tenant-7/files/2026-06-29/<uuid>.pdf
    assertThat(rel)
        .matches(Pattern.compile("tenant-7/files/\\d{4}-\\d{2}-\\d{2}/[0-9a-f-]{36}\\.pdf"));
  }

  @Test
  void build_noExtension_omitsDot() {
    TenantContext.set(1L);
    String rel = builder.build(StorageDomain.ISSUE, "README");
    assertThat(rel).matches(Pattern.compile("tenant-1/issue/\\d{4}-\\d{2}-\\d{2}/[0-9a-f-]{36}"));
  }

  @Test
  void build_withoutTenant_throws() {
    TenantContext.clear();
    assertThatThrownBy(() -> builder.build(StorageDomain.FILES, "x.txt"))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void extensionOf_lowercasesAndStripsDot() {
    assertThat(FilePathBuilder.extensionOf("a.TXT")).isEqualTo("txt");
    assertThat(FilePathBuilder.extensionOf("noext")).isEmpty();
  }
}
