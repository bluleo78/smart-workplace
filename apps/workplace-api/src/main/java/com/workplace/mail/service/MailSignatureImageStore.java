package com.workplace.mail.service;

import com.workplace.file.api.ImageSniffer;
import com.workplace.file.api.StorageQuotaGuard;
import com.workplace.file.storage.FilePathBuilder;
import com.workplace.file.storage.FileStore;
import com.workplace.file.storage.StorageDomain;
import com.workplace.global.net.SafeHttpFetcher;
import com.workplace.global.net.SafeHttpFetcher.FetchException;
import com.workplace.mail.repository.MailSignatureRepository;
import com.workplace.mail.repository.MailSignatureRepository.ImageRow;
import java.util.Arrays;
import java.util.Base64;
import java.util.Locale;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 메일 서명 이미지(WP-1517) 받기·저장·읽기. 붙여 넣은 서명의 {@code data:image/*;base64} 와 외부 http(s) 이미지를 바이트로 받아 형식을
 * 확인하고, 디스크 {@code tenant-*&#47;mail-signature/} 와 {@code mail_signature_image} 행으로 저장한다.
 *
 * <p>받기({@link #load})는 네트워크를 타므로 트랜잭션 밖에서, 저장({@link #save})은 트랜잭션 안에서 부른다 — 롤백되면 저장한 파일도 지운다. 이미지
 * 형식은 선언(data: 의 MIME, 응답 Content-Type)을 믿지 않고 {@link ImageSniffer} 로 바이트를 보고
 * 정한다(png·jpeg·gif·webp, svg 는 받지 않는다).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MailSignatureImageStore {

  /** 이미지 한 장 상한 512KB — Graph 인라인 합계 2MB 안에 붙여 넣은 캡처가 들어갈 자리를 남긴다. */
  public static final int MAX_IMAGE_BYTES = 512 * 1024;

  /** base64 로 이 길이를 넘으면 디코드하지 않고 버린다(512KB × 4/3 에 줄바꿈 여유). */
  private static final int MAX_BASE64_CHARS = MAX_IMAGE_BYTES / 3 * 4 + 64 * 1024;

  private final SafeHttpFetcher fetcher;
  private final FilePathBuilder pathBuilder;
  private final FileStore fileStore;
  private final MailSignatureRepository repository;
  private final StorageQuotaGuard quotaGuard;

  /** 받은 이미지 — mime 은 바이트로 판정한 값. */
  public record ImageBytes(String mime, byte[] bytes) {}

  /**
   * src 를 이미지 바이트로 받는다. {@code data:…;base64,} 는 디코드하고, http(s) 는 가드된 가져오기({@link
   * SafeHttpFetcher})로 받는다. 그 밖(file:·blob:·cid:·상대 경로)이나 받기 실패·512KB 초과·이미지가 아닌 바이트는 empty.
   */
  public Optional<ImageBytes> load(String src) {
    if (!isFetchable(src)) return Optional.empty();
    String s = src.trim();
    byte[] bytes = isDataUri(s) ? decodeDataUri(s) : fetch(s);
    if (bytes == null || bytes.length == 0 || bytes.length > MAX_IMAGE_BYTES) {
      return Optional.empty();
    }
    return ImageSniffer.detect(
            Arrays.copyOf(bytes, Math.min(bytes.length, ImageSniffer.HEAD_BYTES)))
        .map(mime -> new ImageBytes(mime, bytes));
  }

  /**
   * 새로 받을 수 있는 src 인가 — {@code data:} 또는 http(s)(대소문자·앞뒤 공백 무시). 그 밖(file:·blob:·cid:·상대 경로)은 받지
   * 않는다. 받기({@link #load})와 서명 저장의 후보 고르기가 같은 기준을 쓰도록 한곳에 둔다.
   */
  public static boolean isFetchable(String src) {
    if (src == null) return false;
    String lower = src.trim().toLowerCase(Locale.ROOT);
    return isDataUri(lower) || lower.startsWith("http://") || lower.startsWith("https://");
  }

  /** {@code data:} URI 인가(대소문자 무시). */
  private static boolean isDataUri(String src) {
    return src.regionMatches(true, 0, "data:", 0, 5);
  }

  /**
   * 이미지를 디스크와 행으로 저장하고 id 를 돌려준다. 트랜잭션 안에서 부른다(롤백되면 파일도 지운다).
   *
   * <p>바이트를 쓰기 전에 테넌트 저장 한도를 본다({@link StorageQuotaGuard}, 스테이징 업로드와 같은 잠금·한도) — 한도가 찬 테넌트에서 서명 저장이
   * 디스크를 계속 늘리지 않게. 넘으면 {@code DriveQuotaExceededException}(409)으로 저장 전체가 롤백된다. 다만 사용량 집계는 file 행만
   * 세므로 서명 이미지({@code mail_signature_image}) 자체는 사용량에 들어가지 않는다 — v1 결정(사용자당 장당 512KB·합계 1MB 로 작고,
   * 예전 임시저장이 가리킬 수 있어 지우지 않는다)을 유지하고, 한도가 이미 찬 테넌트에서 새 바이트를 쓰지 않는 것만 막는다.
   *
   * @throws com.workplace.drive.exception.DriveQuotaExceededException 저장 한도 초과(409)
   */
  public long save(long userId, ImageBytes image) {
    quotaGuard.assertWithinQuotaLocked(image.bytes().length);
    String path = pathBuilder.build(StorageDomain.MAIL_SIGNATURE, fileNameFor(image.mime()));
    fileStore.storeBytes(path, image.bytes());
    fileStore.deleteOnRollback(path);
    return repository.insertImage(userId, path, image.mime(), image.bytes().length);
  }

  /** 저장한 이미지 바이트. */
  public byte[] read(ImageRow row) {
    return fileStore.readAllBytes(row.storagePath());
  }

  /** 서명 이미지 파일 이름({@code signature.<확장자>}) — 디스크 저장 이름과 발송용 사본 이름이 같은 규칙을 쓴다. */
  public static String fileNameFor(String mime) {
    return "signature." + extensionOf(mime);
  }

  /** 저장 이름 확장자 — 판정한 MIME 에서 정한다. */
  private static String extensionOf(String mime) {
    return switch (mime) {
      case "image/png" -> "png";
      case "image/jpeg" -> "jpg";
      case "image/gif" -> "gif";
      case "image/webp" -> "webp";
      default -> "bin";
    };
  }

  /** {@code data:<mime>;base64,<payload>} 만 받는다(base64 가 아닌 data: 는 null). 선언 MIME 은 보지 않는다. */
  private static byte[] decodeDataUri(String src) {
    int comma = src.indexOf(',');
    if (comma < 0) return null;
    String meta = src.substring(5, comma).toLowerCase(Locale.ROOT);
    if (!meta.endsWith(";base64")) return null;
    String payload = src.substring(comma + 1);
    if (payload.length() > MAX_BASE64_CHARS) return null;
    try {
      return Base64.getMimeDecoder().decode(payload);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  /** 외부 이미지를 가드된 GET 으로 받는다(image/* 만, 512KB 상한). 실패는 null — 그 img 는 빠진다. */
  private byte[] fetch(String url) {
    try {
      return fetcher
          .fetch(url, "image/*", mime -> mime.startsWith("image/"), MAX_IMAGE_BYTES)
          .body();
    } catch (FetchException e) {
      log.info("서명 외부 이미지 받기 실패: {}", e.getMessage());
      return null;
    }
  }
}
