package com.workplace.file.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.file.dto.FileUploadResponse;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/** 업로드 시 썸네일 생성/신뢰 read 검증. */
@Transactional
class FileThumbnailServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired FileUploadService fileUploadService;

  /** 업로드 경로는 TenantContext 를 요구한다 — 테스트에선 tenant#1 로 고정. */
  @BeforeEach
  void setTenantContext() {
    TenantContext.set(1L);
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenantContext() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ft_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Ft" + s)
        .set(USER.EMAIL, "ft_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private byte[] pngBytes(int w, int h) throws Exception {
    BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    ImageIO.write(img, "png", out);
    return out.toByteArray();
  }

  /** IMAGE 업로드 → thumbnail_path 채워짐 + getThumbnailContentTrusted 가 image/png 반환. */
  @Test
  void imageUpload_generatesThumbnail() throws Exception {
    long u = seedUser();
    MockMultipartFile png =
        new MockMultipartFile("file", "pic.png", "image/png", pngBytes(400, 300));

    FileUploadResponse uploaded = fileUploadService.uploadFiles(List.of(png), u).get(0);

    String tp =
        dsl.select(FILE.THUMBNAIL_PATH)
            .from(FILE)
            .where(FILE.ID.eq(uploaded.id()))
            .fetchOne(FILE.THUMBNAIL_PATH);
    assertThat(tp).isNotNull();
    Optional<FileContentResult> thumb = fileUploadService.getThumbnailContentTrusted(uploaded.id());
    assertThat(thumb).isPresent();
    assertThat(thumb.get().mimeType()).isEqualTo("image/png");
  }

  /** 비IMAGE 업로드 → thumbnail_path null + 신뢰 read 빈 결과. */
  @Test
  void textUpload_hasNoThumbnail() throws Exception {
    long u = seedUser();
    MockMultipartFile txt =
        new MockMultipartFile("file", "memo.txt", "text/plain", "hello".getBytes());

    FileUploadResponse uploaded = fileUploadService.uploadFiles(List.of(txt), u).get(0);

    String tp =
        dsl.select(FILE.THUMBNAIL_PATH)
            .from(FILE)
            .where(FILE.ID.eq(uploaded.id()))
            .fetchOne(FILE.THUMBNAIL_PATH);
    assertThat(tp).isNull();
    assertThat(fileUploadService.getThumbnailContentTrusted(uploaded.id())).isEmpty();
  }
}
