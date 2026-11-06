package com.workplace.agentruntime.dto;

import com.workplace.global.validation.ModelIds;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 로그인 계정 모델 목록 보고 요청(WP-1297) — 로그인 정보로 연결된 AI(Codex 등)의 Pod 가 자기 프로그램이 쓸 수 있는 모델 목록을 알린다. 서버가 저장된
 * 로그인으로 직접 조회하면 1회용 refresh token 을 써 Pod 의 로그인이 풀리기 때문이다.
 *
 * @param loginVersion Pod 가 받은 로그인 정보의 version(= 연결 id, env {@code GENIA_LOGIN_VERSION}) — 지금 활성 연결
 *     id 와 다르면 옛 로그인의 보고라 저장하지 않는다
 * @param models 모델 목록(최대 100개, 화면에 보일 순서대로)
 */
public record ReportedModelsRequest(
    @NotNull Long loginVersion, @NotNull @Size(max = 100) List<@NotNull @Valid Model> models) {

  /**
   * 모델 하나 — id 는 템플릿 「모델」 칸에 저장할 수 있는 꼴과 같다.
   *
   * @param id 모델 id(설정에 그대로 저장되는 값)
   * @param label 화면 이름(없으면 id 로 보인다)
   * @param efforts 이 모델이 받는 생각의 깊이 단계(소문자, 낮은 순) — 없으면 알 수 없음
   */
  public record Model(
      @NotNull
          @Pattern(regexp = ModelIds.REGEX, message = "모델 id 는 영문·숫자와 . _ : / @ [ ] - 만 쓸 수 있어요")
          String id,
      @Size(max = 200) String label,
      @Size(max = 10)
          List<@NotNull @Pattern(regexp = "[a-z]{1,16}", message = "생각의 깊이는 소문자 영문이어야 해요") String>
              efforts) {}
}
