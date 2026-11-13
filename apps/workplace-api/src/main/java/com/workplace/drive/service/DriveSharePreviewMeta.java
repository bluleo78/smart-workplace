package com.workplace.drive.service;

import com.workplace.drive.service.DriveSharePreview.FolderOpen;
import com.workplace.drive.service.DriveSharePreview.InternalOnly;
import com.workplace.drive.service.DriveSharePreview.Open;
import com.workplace.drive.service.DriveSharePreview.PasswordProtected;
import com.workplace.file.storage.FilePathBuilder;
import com.workplace.global.util.FileSizeFormatter;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.web.util.HtmlUtils;

/**
 * 드라이브 공유 링크 미리보기 메타 조각 포매터(WP-1473) — 순수 정적 메서드. web nginx 가 SSI 로 끼워 넣는 {@code <meta>}
 * 줄(설명·og:title· og:description)과 {@code og:image} 줄을 만든다. 외부 메신저 봇은 자바스크립트를 실행하지 않아 HTML 에 값이 들어
 * 있어야 한다.
 *
 * <p>값은 모두 HTML 속성으로 이스케이프한다(파일 이름은 사용자가 정한 글).
 */
public final class DriveSharePreviewMeta {
  private DriveSharePreviewMeta() {}

  private static final String PASSWORD_ALT = "보호된 파일 · 비밀번호 필요";
  private static final String INTERNAL_ALT = "사내 공유 파일 · 로그인 필요";
  private static final Kind FILE = new Kind("file", "파일", "파일");

  /**
   * 종류 한 칸 — 그림 키(imageKey)·alt 용 그림 이름(imageName)·사람이 읽는 종류 이름(label). 확장자마다 label 이 다를 수 있어(Word
   * 문서·한글 문서 등) 확장자별로 한 항목씩 둔다.
   */
  private record Kind(String imageKey, String imageName, String label) {}

  /** 알려진 확장자 → 종류 표. 종류 판정(그림·alt·이름)은 모두 이 표 한 번 조회로 끝난다. */
  private static final Map<String, Kind> KIND_BY_EXT = kindTable();

  private static Map<String, Kind> kindTable() {
    Map<String, Kind> m = new HashMap<>();
    m.put("pdf", new Kind("pdf", "PDF 파일", "PDF"));
    // 문서 계열 — 그림은 doc, 이름은 확장자별
    put(m, "doc", "문서", Map.of("docx", "Word 문서", "doc", "Word 문서", "hwp", "한글 문서"));
    m.put("hwpx", new Kind("doc", "문서", "한글 문서"));
    m.put("txt", new Kind("doc", "문서", "텍스트"));
    m.put("md", new Kind("doc", "문서", "텍스트"));
    m.put("rtf", new Kind("doc", "문서", "문서"));
    m.put("odt", new Kind("doc", "문서", "문서"));
    // 시트 계열
    m.put("xlsx", new Kind("sheet", "스프레드시트", "Excel 시트"));
    m.put("xls", new Kind("sheet", "스프레드시트", "Excel 시트"));
    m.put("ods", new Kind("sheet", "스프레드시트", "스프레드시트"));
    m.put("csv", new Kind("sheet", "스프레드시트", "CSV"));
    // 슬라이드 계열
    m.put("pptx", new Kind("slide", "발표 자료", "PowerPoint"));
    m.put("ppt", new Kind("slide", "발표 자료", "PowerPoint"));
    m.put("key", new Kind("slide", "발표 자료", "Keynote"));
    m.put("odp", new Kind("slide", "발표 자료", "발표 자료"));
    // 이미지 계열 — jpg/jpeg 만 「JPG 이미지」, 나머지는 확장자 대문자 + 「 이미지」
    m.put("jpg", new Kind("image", "이미지", "JPG 이미지"));
    m.put("jpeg", new Kind("image", "이미지", "JPG 이미지"));
    for (String e : List.of("png", "gif", "webp", "heic", "bmp", "svg")) {
      m.put(e, new Kind("image", "이미지", e.toUpperCase(Locale.ROOT) + " 이미지"));
    }
    m.put("zip", new Kind("file", "파일", "ZIP"));
    return Map.copyOf(m);
  }

  /** 문서 계열 항목을 한꺼번에 넣는 도우미(그림 키·이름 공통, label 만 확장자별). */
  private static void put(
      Map<String, Kind> m, String imageKey, String imageName, Map<String, String> labels) {
    labels.forEach((ext, label) -> m.put(ext, new Kind(imageKey, imageName, label)));
  }

  /** 알려진 확장자가 없을 때 MIME 으로 같은 종류를 추정한다(값은 KIND_BY_EXT 의 항목). */
  private static final Map<String, Kind> MIME_TO_KIND =
      Map.ofEntries(
          Map.entry("application/pdf", KIND_BY_EXT.get("pdf")),
          Map.entry("application/msword", KIND_BY_EXT.get("doc")),
          Map.entry(
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              KIND_BY_EXT.get("docx")),
          Map.entry("application/vnd.ms-excel", KIND_BY_EXT.get("xls")),
          Map.entry(
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              KIND_BY_EXT.get("xlsx")),
          Map.entry("application/vnd.ms-powerpoint", KIND_BY_EXT.get("ppt")),
          Map.entry(
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              KIND_BY_EXT.get("pptx")),
          Map.entry("text/plain", KIND_BY_EXT.get("txt")),
          Map.entry("text/markdown", KIND_BY_EXT.get("md")),
          Map.entry("text/csv", KIND_BY_EXT.get("csv")),
          Map.entry("application/zip", KIND_BY_EXT.get("zip")));

  /** description·og:title·og:description 세 줄. */
  public static String metaHtml(DriveSharePreview p, ZonedDateTime now) {
    String title;
    String description;
    switch (p) {
      case Open o -> {
        title = o.name();
        // 만료가 없으면(null) 그 조각은 빼고 이어 붙인다
        String expiry = formatExpiry(o.expiresAt(), now);
        List<String> parts = new ArrayList<>();
        parts.add("공유된 파일");
        parts.add(typeLabel(o.name(), o.mimeType()));
        parts.add(FileSizeFormatter.format(o.sizeBytes()));
        if (expiry != null) parts.add(expiry);
        description = String.join(" · ", parts);
      }
      case FolderOpen fo -> {
        // WP-1538: 공유 폴더 기준(하위 이름 없음). 만료 없으면 그 조각은 뺀다.
        title = fo.name();
        String expiry = formatExpiry(fo.expiresAt(), now);
        description = "공유된 폴더 · 폴더 " + fo.folderCount() + "개 · 파일 " + fo.fileCount() + "개";
        if (expiry != null) description += " · " + expiry;
      }
      case PasswordProtected pw -> {
        title = isFolder(pw.target()) ? "비밀번호로 보호된 폴더" : "비밀번호로 보호된 공유 파일";
        description = "링크를 열고 비밀번호를 입력하면 볼 수 있습니다.";
      }
      case InternalOnly in -> {
        title = isFolder(in.target()) ? "사내 공유 폴더" : "사내 공유 파일";
        description = "Gen:iA Works 에 로그인하면 볼 수 있습니다.";
      }
    }
    String t = esc(title);
    String d = esc(description);
    return "<meta name=\"description\" content=\""
        + d
        + "\" />\n<meta property=\"og:title\" content=\""
        + t
        + "\" />\n<meta property=\"og:description\" content=\""
        + d
        + "\" />\n";
  }

  /** og:image 네 줄 — 주소의 호스트는 nginx 가 {@code __PUBLIC_HOST__} 를 치환한다. */
  public static String imageHtml(DriveSharePreview p) {
    String key;
    String alt;
    switch (p) {
      case Open o -> {
        key = imageKey(o.name(), o.mimeType());
        alt = kindOf(o.name(), o.mimeType()).imageName() + " · 드라이브 공유";
      }
      case FolderOpen fo -> {
        key = "folder";
        alt = "폴더 · 드라이브 공유";
      }
      case PasswordProtected pw -> {
        boolean folder = isFolder(pw.target());
        key = folder ? "folder-password" : "password";
        alt = folder ? "보호된 폴더 · 드라이브 공유" : PASSWORD_ALT;
      }
      case InternalOnly in -> {
        boolean folder = isFolder(in.target());
        key = folder ? "folder-internal" : "internal";
        alt = folder ? "사내 공유 폴더 · 드라이브 공유" : INTERNAL_ALT;
      }
    }
    return "<meta property=\"og:image\" content=\"https://__PUBLIC_HOST__/og/drive-"
        + key
        + ".png\" />\n<meta property=\"og:image:width\" content=\"1200\" />\n"
        + "<meta property=\"og:image:height\" content=\"630\" />\n"
        + "<meta property=\"og:image:alt\" content=\""
        + esc(alt)
        + "\" />\n";
  }

  /** 종류 그림 키 — 알려진 확장자 → 알려진 MIME → 이미지 MIME 순, 그 밖은 file. */
  public static String imageKey(String name, String mimeType) {
    return kindOf(name, mimeType).imageKey();
  }

  /**
   * 사람이 읽는 종류 이름. 알려진 확장자 → 알려진 MIME → 이미지 MIME(「이미지」) → 글자가 든 확장자(대문자) → 「파일」. 이름에 점만 있고 진짜 확장자가
   * 아닌 경우(예: {@code 회의록 v1.2})에 숫자 조각이 종류로 나오지 않게 한다.
   */
  public static String typeLabel(String name, String mimeType) {
    Kind known = knownKind(name, mimeType);
    if (known != null) return known.label();
    if (isImageMime(mimeType)) return "이미지";
    String raw = rawExtension(name);
    if (raw != null && raw.chars().anyMatch(Character::isLetter)) {
      return raw.toUpperCase(Locale.ROOT);
    }
    return "파일";
  }

  /** 종류 판정 한 곳 — 알려진 종류가 없으면 이미지 MIME 은 이미지, 그 밖은 파일. */
  private static Kind kindOf(String name, String mimeType) {
    Kind known = knownKind(name, mimeType);
    if (known != null) return known;
    return isImageMime(mimeType) ? KIND_BY_EXT.get("png") : FILE;
  }

  /** 만료 표기 — now 의 시간대로 바꿔 올해면 「M월 d일까지」, 아니면 연도를 붙인다. 만료 없음은 null. */
  public static String formatExpiry(OffsetDateTime expiresAt, ZonedDateTime now) {
    if (expiresAt == null) return null;
    ZonedDateTime z = expiresAt.atZoneSameInstant(now.getZone());
    String md = z.getMonthValue() + "월 " + z.getDayOfMonth() + "일까지";
    return z.getYear() == now.getYear() ? md : z.getYear() + "년 " + md;
  }

  /** 폴더 링크인지(WP-1538) — null 은 파일로 본다. */
  private static boolean isFolder(DriveShareTarget target) {
    return target == DriveShareTarget.FOLDER;
  }

  /** 소문자 확장자(이름의 마지막 {@code .} 뒤, 영숫자 5자 이하). 없거나 이상하면 null. */
  private static String rawExtension(String name) {
    if (name == null) return null;
    String ext = FilePathBuilder.extensionOf(name);
    boolean ok =
        !ext.isEmpty()
            && ext.length() <= 5
            && ext.chars().allMatch(c -> c < 128 && Character.isLetterOrDigit(c));
    return ok ? ext : null;
  }

  /** 알려진 종류(확장자 기준, 없으면 MIME 에서 추정). 어느 쪽도 모르면 null. */
  private static Kind knownKind(String name, String mimeType) {
    String raw = rawExtension(name);
    if (raw != null && KIND_BY_EXT.containsKey(raw)) return KIND_BY_EXT.get(raw);
    if (mimeType == null) return null;
    String m = mimeType.toLowerCase(Locale.ROOT);
    int semi = m.indexOf(';');
    if (semi >= 0) m = m.substring(0, semi).trim();
    return MIME_TO_KIND.get(m);
  }

  private static boolean isImageMime(String mimeType) {
    return mimeType != null && mimeType.toLowerCase(Locale.ROOT).startsWith("image/");
  }

  private static String esc(String v) {
    return HtmlUtils.htmlEscape(v, "UTF-8");
  }
}
