package com.workplace.filepreview;

import com.workplace.file.service.MimeNormalizer;
import com.workplace.file.storage.FileStore;
import java.util.Map;
import java.util.Set;

/**
 * 문서 미리보기(서버 변환 PDF) 대상 형식 판정과 결과 경로 규칙(WP-431).
 *
 * <p>변환 서비스는 정규형 mime 만 받으므로 브라우저·OS 가 붙이는 별칭(한컴 등록 mime 등)을 여기서 정규형으로 바꾼다. 웹도 같은 표를 쓴다(계획서 Global
 * Constraints) — 한쪽만 고치면 "웹은 변환 뷰어를 여는데 API 는 404" 같은 드리프트가 생긴다.
 */
public final class PreviewTypes {

  private PreviewTypes() {}

  /** 변환 결과 파일 이름 — 원본 옆 보기 캐시 디렉터리 안에 둔다. */
  public static final String PREVIEW_FILE = "preview.pdf";

  /**
   * 변환 서비스로 보내는 정규형 mime(HWP·HWPX·PPTX·PPT·DOC·DOCX). XLS(X) 는 웹 시트 표, PDF 는 웹이 직접 그리므로 대상 아님.
   *
   * <p>DOCX 는 브라우저 렌더(mammoth)가 원본과 모양이 달라 서버 변환 PDF 로 통일한다(WP-1457).
   */
  private static final Set<String> TARGETS =
      Set.of(
          "application/x-hwp",
          "application/hwp+zip",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "application/vnd.ms-powerpoint",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

  /** 별칭 → 정규형. */
  private static final Map<String, String> ALIASES =
      Map.of(
          "application/haansofthwp", "application/x-hwp",
          "application/vnd.hancom.hwp", "application/x-hwp",
          "application/haansofthwpx", "application/hwp+zip",
          "application/vnd.hancom.hwpx", "application/hwp+zip");

  /**
   * 내용을 말해 주지 않는 범용 mime — 이 형식이면 파일명 확장자로 판정한다(빈 값 포함).
   *
   * <p>웹 {@code apps/workplace-web/src/lib/mimeFromFilename.ts} 의 {@code GENERIC_MIMES} 와 같은 목록이어야
   * 한다. 팀 채팅 업로드는 브라우저가 보낸 Content-Type 을 원문 저장해 force-download 등이 남을 수 있는데, 한쪽만 고치면 "웹은 변환 뷰어를 여는데
   * API 는 404(NOT_APPLICABLE)" 드리프트가 생긴다. 업로드 정규화({@link MimeNormalizer#normalize})는 V125 백필과 짝이라
   * 건드리지 않고 미리보기 판정에서만 넓힌다.
   */
  private static final Set<String> GENERIC_MIMES =
      Set.of(
          "application/octet-stream",
          "binary/octet-stream",
          "application/force-download",
          "application/x-download",
          "application/unknown");

  /**
   * 미리보기 변환 대상이면 변환 서비스에 보낼 정규형 mime 을, 아니면 null 을 돌려준다.
   *
   * <p>파라미터(";" 뒤)를 뗀 기본형을 별칭 표로 정규화한다. 기본형이 범용({@link #GENERIC_MIMES}·빈 값)이면 브라우저가 형식을 몰랐던 것이므로
   * 파일명 확장자로 판정한다({@link MimeNormalizer#normalize} 와 같은 확장자 표).
   *
   * @param mime file.mime_type 원문(null 가능)
   * @param fileName 원본 파일명(확장자 폴백용, null 가능)
   */
  public static String targetMime(String mime, String fileName) {
    String base = MimeNormalizer.baseMime(mime);
    if (base.isEmpty() || GENERIC_MIMES.contains(base)) {
      // 확장자를 모르면 normalize 가 octet-stream 을 돌려줘 아래에서 대상 아님(null)이 된다.
      base = MimeNormalizer.normalize(fileName, null);
    }
    String canonical = ALIASES.getOrDefault(base, base);
    return TARGETS.contains(canonical) ? canonical : null;
  }

  /**
   * 변환 PDF 저장 경로 — "{storage_path}.view/preview.pdf". 원본 삭제 시 {@link FileStore#deleteWithDerived} 가
   * 함께 지운다.
   */
  public static String previewPath(String storagePath) {
    return FileStore.viewCacheDir(storagePath) + "/" + PREVIEW_FILE;
  }
}
