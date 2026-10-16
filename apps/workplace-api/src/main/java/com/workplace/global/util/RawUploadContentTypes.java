package com.workplace.global.util;

import com.workplace.file.service.MimeNormalizer;
import java.util.Optional;
import org.springframework.http.InvalidMediaTypeException;
import org.springframework.http.MediaType;

/**
 * 원시 바이트 PUT 업로드가 받는 Content-Type 규칙 — 드라이브 업로드 링크(WP-369)와 스테이징 업로드 링크(WP-421)가 함께 쓴다.
 *
 * <p>두 공개 PUT 경로가 같은 규칙을 따로 들고 있으면 한쪽만 고쳐져 갈라지므로 한곳에 둔다. 판정만 하고 예외는 던지지 않는다 — 호출자가 각자 예외(상태 415)로
 * 옮긴다. 거부는 본문을 받기 전·링크를 소비하기 전에 하므로 같은 링크로 다시 보낼 수 있다.
 *
 * <ul>
 *   <li>폼(application/x-www-form-urlencoded)·멀티파트: Spring 의 FormContentFilter 가 PUT 본문을 미리 읽어 버려 빈
 *       파일이 저장된다 — curl 의 {@code --data-binary} 기본값이다. 원시 바이트({@code curl -T})로 보내야 한다.
 *   <li>형식이 깨졌거나("text") 와일드카드(모든 형식·모든 하위 형식): 이 값이 FILE.mime_type 으로 저장되면 다운로드가 {@link
 *       MediaType#parseMediaType} 로 응답 헤더를 만들 때마다 500 이 난다.
 * </ul>
 */
public final class RawUploadContentTypes {

  private RawUploadContentTypes() {}

  /** 원시 PUT 본문으로 받지 않는 Content-Type 의 사유. 사용자 문구는 두 경로가 같다. */
  public enum Rejection {
    /** 폼·멀티파트 본문 — 비어서 저장된다. */
    FORM_OR_MULTIPART("파일을 원시 바이트로 보내세요(curl -T 파일 URL). 폼·멀티파트 본문은 받지 않습니다"),
    /** 형식이 깨졌거나 와일드카드 — 저장하면 내려받을 수 없다. */
    UNSERVABLE("Content-Type 형식이 올바르지 않습니다. Content-Type 없이 원시 바이트로 보내세요(curl -T 파일 URL)");

    private final String message;

    Rejection(String message) {
      this.message = message;
    }

    /** 링크 소지자에게 보일 문구(415 본문). */
    public String message() {
      return message;
    }
  }

  /**
   * 원시 PUT 본문의 Content-Type 을 판정한다. 없거나 비면 받는다(확장자로 MIME 을 정한다).
   *
   * @return 받지 않으면 그 사유, 받으면 빈 값
   */
  public static Optional<Rejection> rejectReason(String contentType) {
    String mime = bare(contentType);
    if (mime != null
        && (mime.equals("application/x-www-form-urlencoded") || mime.startsWith("multipart/"))) {
      return Optional.of(Rejection.FORM_OR_MULTIPART);
    }
    if (contentType != null && !contentType.isBlank() && !isServable(contentType)) {
      return Optional.of(Rejection.UNSERVABLE);
    }
    return Optional.empty();
  }

  /**
   * 저장해도 내려받을 수 있는 Content-Type 인지 — 파싱되고 와일드카드(모든 형식·모든 하위 형식)가 아니어야 한다.
   *
   * @param contentType 비어 있지 않은 Content-Type 원문
   */
  private static boolean isServable(String contentType) {
    try {
      MediaType type = MediaType.parseMediaType(contentType);
      return !type.isWildcardType() && !type.isWildcardSubtype();
    } catch (InvalidMediaTypeException e) {
      return false;
    }
  }

  /**
   * Content-Type·MIME 에서 매개변수(charset 등)를 떼고 소문자로 — "text/plain; charset=utf-8" 이 범주표·허용 목록에서 빠지지
   * 않게. 없거나 본체가 비면 null(호출자가 확장자로 정한다).
   */
  public static String bare(String contentType) {
    // 정규화 규칙은 MimeNormalizer.baseMime 하나 — 여기서는 "모름"을 빈 문자열 대신 null 로 돌려준다.
    String mime = MimeNormalizer.baseMime(contentType);
    return mime.isEmpty() ? null : mime;
  }
}
