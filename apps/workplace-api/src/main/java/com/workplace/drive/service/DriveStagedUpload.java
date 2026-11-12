package com.workplace.drive.service;

import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.UploadSource;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 드라이브 바이트 업로드의 「blob 먼저 쓰기」(WP-1519).
 *
 * <p>업로드 핵심({@link DriveFileService} 의 저장)은 테넌트 할당량 advisory lock 과 DB 트랜잭션(풀 커넥션) 안에서 돈다. 예전에는 그
 * 안에서 blob 을 저장소(NFS)로 복사해, 1GB 동영상이면 복사하는 몇 분 동안 같은 테넌트의 모든 드라이브 업로드가 줄 서고 커넥션 풀이 마를 수 있었다. 그래서
 * 트랜잭션을 열기 전에 할당량을 잠그지 않고 먼저 보고({@link DriveFileService#precheckQuota}) → blob 을 써 둔 뒤({@link
 * FileUploadService#stage}) → 저장 핵심은 잠금 아래에서 할당량 재검사·행 삽입만 한다. 저장이 실패하면(할당량·같은 이름·권한·DB 오류 등) 써 둔
 * blob 을 지운다(보상).
 *
 * <p>이미 트랜잭션 안에서 불리면(다른 서비스가 감싼 경우·테스트) 먼저 쓰기를 하지 않고 원래 출처로 저장한다 — 바깥 트랜잭션이 나중에 롤백되면 보상할 수 없고, 잠금은
 * 어차피 바깥 트랜잭션이 쥐고 있어 얻는 것이 없다.
 */
@Component
@RequiredArgsConstructor
public class DriveStagedUpload {

  private final FileUploadService fileUpload;
  private final DriveFileService driveFiles;

  /** 미리 써 둔 출처로 저장하는 동작 — 보통 {@link DriveFileService} 의 업로드 메서드(자기 트랜잭션) 호출이다. */
  @FunctionalInterface
  public interface Save<T> {
    T save(UploadSource source) throws IOException;
  }

  /**
   * blob 을 먼저 쓰고 {@code save} 로 저장한다. {@code save} 가 예외로 끝나면 써 둔 blob 을 지우고 그 예외를 그대로 던진다.
   *
   * @param source 저장할 바이트 출처(멀티파트·임시 파일·바이트 배열)
   * @throws com.workplace.drive.exception.DriveQuotaExceededException 잠그지 않고 본 할당량이 이미 모자랄 때(쓰기 전에
   *     거절)
   * @throws com.workplace.file.exception.FileSizeLimitExceededException 범주 크기 상한 초과(쓰기 전에 거절)
   */
  public <T> T run(UploadSource source, Save<T> save) throws IOException {
    if (TransactionSynchronizationManager.isActualTransactionActive()) {
      return save.save(source);
    }
    // 빠른 거절 — 한도를 넘는 1GB 를 저장소에 쓰고 나서 지우지 않게. 실제 판정은 저장 핵심이 잠근 채 다시 한다.
    driveFiles.precheckQuota(source.size());
    UploadSource staged = fileUpload.stage(source);
    try {
      return save.save(staged);
    } catch (Throwable t) {
      // 저장 트랜잭션이 롤백됐으므로 FILE 행이 없다 — 써 둔 blob 은 만료 스윕이 찾지 못하는 고아가 되니 여기서 지운다.
      fileUpload.discardStaged(staged);
      throw t;
    }
  }
}
