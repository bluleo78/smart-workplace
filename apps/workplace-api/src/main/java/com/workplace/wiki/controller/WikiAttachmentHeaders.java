package com.workplace.wiki.controller;

import com.workplace.file.api.ImageSniffer;
import com.workplace.file.service.MimeNormalizer;
import com.workplace.wiki.service.WikiAttachmentStorage;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * 노트 첨부 원본 응답의 머리글(WP-1545) — 로그인 경로({@code /content})와 외부 공유 경로가 같은 규칙을 쓰게 한 곳에 둔다.
 *
 * <p>규칙: 디스크 바이트 앞부분이 이미지(PNG·JPEG·GIF·WebP)로 판정될 때만 본문 &lt;img&gt; 용 {@code inline}(판정 MIME). 그 밖은
 * 모두 {@code attachment}(UTF-8 파일 이름)로 내려 API 출처에서 렌더되지 않게 하고, 스크립트를 돌릴 수 있는 형식(html·xml·svg·js)과 판정
 * 안 된 이미지 MIME 은 {@code application/octet-stream} 으로 바꾼다. 저장 MIME 이 아니라 바이트로 판정하는 이유 — 옛 행·드라이브와
 * 공유하는 file 행까지 저장값을 믿지 않고 같은 기준으로 막는다(16바이트 읽기라 싸다). 비이미지에는 CSP sandbox 도 붙인다(드라이브 원본과 같은 방어,
 * WP-1323).
 */
final class WikiAttachmentHeaders {

  private WikiAttachmentHeaders() {}

  /** 첨부 원본 응답 머리글 — Content-Type·Content-Disposition·Content-Length·nosniff(·CSP). */
  static HttpHeaders of(WikiAttachmentStorage.StoredFile f) {
    HttpHeaders headers = new HttpHeaders();
    Optional<String> sniffed = sniff(f);
    if (sniffed.isPresent()) {
      headers.setContentType(MediaType.parseMediaType(sniffed.get()));
      headers.setContentDisposition(
          ContentDisposition.inline().filename(f.originalName(), StandardCharsets.UTF_8).build());
    } else {
      headers.setContentType(MediaType.parseMediaType(downloadMime(f.mimeType())));
      headers.setContentDisposition(
          ContentDisposition.attachment()
              .filename(f.originalName(), StandardCharsets.UTF_8)
              .build());
      headers.set("Content-Security-Policy", "sandbox");
    }
    // 전역 SecurityConfig 도 붙이지만 공개 공유 체인에 기대지 않고 여기서 명시한다 — 브라우저 MIME 추측으로 렌더되는 것을 막는다.
    headers.set("X-Content-Type-Options", "nosniff");
    headers.setContentLength(f.sizeBytes());
    return headers;
  }

  /** 디스크 앞 16바이트로 이미지 판정 — 읽기 실패는 비이미지로 본다(안전한 쪽: attachment). */
  private static Optional<String> sniff(WikiAttachmentStorage.StoredFile f) {
    try {
      return ImageSniffer.detectFile(f.path());
    } catch (UncheckedIOException e) {
      return Optional.empty();
    }
  }

  /**
   * attachment 로 내려줄 MIME — 구체 타입이 아니거나, 문서로 렌더돼 스크립트를 돌릴 수 있거나(html·xml·*+xml·javascript), 바이트 판정을
   * 통과하지 못한 inline 이미지 MIME 이면 octet-stream.
   */
  static String downloadMime(String stored) {
    String mime = MimeNormalizer.concreteOrOctetStream(stored);
    if (MimeNormalizer.isActiveDocumentMime(mime)
        || mime.contains("javascript")
        || mime.contains("ecmascript")
        || MimeNormalizer.INLINE_CONTENT_MIMES.contains(mime)) {
      return MediaType.APPLICATION_OCTET_STREAM_VALUE;
    }
    return mime;
  }
}
