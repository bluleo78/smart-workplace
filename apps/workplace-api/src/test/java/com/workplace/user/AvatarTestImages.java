package com.workplace.user;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import javax.imageio.ImageIO;

/**
 * 아바타 테스트(WP-1222)용 이미지 바이트를 코드로 만든다 — 바이너리 고정 파일을 두지 않는다.
 *
 * <p>JDK 는 WEBP 를 쓰지 못해, 한 가지 색으로 칠한 무손실 WEBP(VP8L) 를 비트 단위로 직접 조립한다. 다섯 허프만 부호가 모두 「기호 하나」라 픽셀 자료가
 * 0비트다.
 */
public final class AvatarTestImages {

  private AvatarTestImages() {}

  /** 왼쪽 절반 left 색, 오른쪽 절반 right 색인 이미지. */
  public static BufferedImage halves(int w, int h, Color left, Color right, boolean alpha) {
    BufferedImage img =
        new BufferedImage(w, h, alpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
    Graphics2D g = img.createGraphics();
    g.setColor(left);
    g.fillRect(0, 0, w / 2, h);
    g.setColor(right);
    g.fillRect(w / 2, 0, w - w / 2, h);
    g.dispose();
    return img;
  }

  /** 한 가지 색 이미지. */
  public static BufferedImage solid(int w, int h, Color color) {
    return halves(w, h, color, color, color.getAlpha() != 255);
  }

  /** ImageIO 로 인코딩(png·jpg·gif). */
  public static byte[] encode(BufferedImage img, String format) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    try {
      if (!ImageIO.write(img, format, out)) throw new IllegalStateException("기록기 없음: " + format);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    return out.toByteArray();
  }

  /** 바이트를 다시 읽는다(응답 이미지 검사용). */
  public static BufferedImage decode(byte[] bytes) {
    try {
      return ImageIO.read(new ByteArrayInputStream(bytes));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /**
   * JPEG 의 JFIF(APP0) 뒤에 EXIF(APP1) 를 끼운다 — 방향(0x0112) 과 GPS IFD(위도 기준 'N') 를 담는다. 빅엔디언(MM) TIFF.
   */
  public static byte[] withExif(byte[] jpeg, int orientation) {
    ByteBuffer tiff = ByteBuffer.allocate(56).order(ByteOrder.BIG_ENDIAN);
    tiff.put((byte) 'M').put((byte) 'M').putShort((short) 42).putInt(8);
    // IFD0: 항목 2개
    tiff.putShort((short) 2);
    tiff.putShort((short) 0x0112).putShort((short) 3).putInt(1).putShort((short) orientation);
    tiff.putShort((short) 0);
    tiff.putShort((short) 0x8825).putShort((short) 4).putInt(1).putInt(38);
    tiff.putInt(0);
    // GPS IFD(오프셋 38): GPSLatitudeRef = "N"
    tiff.putShort((short) 1);
    tiff.putShort((short) 0x0001).putShort((short) 2).putInt(2);
    tiff.put((byte) 'N').put((byte) 0).put((byte) 0).put((byte) 0);
    tiff.putInt(0);
    byte[] exifHeader = "Exif\0\0".getBytes(StandardCharsets.US_ASCII);
    int payload = exifHeader.length + tiff.capacity();
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    // SOI 와 APP0(있으면) 뒤에 넣는다.
    int at = 2;
    if ((jpeg[2] & 0xFF) == 0xFF && (jpeg[3] & 0xFF) == 0xE0) {
      at = 4 + (((jpeg[4] & 0xFF) << 8) | (jpeg[5] & 0xFF));
    }
    out.write(jpeg, 0, at);
    out.write(0xFF);
    out.write(0xE1);
    out.write(((payload + 2) >> 8) & 0xFF);
    out.write((payload + 2) & 0xFF);
    out.writeBytes(exifHeader);
    out.writeBytes(tiff.array());
    out.write(jpeg, at, jpeg.length - at);
    return out.toByteArray();
  }

  /** 한 가지 ARGB 색으로 칠한 무손실 WEBP(VP8L). */
  public static byte[] solidWebp(int w, int h, int a, int r, int g, int b) {
    BitWriter bits = new BitWriter();
    bits.write(0x2F, 8); // VP8L 서명
    bits.write(w - 1, 14);
    bits.write(h - 1, 14);
    bits.write(a != 255 ? 1 : 0, 1); // alpha_is_used
    bits.write(0, 3); // 버전
    bits.write(0, 1); // 변환 없음
    bits.write(0, 1); // 색 캐시 없음
    bits.write(0, 1); // 메타 허프만 없음
    // 초록·빨강·파랑·알파·거리 순서로 「기호 하나」 단순 부호.
    for (int symbol : new int[] {g, r, b, a, 0}) {
      bits.write(1, 1); // simple code
      bits.write(0, 1); // 기호 1개
      bits.write(1, 1); // 첫 기호 8비트
      bits.write(symbol, 8);
    }
    byte[] data = bits.toBytes();
    int pad = data.length % 2;
    ByteBuffer riff = ByteBuffer.allocate(20 + data.length + pad).order(ByteOrder.LITTLE_ENDIAN);
    riff.put("RIFF".getBytes(StandardCharsets.US_ASCII));
    riff.putInt(4 + 8 + data.length + pad);
    riff.put("WEBP".getBytes(StandardCharsets.US_ASCII));
    riff.put("VP8L".getBytes(StandardCharsets.US_ASCII));
    riff.putInt(data.length);
    riff.put(data);
    return riff.array();
  }

  /** LSB 먼저 쌓는 비트 기록기(VP8L 비트 순서). */
  private static final class BitWriter {
    private final ByteArrayOutputStream out = new ByteArrayOutputStream();
    private long acc;
    private int n;

    void write(int value, int count) {
      acc |= ((long) value & ((1L << count) - 1)) << n;
      n += count;
      while (n >= 8) {
        out.write((int) (acc & 0xFF));
        acc >>>= 8;
        n -= 8;
      }
    }

    byte[] toBytes() {
      if (n > 0) out.write((int) (acc & 0xFF));
      // 디코더가 앞당겨 읽어도 모자라지 않게 0 바이트를 덧붙인다.
      out.writeBytes(new byte[8]);
      return out.toByteArray();
    }
  }
}
