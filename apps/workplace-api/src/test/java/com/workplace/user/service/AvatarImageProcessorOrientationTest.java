package com.workplace.user.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.Rectangle;
import java.awt.image.BufferedImage;
import org.junit.jupiter.api.Test;

/**
 * WP-1222 아바타 처리기의 「먼저 자르고 그 정사각만 돌리기」가 「전체를 돌린 뒤 자르기」와 픽셀 하나까지 같은지 본다. 메모리를 아끼려고 순서를 바꿨으므로, 방향 1~8
 * 과 여러 자를 영역에서 보이는 모습 좌표 → 원본 좌표 변환({@link AvatarImageProcessor#rawRegion})과 정사각 돌리기({@link
 * AvatarImageProcessor#orientSquare})가 기준(픽셀을 하나씩 옮기는 EXIF 방향 정의)과 어긋나지 않아야 한다. DB 가 필요 없는 순수 테스트다.
 */
class AvatarImageProcessorOrientationTest {

  private static final int W = 7;
  private static final int H = 5;

  /** 픽셀마다 다른 값(위치를 부호화)을 가진 원본 — 어긋나면 바로 드러난다. */
  private static BufferedImage numbered() {
    BufferedImage img = new BufferedImage(W, H, BufferedImage.TYPE_INT_ARGB);
    for (int y = 0; y < H; y++) {
      for (int x = 0; x < W; x++) {
        img.setRGB(x, y, 0xFF000000 | (x << 8) | y);
      }
    }
    return img;
  }

  /** 기준 — EXIF 방향 정의대로 원본 (x, y) 를 보이는 모습의 자리로 하나씩 옮긴다(처리기의 예전 구현). */
  private static BufferedImage referenceOrient(BufferedImage src, int o) {
    int w = src.getWidth();
    int h = src.getHeight();
    boolean swap = o >= 5;
    BufferedImage out = new BufferedImage(swap ? h : w, swap ? w : h, BufferedImage.TYPE_INT_ARGB);
    for (int y = 0; y < h; y++) {
      for (int x = 0; x < w; x++) {
        int argb = src.getRGB(x, y);
        switch (o) {
          case 1 -> out.setRGB(x, y, argb);
          case 2 -> out.setRGB(w - 1 - x, y, argb);
          case 3 -> out.setRGB(w - 1 - x, h - 1 - y, argb);
          case 4 -> out.setRGB(x, h - 1 - y, argb);
          case 5 -> out.setRGB(y, x, argb);
          case 6 -> out.setRGB(h - 1 - y, x, argb);
          case 7 -> out.setRGB(h - 1 - y, w - 1 - x, argb);
          default -> out.setRGB(y, w - 1 - x, argb);
        }
      }
    }
    return out;
  }

  @Test
  void 먼저_자르고_돌린_결과가_전체를_돌린_뒤_자른_결과와_같다() {
    BufferedImage raw = numbered();
    for (int o = 1; o <= 8; o++) {
      BufferedImage shownFull = referenceOrient(raw, o);
      int sw = shownFull.getWidth();
      int sh = shownFull.getHeight();
      for (int side = 1; side <= Math.min(sw, sh); side++) {
        for (int cy = 0; cy + side <= sh; cy++) {
          for (int cx = 0; cx + side <= sw; cx++) {
            Rectangle shown = new Rectangle(cx, cy, side, side);
            Rectangle region = AvatarImageProcessor.rawRegion(o, W, H, shown);
            BufferedImage got =
                AvatarImageProcessor.orientSquare(
                    raw.getSubimage(region.x, region.y, side, side), o);
            for (int v = 0; v < side; v++) {
              for (int u = 0; u < side; u++) {
                assertThat(got.getRGB(u, v))
                    .as("방향 %d 자르기 (%d,%d,%d) 의 (%d,%d)", o, cx, cy, side, u, v)
                    .isEqualTo(shownFull.getRGB(cx + u, cy + v));
              }
            }
          }
        }
      }
    }
  }
}
