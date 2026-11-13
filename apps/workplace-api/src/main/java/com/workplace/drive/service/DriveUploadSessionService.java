package com.workplace.drive.service;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.StartUploadSessionRequest;
import com.workplace.drive.dto.UploadSessionResponse;
import com.workplace.drive.exception.DriveUploadOffsetMismatchException;
import com.workplace.drive.exception.DriveUploadSessionException;
import com.workplace.drive.exception.DriveUploadSessionNotFoundException;
import com.workplace.drive.repository.DriveUploadSessionRepository;
import com.workplace.drive.repository.DriveUploadSessionRepository.SessionRow;
import com.workplace.file.exception.FileSizeLimitExceededException;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.MimeNormalizer;
import com.workplace.file.service.UploadSource;
import com.workplace.file.storage.FileStore;
import com.workplace.global.util.AfterCommit;
import com.workplace.global.util.BoundedBody;
import com.workplace.global.util.RawUploadContentTypes;
import com.workplace.global.util.SafeFileNames;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.unit.DataSize;

/**
 * 드라이브 나눠 올리기(이어 올리기, WP-1520) — 큰 파일을 조각으로 받아 임시 파일에 이어 쓰고, 다 받으면 일반 업로드 핵심({@link
 * DriveFileService#upload(long, long, Long, UploadSource)})으로 저장한다. 요청 하나가 끊겨도 받은 바이트부터 다시 보낼 수 있다.
 *
 * <p>흐름: 시작(바이트 전 사전 검사·세션 행) → 조각 PUT(offset = 받은 바이트일 때만) → 상태 조회(재개) → 완료(저장·정리) / 취소. tus 서버 대신
 * 직접 API 로 둔 이유는 테넌트 RLS·EDITOR 권한·할당량 사전 검사·저장 핵심을 그대로 쓰기 위해서다.
 *
 * <p>임시 파일: {@code {저장소 루트}/tenant-{tenantId}/upload-sessions/{sessionId}.part}. 진행 상태(받은 바이트)는 DB
 * 행이 기준이고, 파일이 그보다 길면(쓰기 뒤 커밋 실패 등) 다음 쓰기가 받은 바이트 길이로 잘라 맞춘다.
 */
@Slf4j
@Service
public class DriveUploadSessionService {
  /** 세션 만료 — 시작·조각마다 지금부터 이만큼 뒤로 민다. */
  static final Duration TTL = Duration.ofHours(24);

  /** {@link #appendLocked} 가 임시 파일 유실로 세션을 지웠음을 알리는 값 — 받은 바이트는 음수가 될 수 없어 겹치지 않는다. */
  private static final long PART_LOST = -1L;

  private final DriveUploadSessionRepository sessions;
  private final DriveFileService fileService;
  private final DriveQuotaService quota;
  private final FileStore fileStore;
  private final TransactionTemplate tx;

  /** 화면에 알려 줄 조각 크기(바이트). */
  private final long chunkSize;

  /** 조각 하나로 받을 최대 바이트 — 조각 크기의 두 배까지 여유를 둔다(화면 조각 크기가 서버 설정보다 조금 커도 끊지 않게). */
  private final long maxChunkBytes;

  public DriveUploadSessionService(
      DriveUploadSessionRepository sessions,
      DriveFileService fileService,
      DriveQuotaService quota,
      FileStore fileStore,
      PlatformTransactionManager txManager,
      @Value("${workplace.drive.upload-session.chunk-size:8MB}") String chunkSize) {
    this.sessions = sessions;
    this.fileService = fileService;
    this.quota = quota;
    this.fileStore = fileStore;
    this.tx = new TransactionTemplate(txManager);
    this.chunkSize = DataSize.parse(chunkSize).toBytes();
    this.maxChunkBytes = this.chunkSize * 2;
  }

  /**
   * 세션 시작 — 바이트를 받기 전에 일반 업로드와 같은 규칙으로 거른다: EDITOR 권한·폴더가 그 공간 소속({@link
   * DriveFileService#validateUploadTarget}), 이름·MIME 으로 정한 범주 한도, 회사 저장 용량. 멀티파트 한도(100MB)는 걸지 않는다
   * — 나눠 올리기는 그 한도를 넘는 파일을 위한 길이다.
   *
   * @throws FileSizeLimitExceededException 범주 한도 초과(400)
   * @throws com.workplace.drive.exception.DriveQuotaExceededException 저장 용량 초과(409)
   */
  @Transactional
  public UploadSessionResponse start(long callerId, long spaceId, StartUploadSessionRequest req) {
    fileService.validateUploadTarget(callerId, spaceId, req.folderId());
    String contentType = RawUploadContentTypes.bare(req.contentType());
    String mime = MimeNormalizer.normalize(req.fileName(), contentType);
    String category = FileUploadService.categoryOf(mime);
    long limit = FileUploadService.sizeLimitOf(category);
    long size = req.size();
    if (size > limit) {
      throw new FileSizeLimitExceededException(
          category, limit, SafeFileNames.sanitize(req.fileName(), "file"));
    }
    // 잠그지 않는 빠른 거절 — 실제 저장(완료)이 advisory lock 아래에서 다시 본다. 아직 저장되지 않아 사용량에 안 잡히는 열린 세션들의
    // 선언 크기도 더한다 — 빼면 큰 세션 여러 개를 동시에 열어 각자는 통과하고 합쳐서는 용량을 넘길 수 있다.
    quota.assertWithinQuota(size + sessions.sumOpenTotalSize());
    SessionRow row =
        sessions.insert(
            UUID.randomUUID(),
            callerId,
            spaceId,
            req.folderId(),
            req.fileName(),
            contentType,
            size,
            OffsetDateTime.now().plus(TTL));
    return toResponse(row);
  }

  /** 상태 조회(재개용) — 지금 받은 바이트를 돌려준다. 없음·만료·남의 것은 404. */
  @Transactional(readOnly = true)
  public UploadSessionResponse status(long callerId, UUID id) {
    return toResponse(
        sessions.findActive(id, callerId).orElseThrow(DriveUploadSessionNotFoundException::new));
  }

  /**
   * 조각 받기. 트랜잭션을 메서드 전체에 걸지 않는다 — 네트워크로 본문을 받는 동안 DB 연결·행 잠금을 쥐지 않으려는 것이다.
   *
   * <ol>
   *   <li>잠그지 않고 세션·offset·선언 길이를 본다(본문을 받기 전 빠른 거절).
   *   <li>본문을 상한까지 세면서 조각 임시 파일에 받는다(DB 없음).
   *   <li>짧은 트랜잭션에서 행을 잠그고(FOR UPDATE) offset 을 다시 본 뒤, 세션 임시 파일을 받은 바이트 길이로 자르고 그 뒤에 조각을 붙이고 받은
   *       바이트·만료를 갱신한다. 자르기를 먼저 하므로 앞선 쓰기가 커밋에 실패해 남긴 꼬리도 여기서 지워진다.
   * </ol>
   *
   * @param contentLength 요청의 Content-Length(모르면 -1)
   * @return 이 조각까지 받은 바이트
   * @throws DriveUploadOffsetMismatchException offset ≠ 받은 바이트(409, 응답에 받은 바이트)
   * @throws DriveUploadSessionException 조각이 너무 큼(413)·비었음·전체 크기를 넘음(400)
   */
  public long receiveChunk(
      long callerId, UUID id, long offset, long contentLength, InputStream body) {
    SessionRow pre =
        tx.execute(
            st ->
                sessions
                    .findActive(id, callerId)
                    .orElseThrow(DriveUploadSessionNotFoundException::new));
    if (offset != pre.receivedBytes()) {
      throw new DriveUploadOffsetMismatchException(pre.receivedBytes());
    }
    long remaining = pre.totalSize() - offset;
    if (contentLength > maxChunkBytes) {
      throw chunkTooLarge();
    }
    if (contentLength > remaining) {
      throw beyondSize();
    }

    Path part = partPath(pre.tenantId(), id);
    Path staged = null;
    try {
      Files.createDirectories(part.getParent());
      staged = Files.createTempFile(part.getParent(), id + ".", ".chunk");
      long n = receiveBody(body, staged, remaining);
      if (n == 0) {
        throw new DriveUploadSessionException(
            HttpStatus.BAD_REQUEST, DriveUploadSessionException.CODE_INVALID_CHUNK, "빈 조각입니다");
      }
      Path chunk = staged;
      Long received = tx.execute(st -> appendLocked(callerId, id, offset, part, chunk, n));
      if (received == null || received == PART_LOST) {
        // 임시 파일 유실로 세션 행을 지운 트랜잭션은 이미 커밋됐다 — 이제 404 로 알려 화면이 처음부터 다시 올리게 한다.
        throw new DriveUploadSessionNotFoundException();
      }
      return received;
    } catch (IOException e) {
      // 서버 디스크 쓰기 실패 — 500. 받은 바이트(행)는 바뀌지 않았으므로 같은 조각을 다시 보내면 된다.
      throw new UncheckedIOException("업로드 조각을 저장하지 못했습니다", e);
    } finally {
      if (staged != null) {
        FileStore.deleteQuietly(staged);
      }
    }
  }

  /**
   * 잠근 행 아래에서 offset 을 다시 보고 세션 임시 파일의 받은 바이트 위치에 조각을 붙인다. 새 받은 바이트를 돌려준다. 임시 파일이 받은 바이트보다 짧으면(유실)
   * 세션을 지우고 {@link #PART_LOST} 를 돌려준다 — 예외로 알리면 이 트랜잭션이 롤백돼 지우기가 사라지므로, 값으로 돌려 커밋시킨 뒤 호출부가 404 를
   * 던진다.
   */
  private long appendLocked(long callerId, UUID id, long offset, Path part, Path chunk, long n) {
    SessionRow row =
        sessions.lockActive(id, callerId).orElseThrow(DriveUploadSessionNotFoundException::new);
    if (offset != row.receivedBytes()) {
      // 빠른 확인과 잠금 사이에 다른 요청(다른 탭·재시도)이 먼저 같은 위치를 채웠다.
      throw new DriveUploadOffsetMismatchException(row.receivedBytes());
    }
    if (offset + n > row.totalSize()) {
      throw beyondSize();
    }
    // 받은 바이트보다 짧은 임시 파일(디스크에서 지워짐 등)에 이어 쓰면 0 으로 찬 구멍이 생겨 내용이 조용히 깨진다 — 쓰지 않는다.
    // 이 세션으로는 더 이어 갈 수 없으니(500 으로 두면 같은 실패가 반복된다) 세션을 지워 화면이 처음부터 다시 올리게 한다.
    if (offset > 0 && partSize(part) < offset) {
      discardLostPart(callerId, id, part);
      return PART_LOST;
    }
    try (FileChannel out =
            FileChannel.open(part, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        FileChannel in = FileChannel.open(chunk, StandardOpenOption.READ)) {
      // 받은 바이트 뒤의 꼬리(앞선 쓰기의 커밋 실패 등)를 먼저 잘라 낸다 — 행이 기준이다.
      out.truncate(offset);
      long written = 0;
      while (written < n) {
        long t = out.transferFrom(in, offset + written, n - written);
        if (t <= 0) {
          // 조각 파일이 예상(n)보다 짧다 — 0 을 돌려주는 transferFrom 을 계속 부르면 끝없이 돈다. 진척이 없으면 실패시킨다(catch 가 되돌린다).
          throw new IOException("조각 임시 파일이 예상보다 짧습니다 written=" + written + " n=" + n);
        }
        written += t;
      }
    } catch (IOException e) {
      // 쓰다 실패하면 받은 바이트 길이로 되돌린다 — 다음 재시도가 같은 위치부터 쓴다.
      truncateQuietly(part, offset);
      throw new UncheckedIOException("업로드 조각을 저장하지 못했습니다", e);
    }
    long received = offset + n;
    sessions.updateProgress(id, received, OffsetDateTime.now().plus(TTL));
    return received;
  }

  /**
   * 완료 — 다 받았으면 임시 파일을 일반 업로드 핵심으로 저장한다(이름 정리·MIME·범주 한도·용량·같은 이름이면 새 버전·썸네일·검색 색인 모두 그대로). 세션 행은
   * 같은 트랜잭션에서 지우고, 임시 파일은 커밋 뒤에만 지운다 — 저장이 실패해 롤백되면 세션과 받은 바이트가 그대로 남아 다시 완료를 부를 수 있다.
   *
   * <p>잠금 순서: 세션 행(FOR UPDATE) → 저장 핵심의 테넌트 advisory lock. 이 표를 다른 순서로 잠그는 경로는 없다.
   *
   * <p>임시 파일 길이가 전체 크기와 다르면(유실) 세션 행을 지우고 404 를 던진다 — 이 404 는 롤백하지 않아({@code noRollbackFor}) 지우기가
   * 커밋되고, 화면은 처음부터 다시 올린다. 이 예외는 저장 전 단계에서만 나므로 롤백하지 않아도 남는 쓰기가 없다.
   *
   * @throws DriveUploadSessionException 아직 다 받지 않음(409 UPLOAD_INCOMPLETE)
   * @throws DriveUploadSessionNotFoundException 없음·만료·남의 것, 또는 임시 파일 유실(404)
   */
  @Transactional(noRollbackFor = DriveUploadSessionNotFoundException.class)
  public DriveFileResponse complete(long callerId, UUID id) throws IOException {
    SessionRow row =
        sessions.lockActive(id, callerId).orElseThrow(DriveUploadSessionNotFoundException::new);
    if (row.receivedBytes() != row.totalSize()) {
      throw new DriveUploadSessionException(
          HttpStatus.CONFLICT,
          DriveUploadSessionException.CODE_INCOMPLETE,
          "아직 다 올라가지 않았습니다 (" + row.receivedBytes() + " / " + row.totalSize() + " 바이트)",
          row.receivedBytes());
    }
    Path part = partPath(row.tenantId(), id);
    // 받은 바이트(= 전체 크기)만큼 디스크에 없다(임시 파일 유실) — 깨진 파일을 저장하지 않고, 이어 갈 수 없는 세션을 지운 뒤 404(처음부터 다시).
    // 전체 크기보다 길 수는 없다 — 조각 쓰기가 늘 받은 바이트 길이로 자른 뒤 붙이고, offset+n 이 전체 크기를 넘지 않게 막는다.
    if (partSize(part) != row.totalSize()) {
      discardLostPart(callerId, id, part);
      throw new DriveUploadSessionNotFoundException();
    }
    // 임시 파일을 저장 경로로 복사하지 않고 옮긴다 — 수 GB 파일의 두 번째 전체 복사를 피한다(같은 저장소 루트 안의 옮기기).
    // 옮긴 뒤 저장이 롤백되면 세션 행은 남지만 임시 파일은 없다 — 그래도 다음 완료·조각이 "임시 파일 유실"로 세션을 지우고 404 를 주므로
    // 화면이 처음부터 다시 올린다(깨진 파일이 저장되거나 세션이 갇히지 않는다).
    UploadSource source =
        new UploadSource(
            row.fileName(),
            row.contentType(),
            row.totalSize(),
            (store, path) -> store.moveFrom(path, part));
    DriveFileResponse saved = fileService.upload(callerId, row.spaceId(), row.folderId(), source);
    sessions.delete(id, callerId);
    // 옮기기가 끝났다면 지울 것이 없지만, 저장 핵심이 writer 를 부르기 전에 끝났을 수도 있어 커밋 뒤 남은 임시 파일을 정리한다.
    AfterCommit.run(() -> FileStore.deleteQuietly(part));
    return saved;
  }

  /** 취소 — 세션 행을 지우고 커밋 뒤 임시 파일을 지운다. 만료된 세션도 지운다(정리 스케줄러를 기다리지 않게). 없음·남의 것은 404. */
  @Transactional
  public void cancel(long callerId, UUID id) {
    SessionRow row =
        sessions.delete(id, callerId).orElseThrow(DriveUploadSessionNotFoundException::new);
    Path part = partPath(row.tenantId(), id);
    AfterCommit.run(() -> FileStore.deleteQuietly(part));
  }

  /**
   * 만료 정리(스케줄러 전용) — 모든 테넌트의 만료 행을 SECURITY DEFINER 함수로 지우고 그 임시 파일을 지운다. 행 삭제는 함수 한 번으로 바로
   * 커밋되므로(트랜잭션 밖) 파일 삭제가 실패해도 행은 되살아나지 않는다 — 남은 파일은 경고로만 남긴다.
   *
   * @return 지운 세션 수
   */
  public int purgeExpired() {
    var purged = sessions.purgeExpired();
    for (var p : purged) {
      Path part = partPath(p.tenantId(), p.id());
      FileStore.deleteQuietly(part);
    }
    return purged.size();
  }

  /**
   * 세션 임시 파일 경로 — 저장소 루트의 테넌트 폴더({@code tenant-{id}/}) 아래. 테넌트 영구 삭제({@code TenantPurgeService})가 그
   * 폴더를 통째로 지우므로 받던 바이트도 함께 정리된다.
   */
  public Path partPath(long tenantId, UUID id) {
    return fileStore
        .rootDir()
        .resolve("tenant-" + tenantId)
        .resolve("upload-sessions")
        .resolve(id + ".part");
  }

  /**
   * 이어 갈 수 없는 세션(임시 파일 유실)을 지운다 — 세션 행은 현재 트랜잭션에서, 남은 임시 파일은 커밋 뒤에. 호출부는 지우기가 커밋되도록 예외 대신 값으로
   * 알리거나(조각) 롤백하지 않는 404(완료)로 끝낸다.
   */
  private void discardLostPart(long callerId, UUID id, Path part) {
    log.warn("업로드 세션 임시 파일 유실 — 세션을 지우고 처음부터 다시 받게 한다 id={}", id);
    sessions.delete(id, callerId);
    AfterCommit.run(() -> FileStore.deleteQuietly(part));
  }

  /**
   * 조각 본문을 상한까지 세면서 조각 임시 파일에 받는다({@link BoundedBody#copyWithCap}). 상한은 min(조각 상한, 남은 크기) 이고, 넘으면
   * 남은 크기(전체 − offset)를 넘었는지로 400(UPLOAD_INVALID_CHUNK)·413(UPLOAD_CHUNK_TOO_LARGE) 을 가른다. 도우미는 두
   * 실패(상한 초과·읽기 중단)를 같은 400 으로 알려 오므로, 읽은 바이트 수를 세어 상한을 넘었는지로 구분한다 — 읽기 중단이면 상한을 넘지 않았다.
   */
  private long receiveBody(InputStream body, Path target, long remaining) throws IOException {
    long cap = Math.min(maxChunkBytes, remaining);
    CountingInputStream counted = new CountingInputStream(body);
    return BoundedBody.copyWithCap(
        counted,
        target,
        cap,
        (status, message) -> {
          if (counted.count > cap) {
            return counted.count > remaining ? beyondSize() : chunkTooLarge();
          }
          // 클라이언트가 중간에 끊었다 — 서버 잘못이 아니라 400. 받은 바이트는 그대로라 같은 조각을 다시 보내면 된다.
          return new DriveUploadSessionException(
              HttpStatus.BAD_REQUEST,
              DriveUploadSessionException.CODE_INVALID_CHUNK,
              "조각을 끝까지 받지 못했습니다. 다시 보내 주세요");
        });
  }

  /** 읽은 바이트 수를 세는 스트림 — {@link #receiveBody} 가 상한 초과와 읽기 중단을 가르는 데 쓴다. */
  private static final class CountingInputStream extends FilterInputStream {
    private long count;

    CountingInputStream(InputStream in) {
      super(in);
    }

    @Override
    public int read() throws IOException {
      int b = super.read();
      if (b >= 0) {
        count++;
      }
      return b;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
      int r = super.read(b, off, len);
      if (r > 0) {
        count += r;
      }
      return r;
    }
  }

  private DriveUploadSessionException chunkTooLarge() {
    return new DriveUploadSessionException(
        HttpStatus.valueOf(413),
        DriveUploadSessionException.CODE_CHUNK_TOO_LARGE,
        "조각이 너무 큽니다 (최대 " + maxChunkBytes + " 바이트)");
  }

  private static DriveUploadSessionException beyondSize() {
    return new DriveUploadSessionException(
        HttpStatus.BAD_REQUEST, DriveUploadSessionException.CODE_INVALID_CHUNK, "조각이 파일 크기를 넘습니다");
  }

  /** 임시 파일 길이 — 없으면 0. */
  private static long partSize(Path part) {
    try {
      return Files.size(part);
    } catch (NoSuchFileException e) {
      return 0;
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /** 실패한 쓰기를 받은 바이트 길이로 되돌린다. 되돌리기 실패는 다음 쓰기의 자르기에 맡긴다. */
  private static void truncateQuietly(Path part, long length) {
    try (FileChannel ch = FileChannel.open(part, StandardOpenOption.WRITE)) {
      ch.truncate(length);
    } catch (IOException e) {
      log.warn("업로드 세션 임시 파일 되돌리기 실패 path={}", part, e);
    }
  }

  private UploadSessionResponse toResponse(SessionRow row) {
    return new UploadSessionResponse(
        row.id().toString(), chunkSize, row.receivedBytes(), row.totalSize(), row.expiresAt());
  }
}
