package com.workplace.file.service;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.UUID;
import javax.imageio.ImageIO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 이미지 썸네일 생성기. JDK 표준 ImageIO 만 사용(외부 의존성 없음).
 *
 * <p>PNG/JPEG/GIF 는 디코드되나 WEBP 등 ImageIO 미지원 포맷은 read 가 null → 빈 결과로 처리한다(원본 업로드는 유지). 디코드는 전체 비트맵을
 * 힙에 적재하므로(10MB JPEG → 수백 MB raw 가능) v1 부하에선 허용하되 대용량 처리 시 한계로 인지.
 */
@Component
@Slf4j
public class ThumbnailGenerator {

  /** 썸네일 최대 변(px). 비율 유지, 축소만(원본이 더 작으면 확대 안 함). */
  static final int MAX_DIM = 256;

  /**
   * source 이미지를 읽어 최대 256px 썸네일 PNG 를 destDir 에 쓰고 절대경로를 반환한다. 디코드/IO 실패는 빈 Optional(원본 업로드 비차단).
   */
  public Optional<String> generate(Path source, Path destDir) {
    try {
      BufferedImage img = ImageIO.read(source.toFile());
      if (img == null) {
        return Optional.empty(); // 미지원 포맷(webp 등)
      }
      int w = img.getWidth();
      int h = img.getHeight();
      double scale = Math.min(1.0, (double) MAX_DIM / Math.max(w, h));
      int nw = Math.max(1, (int) Math.round(w * scale));
      int nh = Math.max(1, (int) Math.round(h * scale));

      BufferedImage thumb = new BufferedImage(nw, nh, BufferedImage.TYPE_INT_ARGB);
      Graphics2D g = thumb.createGraphics();
      g.setRenderingHint(
          RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
      g.drawImage(img, 0, 0, nw, nh, null);
      g.dispose();

      Files.createDirectories(destDir);
      Path dest = destDir.resolve("thumb_" + UUID.randomUUID() + ".png");
      ImageIO.write(thumb, "png", dest.toFile());
      return Optional.of(dest.toAbsolutePath().toString());
    } catch (IOException | RuntimeException e) {
      log.warn("썸네일 생성 실패(원본 업로드는 유지): {}: {}", source, e.getMessage());
      return Optional.empty();
    }
  }
}
