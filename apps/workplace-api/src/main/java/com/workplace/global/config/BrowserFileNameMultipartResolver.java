package com.workplace.global.config;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.Part;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import org.springframework.web.multipart.support.StandardMultipartHttpServletRequest;
import org.springframework.web.multipart.support.StandardServletMultipartResolver;

/**
 * 브라우저가 멀티파트 파일명에 넣은 이스케이프를 되돌리는 MultipartResolver(WP-1074).
 *
 * <p>브라우저(HTML 표준 multipart/form-data 인코딩)는 따옴표로 감싼 {@code filename="…"} 의 큰따옴표·CR·LF 를 각각 {@code
 * %22}·{@code %0D}·{@code %0A} 로 바꿔 보낸다(curl·urllib3 등도 같은 규칙). 서블릿 파서는 이를 되돌리지 않아 {@code a"b.txt}
 * 가 {@code a%22b.txt} 로 저장됐다. 업로드 경로(드라이브·첨부·노트 이미지 등)가 모두 {@link
 * MultipartFile#getOriginalFilename()} 으로 이름을 읽으므로, 한곳(파일 목록을 만든 직후)에서 되돌려 모든 업로드에 적용한다.
 *
 * <ul>
 *   <li>{@code %22} 는 큰따옴표로 되돌린다. CR·LF 는 이름에 남으면 오류 문구·로그의 줄을 바꾸므로 되돌리지 않고 바로 "_" 로 바꾼다 — 저장 전 이름
 *       정리({@code SafeFileNames.sanitize})가 하던 것과 같은 결과다.
 *   <li>{@code filename*=}(RFC 5987) 로 보낸 파트는 이미 퍼센트 디코딩된 값이라 건드리지 않는다 — 두 번 풀면 글자 그대로의 {@code %22}
 *       가 따옴표로 바뀐다.
 * </ul>
 *
 * <p>표준은 {@code %} 자체를 이스케이프하지 않아, 따옴표 형식으로 온 이름에 글자 그대로 {@code %22} 가 있던 파일은 {@code "} 로 바뀐다 — 이
 * 형식에서는 둘을 가를 수 없고, 따옴표 쪽이 훨씬 흔하다.
 */
public class BrowserFileNameMultipartResolver extends StandardServletMultipartResolver {

  /** 부모의 resolveLazily 는 private 이라 같은 값을 따로 쥔다(Boot 가 setter 로 넣는다). */
  private boolean resolveLazily;

  @Override
  public void setResolveLazily(boolean resolveLazily) {
    super.setResolveLazily(resolveLazily);
    this.resolveLazily = resolveLazily;
  }

  @Override
  public MultipartHttpServletRequest resolveMultipart(HttpServletRequest request)
      throws MultipartException {
    return new DecodingRequest(request, resolveLazily);
  }

  /**
   * 브라우저 이스케이프를 되돌린다 — {@code %22} 는 큰따옴표, {@code %0D}·{@code %0A} 는 "_". 표준이 대문자로만 쓰므로 대문자만 본다.
   * null 은 그대로.
   */
  static String decodeFileName(String name) {
    if (name == null || name.indexOf('%') < 0) {
      return name;
    }
    return name.replace("%22", "\"").replace("%0D", "_").replace("%0A", "_");
  }

  /** 파일 목록을 파싱한 직후(즉시·지연 모두) 이름을 되돌린 파일로 바꿔 끼우는 요청. */
  private static final class DecodingRequest extends StandardMultipartHttpServletRequest {

    DecodingRequest(HttpServletRequest request, boolean lazyParsing) {
      super(request, lazyParsing);
      // 즉시 파싱이면 부모 생성자가 이미 파일 목록을 만들었다 — 지연 파싱은 initializeMultipart 에서 한다.
      if (!lazyParsing) {
        decodeFiles();
      }
    }

    @Override
    protected void initializeMultipart() {
      super.initializeMultipart();
      decodeFiles();
    }

    /**
     * 따옴표 형식으로 온 파일의 이름만 되돌린다. 부모는 파트 순서대로 파일 목록을 만들므로(파일명이 있는 파트만), 같은 순서로 파트 머리글을 다시 읽어 필드별 n 번째
     * 파일이 어떤 형식으로 왔는지 맞춘다. 대부분의 업로드는 되돌릴 이스케이프가 없어 목록을 다시 만들지 않는다.
     */
    private void decodeFiles() {
      MultiValueMap<String, MultipartFile> files = getMultipartFiles();
      boolean anyEscape =
          files.values().stream()
              .flatMap(List::stream)
              .map(MultipartFile::getOriginalFilename)
              .anyMatch(n -> !Objects.equals(decodeFileName(n), n));
      if (!anyEscape) {
        return;
      }
      Map<String, Deque<Boolean>> quotedByField = quotedFlagsByField();
      MultiValueMap<String, MultipartFile> decoded = new LinkedMultiValueMap<>();
      files.forEach(
          (field, list) -> {
            Deque<Boolean> quoted = quotedByField.getOrDefault(field, new ArrayDeque<>());
            for (MultipartFile file : list) {
              // 짝을 못 찾으면(있을 수 없지만) 되돌리지 않는다 — 원래 동작 그대로.
              decoded.add(field, Boolean.TRUE.equals(quoted.poll()) ? decode(file) : file);
            }
          });
      setMultipartFiles(decoded);
    }

    /** 필드별로, 파일명이 있는 파트마다 「따옴표 형식(filename*= 없음)인가」를 파트 순서대로. */
    private Map<String, Deque<Boolean>> quotedFlagsByField() {
      Map<String, Deque<Boolean>> flags = new HashMap<>();
      try {
        for (Part part : getRequest().getParts()) {
          String header = part.getHeader(HttpHeaders.CONTENT_DISPOSITION);
          // 부모와 같은 기준(파싱한 파일명이 있는 파트)으로 센다. 「filename」 글자가 없는 일반 필드는 파싱하지 않고 넘긴다.
          if (header == null
              || !header.toLowerCase(Locale.ROOT).contains("filename")
              || ContentDisposition.parse(header).getFilename() == null) {
            continue;
          }
          boolean quoted = !header.toLowerCase(Locale.ROOT).contains("filename*");
          flags.computeIfAbsent(part.getName(), k -> new ArrayDeque<>()).add(quoted);
        }
      } catch (IOException | ServletException e) {
        // 부모가 이미 같은 파트를 읽었으므로 여기서 실패할 일은 없다 — 실패하면 아무 이름도 되돌리지 않는다.
        return Map.of();
      }
      return flags;
    }

    private static MultipartFile decode(MultipartFile file) {
      String original = file.getOriginalFilename();
      String name = decodeFileName(original);
      return name == null || name.equals(original) ? file : new RenamedMultipartFile(file, name);
    }
  }

  /** 원본 파일명만 바꾸고 나머지(바이트·크기·옮기기)는 원래 파트에 맡기는 파일. */
  private record RenamedMultipartFile(MultipartFile delegate, String originalFilename)
      implements MultipartFile {

    @Override
    public String getName() {
      return delegate.getName();
    }

    @Override
    public String getOriginalFilename() {
      return originalFilename;
    }

    @Override
    public String getContentType() {
      return delegate.getContentType();
    }

    @Override
    public boolean isEmpty() {
      return delegate.isEmpty();
    }

    @Override
    public long getSize() {
      return delegate.getSize();
    }

    @Override
    public byte[] getBytes() throws IOException {
      return delegate.getBytes();
    }

    @Override
    public InputStream getInputStream() throws IOException {
      return delegate.getInputStream();
    }

    @Override
    public void transferTo(File dest) throws IOException {
      delegate.transferTo(dest);
    }

    @Override
    public void transferTo(Path dest) throws IOException {
      delegate.transferTo(dest);
    }
  }
}
