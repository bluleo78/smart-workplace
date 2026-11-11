package com.workplace.drive.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.service.DriveSharePreview.InternalOnly;
import com.workplace.drive.service.DriveSharePreview.Open;
import com.workplace.drive.service.DriveSharePreview.PasswordProtected;
import com.workplace.global.util.FileSizeFormatter;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import org.junit.jupiter.api.Test;

/** 드라이브 공유 미리보기 메타 포매터(WP-1473) 단위 테스트. */
class DriveSharePreviewMetaTest {
  private static final ZonedDateTime NOW =
      ZonedDateTime.parse("2026-11-11T10:00:00+09:00[Asia/Seoul]");

  @Test
  void typeLabel_byExtensionThenMime() {
    String o = "application/octet-stream";
    assertThat(DriveSharePreviewMeta.typeLabel("a.pdf", o)).isEqualTo("PDF");
    assertThat(DriveSharePreviewMeta.typeLabel("a.docx", o)).isEqualTo("Word 문서");
    assertThat(DriveSharePreviewMeta.typeLabel("a.doc", o)).isEqualTo("Word 문서");
    assertThat(DriveSharePreviewMeta.typeLabel("a.hwp", o)).isEqualTo("한글 문서");
    assertThat(DriveSharePreviewMeta.typeLabel("a.hwpx", o)).isEqualTo("한글 문서");
    assertThat(DriveSharePreviewMeta.typeLabel("a.txt", o)).isEqualTo("텍스트");
    assertThat(DriveSharePreviewMeta.typeLabel("a.md", o)).isEqualTo("텍스트");
    assertThat(DriveSharePreviewMeta.typeLabel("a.xlsx", o)).isEqualTo("Excel 시트");
    assertThat(DriveSharePreviewMeta.typeLabel("a.xls", o)).isEqualTo("Excel 시트");
    assertThat(DriveSharePreviewMeta.typeLabel("a.csv", o)).isEqualTo("CSV");
    assertThat(DriveSharePreviewMeta.typeLabel("a.pptx", o)).isEqualTo("PowerPoint");
    assertThat(DriveSharePreviewMeta.typeLabel("a.ppt", o)).isEqualTo("PowerPoint");
    assertThat(DriveSharePreviewMeta.typeLabel("a.jpg", o)).isEqualTo("JPG 이미지");
    assertThat(DriveSharePreviewMeta.typeLabel("a.jpeg", o)).isEqualTo("JPG 이미지");
    assertThat(DriveSharePreviewMeta.typeLabel("a.png", o)).isEqualTo("PNG 이미지");
    assertThat(DriveSharePreviewMeta.typeLabel("a.gif", o)).isEqualTo("GIF 이미지");
    assertThat(DriveSharePreviewMeta.typeLabel("a.zip", o)).isEqualTo("ZIP");
    assertThat(DriveSharePreviewMeta.typeLabel("보고서.PDF", o)).isEqualTo("PDF");
    assertThat(DriveSharePreviewMeta.typeLabel("noext", "application/pdf")).isEqualTo("PDF");
    assertThat(DriveSharePreviewMeta.typeLabel("noext", "application/x-unknown")).isEqualTo("파일");
    assertThat(DriveSharePreviewMeta.typeLabel("a.dwg", o)).isEqualTo("DWG");
    assertThat(DriveSharePreviewMeta.typeLabel("a.key", o)).isEqualTo("Keynote");
    assertThat(DriveSharePreviewMeta.typeLabel("a.odp", o)).isEqualTo("발표 자료");
    assertThat(DriveSharePreviewMeta.typeLabel("a.ods", o)).isEqualTo("스프레드시트");
    assertThat(DriveSharePreviewMeta.typeLabel("a.odt", o)).isEqualTo("문서");
  }

  @Test
  void dotWithoutRealExtension_fallsBackToMimeThenFile() {
    assertThat(DriveSharePreviewMeta.typeLabel("회의록 v1.2", "application/pdf")).isEqualTo("PDF");
    assertThat(DriveSharePreviewMeta.imageKey("회의록 v1.2", "application/pdf")).isEqualTo("pdf");
    assertThat(DriveSharePreviewMeta.typeLabel("report.final", "application/pdf")).isEqualTo("PDF");
    assertThat(DriveSharePreviewMeta.typeLabel("report.final", "application/octet-stream"))
        .isEqualTo("FINAL");
    assertThat(DriveSharePreviewMeta.imageKey("report.final", "application/octet-stream"))
        .isEqualTo("file");
    assertThat(DriveSharePreviewMeta.typeLabel("v1.2", "application/x-unknown")).isEqualTo("파일");
    assertThat(DriveSharePreviewMeta.imageKey("v1.2", "application/x-unknown")).isEqualTo("file");
  }

  @Test
  void imageKey_mapping() {
    String o = "application/octet-stream";
    assertThat(DriveSharePreviewMeta.imageKey("a.pdf", o)).isEqualTo("pdf");
    for (String e : new String[] {"docx", "doc", "hwp", "hwpx", "txt", "md", "rtf", "odt"}) {
      assertThat(DriveSharePreviewMeta.imageKey("a." + e, o)).as(e).isEqualTo("doc");
    }
    for (String e : new String[] {"xlsx", "xls", "csv", "ods"}) {
      assertThat(DriveSharePreviewMeta.imageKey("a." + e, o)).as(e).isEqualTo("sheet");
    }
    for (String e : new String[] {"pptx", "ppt", "key", "odp"}) {
      assertThat(DriveSharePreviewMeta.imageKey("a." + e, o)).as(e).isEqualTo("slide");
    }
    for (String e : new String[] {"jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "svg"}) {
      assertThat(DriveSharePreviewMeta.imageKey("a." + e, o)).as(e).isEqualTo("image");
    }
    assertThat(DriveSharePreviewMeta.imageKey("noext", "image/avif")).isEqualTo("image");
    assertThat(DriveSharePreviewMeta.imageKey("a.zip", o)).isEqualTo("file");
  }

  @Test
  void formatSize_matchesWeb() {
    assertThat(FileSizeFormatter.format(512)).isEqualTo("512 B");
    assertThat(FileSizeFormatter.format(2048)).isEqualTo("2.0 KB");
    assertThat(FileSizeFormatter.format(2_411_725)).isEqualTo("2.3 MB");
    assertThat(FileSizeFormatter.format(3_221_225_472L)).isEqualTo("3.0 GB");
  }

  @Test
  void formatExpiry_inNowZone() {
    assertThat(
            DriveSharePreviewMeta.formatExpiry(OffsetDateTime.parse("2026-11-18T05:00:00Z"), NOW))
        .isEqualTo("11월 18일까지");
    assertThat(
            DriveSharePreviewMeta.formatExpiry(OffsetDateTime.parse("2026-11-18T15:30:00Z"), NOW))
        .isEqualTo("11월 19일까지");
    assertThat(
            DriveSharePreviewMeta.formatExpiry(
                OffsetDateTime.parse("2027-01-03T00:00:00+09:00"), NOW))
        .isEqualTo("2027년 1월 3일까지");
    assertThat(DriveSharePreviewMeta.formatExpiry(null, NOW)).isNull();
  }

  @Test
  void metaHtml_open_escapesAndFormats() {
    var p =
        new Open(
            "2026 \"사업\" <계획>&.pdf",
            "application/pdf",
            2_411_725,
            OffsetDateTime.parse("2026-11-18T05:00:00Z"));
    String html = DriveSharePreviewMeta.metaHtml(p, NOW);
    String desc = "공유된 파일 · PDF · 2.3 MB · 11월 18일까지";
    assertThat(html)
        .contains(
            "<meta property=\"og:title\" content=\"2026 &quot;사업&quot; &lt;계획&gt;&amp;.pdf\" />")
        .contains("<meta property=\"og:description\" content=\"" + desc + "\" />")
        .contains("<meta name=\"description\" content=\"" + desc + "\" />");

    var noExpiry = new Open("a.pdf", "application/pdf", 2_411_725, null);
    assertThat(DriveSharePreviewMeta.metaHtml(noExpiry, NOW))
        .contains("content=\"공유된 파일 · PDF · 2.3 MB\"");
  }

  @Test
  void metaHtml_gated_hasNoFileInfo() {
    assertThat(DriveSharePreviewMeta.metaHtml(new PasswordProtected(), NOW))
        .contains("og:title\" content=\"비밀번호로 보호된 공유 파일\"")
        .contains("name=\"description\" content=\"링크를 열고 비밀번호를 입력하면 볼 수 있습니다.\"")
        .contains("og:description\" content=\"링크를 열고 비밀번호를 입력하면 볼 수 있습니다.\"");
    assertThat(DriveSharePreviewMeta.metaHtml(new InternalOnly(), NOW))
        .contains("og:title\" content=\"사내 공유 파일\"")
        .contains("name=\"description\" content=\"Gen:iA Works 에 로그인하면 볼 수 있습니다.\"")
        .contains("og:description\" content=\"Gen:iA Works 에 로그인하면 볼 수 있습니다.\"");
  }

  @Test
  void imageHtml_keysAndAlt() {
    String pdf = DriveSharePreviewMeta.imageHtml(new Open("a.pdf", "application/pdf", 1, null));
    assertThat(pdf)
        .contains(
            "<meta property=\"og:image\" content=\"https://__PUBLIC_HOST__/og/drive-pdf.png\" />")
        .contains("og:image:width\" content=\"1200\"")
        .contains("og:image:height\" content=\"630\"")
        .contains("og:image:alt\" content=\"PDF 파일 · 드라이브 공유\"");
    assertThat(DriveSharePreviewMeta.imageHtml(new Open("a.xlsx", "x", 1, null)))
        .contains("drive-sheet.png")
        .contains("스프레드시트 · 드라이브 공유");
    assertThat(DriveSharePreviewMeta.imageHtml(new Open("a.pptx", "x", 1, null)))
        .contains("발표 자료 · 드라이브 공유");
    assertThat(DriveSharePreviewMeta.imageHtml(new Open("a.zip", "x", 1, null)))
        .contains("drive-file.png")
        .contains("파일 · 드라이브 공유");
    assertThat(DriveSharePreviewMeta.imageHtml(new PasswordProtected()))
        .contains("drive-password.png")
        .contains("보호된 파일 · 비밀번호 필요");
    assertThat(DriveSharePreviewMeta.imageHtml(new InternalOnly()))
        .contains("drive-internal.png")
        .contains("사내 공유 파일 · 로그인 필요");
  }
}
