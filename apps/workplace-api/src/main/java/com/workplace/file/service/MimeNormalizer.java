package com.workplace.file.service;

import com.workplace.file.api.ImageSniffer;
import com.workplace.file.storage.FilePathBuilder;
import java.io.UncheckedIOException;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.InvalidMediaTypeException;
import org.springframework.http.MediaType;

/**
 * 업로드 경계 mime 정규화(#735). 브라우저가 확장자를 모르는 파일(.hwp/.hwpx 등)은 {@code application/octet-stream} 으로 보내는데,
 * 이 값이 그대로 저장되면 {@link com.workplace.fileai.ExtractableTypes} 가 추출 가능 여부를 판정할 수 없어 SKIPPED 로 굳는다.
 * 브라우저가 이미 구체적인 mime 을 알려준 경우는 그대로 신뢰하고, octet-stream(또는 빈 값)일 때만 파일명 확장자로 보정한다.
 *
 * <p>매핑 표는 계획서 Global Constraints "확장자 → mime 정규화 표"와 verbatim 일치해야 한다. V125 마이그레이션의 백필 CASE 문도 동일
 * 표를 미러하므로 한쪽만 고치면 드리프트가 발생한다.
 */
public final class MimeNormalizer {

  private MimeNormalizer() {}

  private static final Map<String, String> EXTENSION_TO_MIME =
      Map.ofEntries(
          Map.entry("html", "text/html"),
          Map.entry("htm", "text/html"),
          Map.entry("md", "text/markdown"),
          Map.entry("txt", "text/plain"),
          Map.entry("log", "text/plain"),
          Map.entry("csv", "text/csv"),
          Map.entry("json", "application/json"),
          Map.entry("xml", "application/xml"),
          Map.entry("yaml", "application/x-yaml"),
          Map.entry("yml", "application/x-yaml"),
          Map.entry("pdf", "application/pdf"),
          Map.entry(
              "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
          Map.entry("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
          Map.entry(
              "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
          Map.entry("doc", "application/msword"),
          Map.entry("xls", "application/vnd.ms-excel"),
          Map.entry("ppt", "application/vnd.ms-powerpoint"),
          Map.entry("hwpx", "application/hwp+zip"),
          Map.entry("hwp", "application/x-hwp"),
          // WP-250: 브라우저가 빈 type·octet-stream 으로 보내기 쉬운 이미지(HEIC 등). 이 매핑 전에 올라온 기존 행은 V174 가
          // 같은 표로 바로잡았다(V125 표는 문서 형식만 — 이미지 항목을 고치면 V174 와 드리프트).
          // 이미지 mime 은 ExtractableTypes.skipReason 이 "image:" 로 분류해 SKIPPED·IMAGE 가 된다.
          Map.entry("heic", "image/heic"),
          Map.entry("heif", "image/heif"),
          Map.entry("tif", "image/tiff"),
          Map.entry("tiff", "image/tiff"),
          Map.entry("bmp", "image/bmp"));

  /**
   * 텍스트로 만드는 파일(드라이브 텍스트 파일·스테이징 텍스트 업로드)의 확장자 → MIME. 이 넷 밖은 모두 text/plain 이다 — html 등이 저장 MIME 으로
   * 인라인 서빙돼 문서로 렌더링·실행되지 않게 한다.
   */
  private static final Map<String, String> TEXT_MIME_BY_EXTENSION =
      Map.of(
          "md", "text/markdown",
          "txt", "text/plain",
          "csv", "text/csv",
          "json", "application/json");

  /**
   * 텍스트 내용으로 만드는 파일의 MIME 을 이름 확장자로 정한다(WP-421, drive R4 규칙을 옮겨 공유). md→text/markdown,
   * txt→text/plain, csv→text/csv, json→application/json, 그 밖(확장자 없음·html·null 포함)은 text/plain.
   */
  public static String textMimeOf(String name) {
    String ext = FilePathBuilder.extensionOf(name == null ? "" : name).toLowerCase(Locale.ROOT);
    return TEXT_MIME_BY_EXTENSION.getOrDefault(ext, "text/plain");
  }

  /** 텍스트 내용으로 만드는 파일에 명시할 수 있는 MIME 인지 — {@link #textMimeOf} 의 확장자 표에 있는 넷. null 은 아니다. */
  public static boolean isTextMime(String mime) {
    // Map.of 의 containsValue(null) 은 NPE 라 먼저 거른다.
    return mime != null && TEXT_MIME_BY_EXTENSION.containsValue(mime);
  }

  /**
   * mime 기본형 — 파라미터(";" 뒤)를 떼고 앞뒤 공백을 지운 소문자. "application/pdf; charset=binary" →
   * "application/pdf". null 이면 빈 문자열(호출자가 "모름"으로 다룬다). 보기·워커 응답·메일 파트처럼 Content-Type 원문을 비교하는 곳이 같은
   * 규칙을 쓰게 한다.
   */
  public static String baseMime(String mime) {
    if (mime == null) return "";
    int semi = mime.indexOf(';');
    return (semi >= 0 ? mime.substring(0, semi) : mime).trim().toLowerCase(Locale.ROOT);
  }

  /**
   * 파일명·브라우저 mime 으로 정규화된 mime 을 결정한다.
   *
   * @param fileName 원본 파일명(확장자 추출용)
   * @param browserMime 브라우저가 보낸 Content-Type. null/blank/octet-stream 이면 확장자로 폴백한다.
   * @return 정규화된 mime. 확장자를 모르면 browserMime(또는 octet-stream)을 그대로 반환한다.
   */
  public static String normalize(String fileName, String browserMime) {
    boolean needsFallback =
        browserMime == null
            || browserMime.isBlank()
            || browserMime.equals("application/octet-stream");
    if (!needsFallback) {
      return browserMime;
    }
    if (fileName != null) {
      String ext = FilePathBuilder.extensionOf(fileName).toLowerCase();
      String mapped = EXTENSION_TO_MIME.get(ext);
      if (mapped != null) {
        return mapped;
      }
    }
    // 빈 문자열("")을 그대로 돌려주면 다운로드 시 MediaType.parseMediaType("") 가 실패하므로 null/blank 는 안전 폴백
    return browserMime != null && !browserMime.isBlank() ? browserMime : "application/octet-stream";
  }

  /**
   * 셸 업로드 링크용 정규화 — {@link #normalize} 결과가 그래도 octet-stream 이면 받아 둔 본문의 앞부분을 {@link ImageSniffer} 로
   * 보고 실제 이미지(png·jpeg·gif·webp)면 그 MIME 을 쓴다(WP-515·WP-523). {@code curl -T} 는 Content-Type 을 보내지
   * 않아 AI 가 올린 스크린샷이 이미지로 보이지 않았다. 확장자가 아니라 바이트로 정하므로 이름만 .png 인 다른 파일은 바뀌지 않고, 공용 확장자 표도 그대로다. 판정용
   * 읽기 실패는 저장을 막지 않는다 — 판정 없이 정규화 결과로 둔다.
   */
  public static String normalizeSniffing(String fileName, String browserMime, Path body) {
    String mime = normalize(fileName, browserMime);
    if (!"application/octet-stream".equals(mime)) return mime;
    try {
      return ImageSniffer.detectFile(body).orElse(mime);
    } catch (UncheckedIOException e) {
      return mime;
    }
  }

  /**
   * 구체 타입(type/subtype)이면 파라미터를 뗀 값, 비었거나 형식이 깨졌거나(헤더 인젝션 포함) 와일드카드면
   * application/octet-stream(WP-574). 스테이징 업로드 저장 MIME 과 메일 첨부 파트의 Content-Type 이 같은 규칙을 쓴다.
   */
  public static String concreteOrOctetStream(String mime) {
    if (mime != null && !mime.isBlank()) {
      try {
        MediaType parsed = MediaType.parseMediaType(mime.trim());
        if (parsed.isConcrete()) {
          return parsed.getType() + "/" + parsed.getSubtype();
        }
      } catch (InvalidMediaTypeException ignored) {
        // 깨진 값 → 기본값
      }
    }
    return MediaType.APPLICATION_OCTET_STREAM_VALUE;
  }
}
