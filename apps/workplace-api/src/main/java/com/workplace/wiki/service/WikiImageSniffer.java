package com.workplace.wiki.service;

import java.util.Optional;

/**
 * 업로드된 바이트의 앞부분을 보고 이미지 형식을 판정한다.
 *
 * <p>브라우저가 보낸 Content-Type 은 위조 가능하므로 신뢰하지 않는다. 실제로 HTML 을 image/png 라고 선언해 올리면 inline 응답으로 스크립트가
 * 실행될 수 있다. SVG 는 XML 이라 매직바이트가 없고 스크립트 삽입 벡터이므로 애초에 화이트리스트에서 제외한다.
 */
public final class WikiImageSniffer {

  private WikiImageSniffer() {}

  /** 판정에 필요한 최소 바이트 수. */
  public static final int HEAD_BYTES = 16;

  /** 허용 형식이면 정규 MIME 을, 아니면 empty 를 반환한다. */
  public static Optional<String> detect(byte[] head) {
    if (head == null || head.length < 12) return Optional.empty();
    if (startsWith(head, new int[] {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A})) {
      return Optional.of("image/png");
    }
    if (startsWith(head, new int[] {0xFF, 0xD8, 0xFF})) {
      return Optional.of("image/jpeg");
    }
    if (startsWith(head, new int[] {'G', 'I', 'F', '8', '7', 'a'})
        || startsWith(head, new int[] {'G', 'I', 'F', '8', '9', 'a'})) {
      return Optional.of("image/gif");
    }
    // WebP: "RIFF" + 4바이트 길이 + "WEBP"
    if (startsWith(head, new int[] {'R', 'I', 'F', 'F'})
        && head[8] == 'W'
        && head[9] == 'E'
        && head[10] == 'B'
        && head[11] == 'P') {
      return Optional.of("image/webp");
    }
    return Optional.empty();
  }

  private static boolean startsWith(byte[] data, int[] sig) {
    if (data.length < sig.length) return false;
    for (int i = 0; i < sig.length; i++) {
      if ((data[i] & 0xFF) != sig[i]) return false;
    }
    return true;
  }
}
