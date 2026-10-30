package com.workplace.user.service;

import com.workplace.file.storage.FileStore;
import com.workplace.global.tenant.TenantContext;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.AvatarCrop;
import com.workplace.user.dto.UserAvatarResponse;
import com.workplace.user.dto.UserKind;
import com.workplace.user.exception.PersonalAssistantRenameForbiddenException;
import com.workplace.user.exception.UserNotFoundException;
import com.workplace.user.repository.UserRepository;
import com.workplace.user.service.AvatarImageProcessor.ProcessedAvatar;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

/**
 * 프로필 아바타(WP-1222) — 사람·AI 모두 자기 아바타를 바꾸거나 기본(이니셜·색)으로 되돌리고, 관리자는 이 워크스페이스 AI 의 아바타를 바꾼다.
 *
 * <p>저장: 스토리지 루트 아래 {@code avatars/{userId}/{hash}/{size}.{png|jpg}} — 테넌트와 무관하다(한 사람이 여러 워크스페이스에
 * 속한다). DB 에는 지금 해시({@code user.avatar_hash})만 둔다. 공개 주소 {@code
 * /api/v1/avatars/{userId}/{hash}/{size}} 는 인증 없이 열리고(추측할 수 없는 해시가 곧 권한), 해시가 바뀌면 주소도 바뀌어 영구 캐시해도
 * 된다. 공개 응답은 DB 를 보지 않고 디스크에 그 해시 폴더가 있는지만 본다 — 옛 해시 폴더는 커밋 뒤 지워지므로 「폴더가 있다」가 곧 「지금 해시다」이다.
 *
 * <p>순서: ① 이미지 처리·파일 쓰기(트랜잭션 밖 — 디코딩 동안 DB 커넥션을 잡지 않는다) ② 사용자 행을 잠그고 해시 교체 ③ 커밋 뒤 옛 해시 폴더 삭제. 롤백되면
 * 새로 쓴 폴더를 지운다. 커밋 전에 옛 파일을 지우면 롤백 시 DB 가 가리키는 파일이 사라지기 때문이다.
 */
@Slf4j
@Service
public class AvatarService {

  /**
   * 공개 이미지 주소 앞부분 — AvatarController 매핑·SecurityConfig permitAll·PublicRateLimitFilter 가 모두 이 값을
   * 쓴다.
   */
  public static final String PUBLIC_PATH = "/api/v1/avatars";

  /** 스토리지 루트 아래 아바타 폴더. tenant-{id}/ 밖이라 워크스페이스 영구 삭제(purge)가 건드리지 않는다. */
  private static final String STORAGE_DIR = "avatars";

  /** 저장 형식 — 확장자와 응답 Content-Type. 선언 순서가 공개 응답에서 파일을 찾는 순서다: 대부분(불투명 사진)이 JPEG 라 jpg 를 먼저 본다. */
  private enum StoredFormat {
    JPG("jpg", MediaType.IMAGE_JPEG),
    PNG("png", MediaType.IMAGE_PNG);

    final String extension;
    final MediaType contentType;

    StoredFormat(String extension, MediaType contentType) {
      this.extension = extension;
      this.contentType = contentType;
    }
  }

  private final AvatarImageProcessor processor;
  private final UserRepository userRepository;
  private final WorkspaceMemberGuard memberGuard;
  private final FileStore fileStore;
  private final TransactionTemplate tx;
  private final TransactionTemplate readTx;

  public AvatarService(
      AvatarImageProcessor processor,
      UserRepository userRepository,
      WorkspaceMemberGuard memberGuard,
      FileStore fileStore,
      PlatformTransactionManager txManager) {
    this.processor = processor;
    this.userRepository = userRepository;
    this.memberGuard = memberGuard;
    this.fileStore = fileStore;
    this.tx = new TransactionTemplate(txManager);
    this.readTx = new TransactionTemplate(txManager);
    this.readTx.setReadOnly(true);
  }

  /** 공개 이미지 주소(크기 조각 제외). 해시가 없으면(기본 아바타) null — 웹은 이니셜·색을 그린다. */
  public static String urlOf(long userId, String hash) {
    return hash == null ? null : PUBLIC_PATH + "/" + userId + "/" + hash;
  }

  /** 공개 응답에 실을 아바타 파일. */
  public record AvatarFile(Path path, MediaType contentType) {}

  /** 관리자가 이 워크스페이스 AI 의 아바타를 바꾼다. 대상이 이 워크스페이스의 AI 가 아니면 404. @return 새 공개 주소 */
  public String setAgentAvatar(long agentId, MultipartFile file, AvatarCrop crop) {
    requireWorkspaceAgent(agentId);
    return setAvatar(agentId, file, crop);
  }

  /** 관리자가 이 워크스페이스 AI 의 아바타를 기본으로 되돌린다. 대상이 이 워크스페이스의 AI 가 아니면 404. */
  public void deleteAgentAvatar(long agentId) {
    requireWorkspaceAgent(agentId);
    deleteAvatar(agentId);
  }

  /**
   * 지금 워크스페이스 구성원(사람·AI) 중 아바타가 있는 사람만 — 웹이 한 번 받아 userId 로 찾는다(목록 DTO 마다 필드를 더하지 않으려는 결정). 테넌트
   * 컨텍스트가 없으면(어느 워크스페이스에도 속하지 않은 AI 토큰) 빈 목록.
   */
  public List<UserAvatarResponse> listWorkspaceAvatars() {
    Long tenantId = TenantContext.get();
    if (tenantId == null) return List.of();
    return readTx.execute(
        status ->
            userRepository.findMemberAvatars(tenantId).stream()
                .map(a -> new UserAvatarResponse(a.userId(), urlOf(a.userId(), a.hash())))
                .toList());
  }

  /**
   * 공개 이미지 파일을 찾는다. 크기가 64·128·256 이 아니거나, 해시 형식이 아니거나(경로 문자 차단), 파일이 없으면 empty(404). DB 는 보지 않는다 —
   * 바꾸기 전·되돌리기 전 해시 폴더는 커밋 뒤 지워져 파일이 없으므로 「지금 해시인지」 조회와 결과가 같고, 인증 없는 요청마다 DB 를 치지 않는다.
   */
  public Optional<AvatarFile> load(long userId, String hash, int size) {
    if (!AvatarImageProcessor.SIZES.contains(size) || !AvatarImageProcessor.isHash(hash)) {
      return Optional.empty();
    }
    String dir = dirOf(userId, hash);
    for (StoredFormat format : StoredFormat.values()) {
      String relative = dir + "/" + size + "." + format.extension;
      if (fileStore.exists(relative)) {
        return Optional.of(new AvatarFile(fileStore.resolve(relative), format.contentType));
      }
    }
    return Optional.empty();
  }

  /**
   * 대상이 지금 워크스페이스 구성원이면서 AI 인지 — 아니면 존재를 숨겨 404(관리자 단건 API 공통 규칙). 개인 비서는 이름 변경과 같이 관리자가 바꾸지
   * 못한다(403) — 소유자의 비공개 AI 라서다.
   */
  private void requireWorkspaceAgent(long userId) {
    readTx.executeWithoutResult(
        status -> {
          memberGuard.require(userId);
          var user =
              userRepository.findById(userId).orElseThrow(() -> UserNotFoundException.ofId(userId));
          if (!UserKind.isAgent(user.kind())) {
            throw UserNotFoundException.ofId(userId);
          }
          if (AgentUsernames.isPersonalAssistant(user.username())) {
            throw new PersonalAssistantRenameForbiddenException("개인 비서의 아바타는 관리자가 바꿀 수 없습니다.");
          }
        });
  }

  /**
   * 아바타를 바꾼다(내 아바타 — 사람·AI 토큰 모두. 관리자의 AI 아바타는 {@link #setAgentAvatar} 가 대상 확인 뒤 부른다). 이미지를 처리해 파일을
   * 쓰고 해시를 바꾼다. 해시는 업로드마다 새 난수라 새 폴더는 늘 다른 요청·옛 값과 겹치지 않는다. 행을 잠근 채 옛 해시를 읽고 새 해시를 넣으며, 커밋 뒤 「그 옛
   * 해시」 폴더만 지운다. 실패(롤백·커밋 오류)하면 새로 쓴 폴더를 지운다 — 어느 경우에도 DB 가 가리키는 폴더는 남는다.
   *
   * @param crop 자를 영역(null 이면 가운데 정사각)
   * @return 새 공개 주소
   */
  public String setAvatar(long userId, MultipartFile file, AvatarCrop crop) {
    ProcessedAvatar avatar = processor.process(file, crop);
    String newHash = avatar.hash();
    String newDir = dirOf(userId, newHash);
    try {
      for (Map.Entry<Integer, byte[]> e : avatar.images().entrySet()) {
        fileStore.writeAtomically(
            newDir + "/" + e.getKey() + "." + avatar.extension(), e.getValue());
      }
      tx.executeWithoutResult(
          status -> {
            String previous = userRepository.findAvatarHashForUpdate(userId).orElse(null);
            userRepository.updateAvatarHash(userId, newHash);
            cleanupOnCompletion(userId, previous, newHash);
          });
    } catch (RuntimeException e) {
      deleteDirQuietly(newDir);
      throw e;
    }
    return urlOf(userId, newHash);
  }

  /**
   * 아바타를 기본(이니셜·색)으로 되돌린다 — 행을 잠그고 해시를 지운 뒤, 커밋 뒤 그 옛 폴더를 지운다. 이미 기본이면 아무것도 하지 않는다. 관리자의 AI 아바타는
   * {@link #deleteAgentAvatar} 가 대상 확인 뒤 부른다.
   */
  public void deleteAvatar(long userId) {
    tx.executeWithoutResult(
        status -> {
          String previous = userRepository.findAvatarHashForUpdate(userId).orElse(null);
          if (previous == null) return;
          userRepository.updateAvatarHash(userId, null);
          cleanupOnCompletion(userId, previous, null);
        });
  }

  /**
   * 사용자 행이 영구 삭제될 때(AI 계정 삭제) 그 사용자의 아바타 폴더 전체({@code avatars/{userId}/})를 커밋 뒤에 지운다. 지금 트랜잭션 안에서
   * 불러야 하며, 롤백되면(삭제가 막혀 사용 중지로 바뀐 경우 등) 아무것도 지우지 않는다. 트랜잭션이 없으면 바로 지운다.
   */
  public void deleteAllAfterCommit(long userId) {
    String dir = STORAGE_DIR + "/" + userId;
    if (!TransactionSynchronizationManager.isSynchronizationActive()) {
      deleteDirQuietly(dir);
      return;
    }
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCommit() {
            deleteDirQuietly(dir);
          }
        });
  }

  /**
   * 트랜잭션이 끝난 뒤 파일을 정리한다 — 커밋이면 옛 폴더(previous)를, 롤백이면 새 폴더(next)를 지운다. 바깥 트랜잭션에 참여한 경우(테스트 트랜잭션 등) 그
   * 트랜잭션이 끝날 때 실행된다.
   */
  private void cleanupOnCompletion(long userId, String previous, String next) {
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCompletion(int status) {
            if (status == STATUS_COMMITTED && previous != null) {
              deleteDirQuietly(dirOf(userId, previous));
            } else if (status == STATUS_ROLLED_BACK && next != null) {
              deleteDirQuietly(dirOf(userId, next));
            }
          }
        });
  }

  private static String dirOf(long userId, String hash) {
    return STORAGE_DIR + "/" + userId + "/" + hash;
  }

  /**
   * 정리 실패는 경고만 — 남은 옛 폴더는 그 해시 주소로 계속 열리지만, 주소는 그 사람이 이미 공개했던 그림이라 새로 드러나는 것이 없어 경미하다(다음 정리 때까지
   * 디스크만 쓴다).
   */
  private void deleteDirQuietly(String dir) {
    try {
      fileStore.deleteTreeIfExists(dir);
    } catch (RuntimeException e) {
      log.warn("아바타 폴더 삭제 실패(무시): {}", dir, e);
    }
  }
}
