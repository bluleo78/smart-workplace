package com.workplace.file.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** ThumbnailGenerator 단위 테스트 — Spring 컨텍스트 불필요(DB 없음). */
class ThumbnailGeneratorTest {

  private final ThumbnailGenerator generator = new ThumbnailGenerator();

  /** 512x400 PNG → 최대 256px 썸네일 PNG 생성(비율 유지). */
  @Test
  void generate_scalesDownTo256(@TempDir Path dir) throws Exception {
    Path src = dir.resolve("src.png");
    BufferedImage img = new BufferedImage(512, 400, BufferedImage.TYPE_INT_RGB);
    ImageIO.write(img, "png", src.toFile());

    Optional<String> result = generator.generate(src, dir);

    assertThat(result).isPresent();
    Path thumb = Path.of(result.get());
    assertThat(Files.exists(thumb)).isTrue();
    BufferedImage out = ImageIO.read(thumb.toFile());
    assertThat(Math.max(out.getWidth(), out.getHeight())).isLessThanOrEqualTo(256);
    // 비율 유지: 512x400 → 256x200
    assertThat(out.getWidth()).isEqualTo(256);
    assertThat(out.getHeight()).isEqualTo(200);
  }

  /** 이미지가 아닌(디코드 불가) 바이트 → 빈 결과(원본 업로드를 막지 않음). */
  @Test
  void generate_returnsEmpty_forNonImage(@TempDir Path dir) throws Exception {
    Path src = dir.resolve("notimage.bin");
    Files.write(src, "this is not an image".getBytes());

    Optional<String> result = generator.generate(src, dir);

    assertThat(result).isEmpty();
  }
}
