package com.workplace.mail.service;

import com.workplace.file.dto.StagedFileResponse;
import com.workplace.file.service.StagedUploadService;
import com.workplace.mail.dto.MailSignatureResponse;
import com.workplace.mail.dto.MailSignatureUpdateRequest;
import com.workplace.mail.dto.SignatureImageStaged;
import com.workplace.mail.exception.MailSignatureImageNotFoundException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.repository.MailSignatureRepository;
import com.workplace.mail.repository.MailSignatureRepository.ImageRow;
import com.workplace.mail.repository.MailSignatureRepository.SignatureRow;
import com.workplace.mail.service.MailSignatureImageStore.ImageBytes;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jsoup.nodes.Element;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 내 메일 서명(WP-1517) 조회·저장, 서명 이미지 읽기, 발송용 이미지 사본. 서명은 사용자당 하나다(메일 계정별이 아니다).
 *
 * <p>저장 순서: 값·요청 크기 검사 → HTML 정리({@link MailSignatureHtmlSanitizer}) → img src 별로 이미지 받기(트랜잭션 밖 —
 * 외부 이미지는 네트워크를 타므로 나란히 받는다) → 트랜잭션 안에서 상한(개수·합계)을 보며 저장하고 src 를 {@code
 * /api/v1/mail/signature/images/{id}} 로 바꿈(남길 수 없는 img 는 빼고 센다) → 정리 뒤 크기 검사 → upsert. 글자도 이미지도 없으면
 * '' 로 저장한다.
 *
 * <p>서명 이미지 파일은 서명을 바꾸거나 비워도 지우지 않는다 — 예전 임시저장이 옛 이미지를 가리킬 수 있다(사용자당 합계 1MB × 저장 횟수로 작다).
 */
@Service
public class MailSignatureService {

  /** 서명 이미지 src 접두사 — 웹 lib/mailSignature.ts 가 같은 문자열을 쓴다. */
  public static final String IMAGE_PATH_PREFIX = "/api/v1/mail/signature/images/";

  /**
   * 요청 html 상한(문자 수) 8,000,000. 이미지 처리 전에 보는 값이라, Outlook 에서 data: 이미지를 여러 장 붙여 넣은 서명도 거절하지 않고 이미지
   * 처리(10장·합계 1MB 를 넘는 것은 빼고 센다)까지 가야 한다 — 512KB 이미지 10장의 base64(약 7.0M 자)에 서식 여유를 더한 값. 예전 3MB 는 큰
   * 이미지 3~4장만 붙여도 400 이 나 droppedImageCount 가 쓰일 틈이 없었다. JSON 본문이라 Tomcat 폼 상한
   * (max-http-form-post-size)은 걸리지 않고, Jackson 문자열 상한(기본 20M 자)·ingress proxy-body-size 보다 작다. 정리 뒤
   * 상한은 따로 {@link #MAX_SAVED_HTML_BYTES}.
   */
  static final int MAX_REQUEST_HTML_CHARS = 8_000_000;

  /** 정리·이미지 처리 뒤 html 상한(UTF-8) 100KB — 이미지는 경로로 바뀌므로 글·서식만으로 이 값을 넘지 않는다. */
  static final int MAX_SAVED_HTML_BYTES = 100 * 1024;

  /** 서명 한 개의 이미지 수 상한(서로 다른 src 기준). */
  static final int MAX_IMAGES = 10;

  /**
   * 서명 이미지 합계 상한 1MB — Graph 인라인 합계 2MB({@code MailComposeService.MAX_INLINE_TOTAL_*}) 안에 붙여 넣은 캡처가
   * 들어갈 자리를 남긴다.
   */
  static final long MAX_TOTAL_IMAGE_BYTES = 1024 * 1024;

  /** 발송용 사본 한 번에 만들 수 있는 이미지 수. 서명 하나는 10장이라 예전 서명이 섞인 본문도 들어간다. */
  static final int MAX_STAGE_IDS = 20;

  static final String TOO_LONG = "서명이 너무 길어요";

  /** 서명 이미지 경로 — 접두사({@link #IMAGE_PATH_PREFIX})에서 만들어 두 값이 어긋나지 않게 한다. */
  private static final Pattern IMAGE_PATH =
      Pattern.compile("^" + Pattern.quote(IMAGE_PATH_PREFIX) + "(\\d+)$");

  private final MailSignatureRepository repository;
  private final MailSignatureHtmlSanitizer sanitizer;
  private final MailSignatureImageStore imageStore;
  private final StagedUploadService stagedUploadService;
  private final TransactionTemplate txTemplate;
  private final Executor fetchExecutor;

  public MailSignatureService(
      MailSignatureRepository repository,
      MailSignatureHtmlSanitizer sanitizer,
      MailSignatureImageStore imageStore,
      StagedUploadService stagedUploadService,
      PlatformTransactionManager txManager,
      @Qualifier("mailSignatureFetchExecutor") Executor fetchExecutor) {
    this.repository = repository;
    this.sanitizer = sanitizer;
    this.imageStore = imageStore;
    this.stagedUploadService = stagedUploadService;
    this.txTemplate = new TransactionTemplate(txManager);
    this.fetchExecutor = fetchExecutor;
  }

  /** 서명 이미지 경로({@code /api/v1/mail/signature/images/{id}})면 id, 아니면 empty. */
  public static Optional<Long> imageIdOf(String src) {
    if (src == null) return Optional.empty();
    Matcher m = IMAGE_PATH.matcher(src.trim());
    if (!m.matches()) return Optional.empty();
    try {
      return Optional.of(Long.parseLong(m.group(1)));
    } catch (NumberFormatException e) {
      return Optional.empty();
    }
  }

  /** 내 서명. 행이 없으면 기본값(빈 서명, 새 메일 켬, 답장·전달 끔). */
  @Transactional(readOnly = true)
  public MailSignatureResponse get(long userId) {
    return repository.find(userId).map(r -> toResponse(r, 0)).orElse(MailSignatureResponse.empty());
  }

  /**
   * img src 하나를 무엇으로 남길지 — 내 서명 이미지 경로({@code ownedId})이거나 새로 받은 이미지({@code loaded}). 둘 다 없으면 받기
   * 실패라 뺀다.
   */
  private record Candidate(Long ownedId, ImageBytes loaded) {

    /** 받기 실패(또는 예상 밖 오류) — 그 img 만 뺀다. */
    static final Candidate FAILED = new Candidate(null, null);
  }

  /**
   * 서명을 저장한다. 트랜잭션은 이미지를 받은 뒤 DB·디스크 쓰기에만 건다(외부 이미지 받기가 DB 연결을 붙잡지 않게).
   *
   * @throws MailValidationException 값이 비었거나(null) 요청·정리 뒤 html 이 상한을 넘음(400)
   */
  public MailSignatureResponse update(long userId, MailSignatureUpdateRequest req) {
    if (req == null || req.html() == null || req.autoNew() == null || req.autoReply() == null) {
      throw new MailValidationException("서명 설정 값이 비어 있어요");
    }
    if (req.html().length() > MAX_REQUEST_HTML_CHARS) {
      throw new MailValidationException(TOO_LONG);
    }
    Element body = sanitizer.clean(req.html());
    List<Element> imgs = body.select("img");

    // 1) 처음 나온 순서로 서로 다른 src 를 MAX_IMAGES 개까지만 후보로 고른다 — 같은 로고가 두 번 나와도 한 번만 받고, 11번째부터는 받지 않는다.
    // 새로 받을 이미지(data:·외부 URL)는 고르는 대로 나란히 받기 시작한다 — 외부 이미지는 건마다 네트워크 지연이 있어 순서대로 받으면 저장이 장수만큼
    // 길어진다. 맵은 후보 순서를 지킨다(합계 1MB 를 앞에서부터 채우는 규칙이 순서에 기대므로).
    Map<String, CompletableFuture<Candidate>> candidates = new LinkedHashMap<>();
    for (Element img : imgs) {
      String src = img.attr("src").trim();
      if (candidates.containsKey(src) || candidates.size() >= MAX_IMAGES || !isLoadable(src)) {
        continue;
      }
      candidates.put(src, candidateOf(src));
    }
    // 받기는 트랜잭션 밖에서 모두 끝낸다(외부 이미지 받기가 DB 연결을 붙잡지 않게). 실패는 Candidate.FAILED 로 바뀌어 여기서 던지지 않는다.
    CompletableFuture.allOf(candidates.values().toArray(CompletableFuture[]::new)).join();

    // 2) 트랜잭션 안에서 상한을 보며 저장하고 src 를 바꾼다. 실패(크기 초과 400)하면 저장한 파일도 롤백 때 지워진다.
    return txTemplate.execute(
        status -> {
          Map<String, String> resolved = resolveImages(userId, candidates);
          int dropped = 0;
          for (Element img : imgs) {
            String path = resolved.get(img.attr("src").trim());
            if (path != null) {
              img.attr("src", path);
            } else {
              img.remove();
              dropped++;
            }
          }
          String html =
              MailSignatureHtmlSanitizer.isBlank(body)
                  ? ""
                  : MailSignatureHtmlSanitizer.toHtml(body);
          if (html.getBytes(StandardCharsets.UTF_8).length > MAX_SAVED_HTML_BYTES) {
            throw new MailValidationException(TOO_LONG);
          }
          SignatureRow row = repository.upsert(userId, html, req.autoNew(), req.autoReply());
          return toResponse(row, dropped);
        });
  }

  /**
   * 후보마다 남길 경로를 정한다 — 내 이미지는 그대로(남의 것·없는 id 는 뺀다), 받은 이미지는 합계 1MB 안에서 저장한다. 내 이미지 크기도 합계에 든다.
   *
   * @return src → 서명 이미지 경로(빠질 src 는 없음)
   */
  private Map<String, String> resolveImages(
      long userId, Map<String, CompletableFuture<Candidate>> candidates) {
    // 받기는 update() 가 트랜잭션 전에 모두 끝냈으므로 join 은 기다리지 않는다.
    List<Long> ownedIds =
        candidates.values().stream().map(f -> f.join().ownedId()).filter(id -> id != null).toList();
    Map<Long, ImageRow> owned = repository.findImagesById(userId, ownedIds);
    Map<String, String> resolved = new HashMap<>();
    long total = 0;
    for (Map.Entry<String, CompletableFuture<Candidate>> e : candidates.entrySet()) {
      Candidate c = e.getValue().join();
      ImageRow ownedRow = c.ownedId() == null ? null : owned.get(c.ownedId());
      long size;
      if (ownedRow != null) {
        size = ownedRow.sizeBytes();
      } else if (c.loaded() != null) {
        size = c.loaded().bytes().length;
      } else {
        continue;
      }
      if (total + size > MAX_TOTAL_IMAGE_BYTES) continue;
      total += size;
      long id = ownedRow != null ? ownedRow.id() : imageStore.save(userId, c.loaded());
      resolved.put(e.getKey(), IMAGE_PATH_PREFIX + id);
    }
    return resolved;
  }

  /**
   * src 하나의 후보 — 내 서명 이미지 경로면 바로(받지 않음), 아니면 {@link #fetchExecutor} 에서 받기 시작한다. 받기 중 예외(예상 밖 오류)는
   * 받기 실패처럼 {@link Candidate#FAILED} 로 바꿔 그 img 만 뺀다.
   */
  private CompletableFuture<Candidate> candidateOf(String src) {
    Optional<Long> owned = imageIdOf(src);
    if (owned.isPresent()) {
      return CompletableFuture.completedFuture(new Candidate(owned.get(), null));
    }
    return CompletableFuture.supplyAsync(
            () -> imageStore.load(src).map(b -> new Candidate(null, b)).orElse(Candidate.FAILED),
            fetchExecutor)
        .exceptionally(e -> Candidate.FAILED);
  }

  /** 받거나 남길 수 있는 src 인가 — 내 서명 이미지 경로·data:·http(s). file:·blob:·cid: 등은 후보 자리를 차지하지 않고 바로 빠진다. */
  private static boolean isLoadable(String src) {
    return imageIdOf(src).isPresent() || MailSignatureImageStore.isFetchable(src);
  }

  /** 서명 이미지 바이트와 MIME. */
  public record ImageContent(String mimeType, byte[] bytes) {}

  /**
   * 내 서명 이미지를 읽는다.
   *
   * @throws MailSignatureImageNotFoundException 없거나 남의 이미지(404)
   */
  @Transactional(readOnly = true)
  public ImageContent readImage(long userId, long imageId) {
    ImageRow row =
        repository.findImage(userId, imageId).orElseThrow(MailSignatureImageNotFoundException::new);
    return new ImageContent(row.mimeType(), imageStore.read(row));
  }

  /**
   * 서명 이미지의 발송용 사본을 만든다 — 서명 이미지는 영구 파일이고 작성창 업로드는 보내면 소비되는 24시간짜리라, 보낼 때마다 작성창 업로드를 새로 만든다. 요청
   * 순서대로, 중복 id 는 한 번만. 하나라도 내 것이 아니면 아무것도 만들지 않는다(트랜잭션).
   *
   * @throws MailValidationException 목록이 비었거나 20개 초과(400)
   * @throws MailSignatureImageNotFoundException 없거나 남의 이미지가 섞임(404)
   */
  @Transactional
  public List<SignatureImageStaged> stageImages(long userId, List<Long> imageIds) {
    if (imageIds == null || imageIds.isEmpty() || imageIds.size() > MAX_STAGE_IDS) {
      throw new MailValidationException("서명 이미지는 한 번에 1~" + MAX_STAGE_IDS + "개까지 준비할 수 있어요");
    }
    if (imageIds.contains(null)) {
      throw new MailValidationException("서명 이미지 id 가 비어 있어요");
    }
    List<Long> ids = new ArrayList<>(new LinkedHashSet<>(imageIds));
    Map<Long, ImageRow> rows = repository.findImagesById(userId, ids);
    if (rows.size() != ids.size()) {
      throw new MailSignatureImageNotFoundException();
    }
    List<SignatureImageStaged> out = new ArrayList<>();
    for (Long id : ids) {
      ImageRow row = rows.get(id);
      StagedFileResponse staged =
          stagedUploadService.createFromBytes(
              userId,
              MailSignatureImageStore.fileNameFor(row.mimeType()),
              row.mimeType(),
              imageStore.read(row));
      out.add(new SignatureImageStaged(id, staged.fileId()));
    }
    return out;
  }

  private static MailSignatureResponse toResponse(SignatureRow r, int dropped) {
    return new MailSignatureResponse(r.html(), r.autoNew(), r.autoReply(), r.updatedAt(), dropped);
  }
}
