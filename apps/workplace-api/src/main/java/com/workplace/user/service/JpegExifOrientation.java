package com.workplace.user.service;

/**
 * JPEG 의 EXIF 방향(Orientation, 태그 0x0112) 값을 읽는다(WP-1222 아바타).
 *
 * <p>휴대폰 사진은 픽셀을 센서 방향 그대로 두고 「돌려서 보라」는 표시만 EXIF 에 남긴다. 브라우저는 이 표시대로 돌려 보여 주고 사용자는 그 화면에서 자를 영역을
 * 고르므로, 서버도 같은 방향으로 돌린 뒤 잘라야 같은 영역이 나온다. JDK ImageIO 는 EXIF 를 해석하지 않아 APP1 구간의 TIFF 머리글과 첫 IFD 만 직접
 * 훑는다 — 방향 하나만 필요해 메타 라이브러리를 더하지 않는다.
 *
 * <p>읽다가 형식이 어긋나면(잘린 구간·이상한 오프셋) 예외 대신 1(그대로)을 돌려준다 — 방향 표시가 깨진 사진도 올라가야 한다.
 */
final class JpegExifOrientation {

  /** 방향 표시 없음(그대로). */
  static final int NORMAL = 1;

  private static final int TAG_ORIENTATION = 0x0112;
  private static final int TYPE_SHORT = 3;
  private static final int TYPE_LONG = 4;

  private JpegExifOrientation() {}

  /** JPEG 바이트에서 EXIF 방향(1~8)을 읽는다. 없거나 읽을 수 없으면 {@link #NORMAL}. */
  static int read(byte[] jpeg) {
    // SOI(FFD8) 다음부터 마커 구간을 차례로 본다. SOS(영상 데이터 시작) 전까지만 메타 구간이다.
    int i = 2;
    while (i + 4 <= jpeg.length) {
      if ((jpeg[i] & 0xFF) != 0xFF) return NORMAL;
      int marker = jpeg[i + 1] & 0xFF;
      if (marker == 0xFF) { // 채움 바이트
        i++;
        continue;
      }
      if (marker == 0xDA || marker == 0xD9) return NORMAL; // SOS·EOI — 메타 구간 끝
      if ((marker >= 0xD0 && marker <= 0xD7) || marker == 0x01) { // 길이 없는 마커
        i += 2;
        continue;
      }
      int length = u16(jpeg, i + 2, false);
      int start = i + 4;
      int end = i + 2 + length;
      if (length < 2 || end > jpeg.length) return NORMAL;
      if (marker == 0xE1 && isExifHeader(jpeg, start, end)) {
        return orientationInTiff(jpeg, start + 6, end);
      }
      i = end;
    }
    return NORMAL;
  }

  /** APP1 구간이 "Exif\0\0" 로 시작하는지(같은 APP1 을 XMP 도 쓴다). */
  private static boolean isExifHeader(byte[] b, int start, int end) {
    return end - start >= 6
        && b[start] == 'E'
        && b[start + 1] == 'x'
        && b[start + 2] == 'i'
        && b[start + 3] == 'f'
        && b[start + 4] == 0
        && b[start + 5] == 0;
  }

  /** TIFF 머리글(바이트 순서·42·첫 IFD 오프셋)을 따라 첫 IFD 에서 방향 태그를 찾는다. */
  private static int orientationInTiff(byte[] b, int tiff, int end) {
    if (tiff + 8 > end) return NORMAL;
    boolean little;
    if (b[tiff] == 'I' && b[tiff + 1] == 'I') little = true;
    else if (b[tiff] == 'M' && b[tiff + 1] == 'M') little = false;
    else return NORMAL;
    if (u16(b, tiff + 2, little) != 42) return NORMAL;
    long ifdOffset = u32(b, tiff + 4, little);
    if (ifdOffset < 8 || ifdOffset > end - tiff - 2) return NORMAL;
    int ifd = tiff + (int) ifdOffset;
    int count = u16(b, ifd, little);
    for (int k = 0; k < count; k++) {
      int entry = ifd + 2 + k * 12;
      if (entry + 12 > end) return NORMAL;
      if (u16(b, entry, little) != TAG_ORIENTATION) continue;
      int type = u16(b, entry + 2, little);
      // 값이 4바이트 안에 들어가면 값 칸에 바로 있다(SHORT 는 앞 2바이트).
      long value =
          type == TYPE_SHORT
              ? u16(b, entry + 8, little)
              : type == TYPE_LONG ? u32(b, entry + 8, little) : NORMAL;
      return value >= 1 && value <= 8 ? (int) value : NORMAL;
    }
    return NORMAL;
  }

  private static int u16(byte[] b, int at, boolean little) {
    int b0 = b[at] & 0xFF;
    int b1 = b[at + 1] & 0xFF;
    return little ? (b1 << 8) | b0 : (b0 << 8) | b1;
  }

  private static long u32(byte[] b, int at, boolean little) {
    long hi = u16(b, at + (little ? 2 : 0), little);
    long lo = u16(b, at + (little ? 0 : 2), little);
    return (hi << 16) | lo;
  }
}
