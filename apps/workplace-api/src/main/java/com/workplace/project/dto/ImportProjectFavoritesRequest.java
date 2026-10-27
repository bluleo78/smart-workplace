package com.workplace.project.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 브라우저에만 있던 즐겨찾기를 서버로 한 번 올리는 요청(WP-1001). 기기의 옛 값이라 없어진·볼 수 없는 key 가 섞일 수 있어, 서버는 그런 key 를 조용히
 * 건너뛴다.
 */
public record ImportProjectFavoritesRequest(@NotNull @Size(max = 200) List<String> projectKeys) {}
