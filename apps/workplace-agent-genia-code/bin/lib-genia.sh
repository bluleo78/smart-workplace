# Gen:iA Code 작업 공간 엔트리포인트의 전용 함수(WP-1296) — Claude Code 이미지의 lib.sh 를 먼저 읽고 이 파일을 뒤에 읽는다(같은 이름은 덮어쓴다).
# 공용(필수 확인·폴더·추가 CA·키·git·dind·프로젝트·감독·정리·adopt_plugin_scripts·bg_wait)은 lib.sh 그대로, 여기에는 Gen:iA Code 만의 일을 둔다:
#   - genia 프로그램 받기(install_genia) — 사내 프로그램이라 공개 이미지(Docker Hub)에 넣지 않고 Pod 가 뜰 때 사내 서버에서 받아 /work 에 둔다.
#   - 플러그인 고르기(use_plugin) — 이미지에 굳힌 genia-works 를 기본으로, Works 마켓플레이스의 버전에 genia/ 가 있으면 그것을 받아 쓴다.
#   - genia 설정·로그인 시딩(write_genia_settings·seed_login), node 인증서 묶음(genia_ca), 감독 한 회차(tick).
# 함수 안 변수는 local 로 둔다 — lib.sh 는 전역 변수를 쓰므로 이름이 겹쳐 서로 덮지 않게. 일부러 내보내는 값(GW_SCRIPTS·AI_DIR·GENIA_* env)만 전역이다.
# 사내 배포 서버의 인증서(genia-root)는 이미지가 시스템 CA 에 넣어 두었다(Dockerfile — update-ca-certificates) — curl·git 은 따로 CA 를 주지 않는다.
# Pod 계약은 docs/integrations/agent-pod-contract.md. 맥(bash 3.2)에서도 돌게 쓴다. 로그인 정보·키 원문은 로그·명령줄에 남기지 않는다.

GENIA_ROOT_CRT=${GENIA_ROOT_CRT:-/usr/local/share/ca-certificates/genia-root.crt} # 사내 Gen:iA 서버·모델 서버의 루트 CA(공개 인증서, 이미지가 둔다)
GENIA_PLUGIN_DIR=${GENIA_PLUGIN_DIR:-/opt/genia/plugin/genia-works}             # 빌드 때 굳힌 genia-works 플러그인
GENIA_DOWNLOAD_URL=${GENIA_DOWNLOAD_URL:-https://genia-code-server.iacloud.kr/download} # 사내 배포 서버(latest.txt + 파일)
GENIA_APP_DIR=${GENIA_APP_DIR:-$GENIA_WORK/.genia-app}                          # 받은 genia(버전별 폴더 + current 링크) — PVC 라 다시 받지 않는다
GENIA_PLUGIN_CACHE=${GENIA_PLUGIN_CACHE:-$GENIA_WORK/.genia-plugin}             # 마켓플레이스 ref 별로 받은 플러그인

# 7 의 폴더 신뢰 훅(lib.sh) — Gen:iA Code 는 칸 명령의 --approve 와 settings 의 defaultProjectTrust 로 신뢰한다. ~/.claude.json 은 쓰지 않는다.
trust_folders() { return 0; }

# 파일의 sha256(16진 소문자) — 리눅스는 sha256sum, 맥(테스트)은 shasum.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

# 1c. genia 가 쓸 node 인증서 묶음 — genia-root.crt + (있으면) 위치 추가 CA. 플러그인 agent-project 의 genia 분기는 NODE_EXTRA_CA_CERTS 를
#     GENIA_CA_CERT 로 덮으므로, setup_ca 가 내보낸 위치 CA 가 칸에서 빠지지 않게 둘을 이어 붙인 파일을 GENIA_CA_CERT 로 준다.
#     (NODE_EXTRA_CA_CERTS 는 시스템 CA 에 「더하는」 값이라 시스템 CA 를 넣을 필요는 없다 — node 는 시스템 CA 파일을 읽지 않아 genia-root 가 따로 필요하다.)
#     묶음을 못 만들면 경고하고 GENIA_CA_CERT 만 genia-root.crt 로 둔다 — 비워 두면 agent-project 가 ~/.genia/app(없음)으로 간다.
genia_ca() {
  local out="$HOME/.genia-node-ca.pem" extra="$GENIA_RUN_DIR/ca/ca.crt"
  set -- "$GENIA_ROOT_CRT"
  [ -s "$extra" ] && set -- "$@" "$extra"
  if ! cat "$@" > "$out.tmp" 2>/dev/null || ! mv -f "$out.tmp" "$out"; then
    rm -f "$out.tmp"
    log "경고: Gen:iA 인증서 묶음을 만들지 못했습니다($GENIA_ROOT_CRT) — 사내 Gen:iA 서버에 닿지 못할 수 있습니다"
    export GENIA_CA_CERT="$GENIA_ROOT_CRT"
    return 0
  fi
  export GENIA_CA_CERT="$out" NODE_EXTRA_CA_CERTS="$out"
}

# 배포 서버에서 하나 받기 — genia_fetch <url> <저장 파일> [<최대 초>]. CA 는 curl 기본(시스템 CA — genia-root 포함, 위치 CA 가 있으면 setup_ca 의
# CURL_CA_BUNDLE). file:// 은 테스트용. 뒤에서 돌린다(bg_wait — SIGTERM 즉시 처리).
genia_fetch() {
  bg_wait curl -fsS --connect-timeout 10 --max-time "${3:-60}" -o "$2" "$1" </dev/null
}

# 이 컨테이너 아키텍처의 latest.txt 키.
genia_arch_key() {
  case "$(uname -m)" in
    x86_64 | amd64) echo cli-linux-x64 ;;
    aarch64 | arm64) echo cli-linux-arm64 ;;
    *) return 1 ;;
  esac
}

# genia 를 받아 두었는지 — 감독(tick)이 「받기를 다시 할지·칸을 띄울 수 있는지」를 이것으로 본다.
genia_ready() { [ -x "$GENIA_APP_DIR/current/genia" ]; }

# current 링크를 <버전 폴더 이름> 으로 — 임시 링크를 만든 뒤 바꿔 끼워, 도중에 끊긴 current 가 남지 않게 한다.
# GNU mv 는 -T(링크가 가리키는 폴더 안으로 옮기지 않게)가 있고, 없는 곳(맥 — 테스트)은 ln -sfn 으로 한다.
genia_link_current() {
  ln -sfn "$1" "$GENIA_APP_DIR/.current.tmp" &&
    { mv -fT "$GENIA_APP_DIR/.current.tmp" "$GENIA_APP_DIR/current" 2>/dev/null ||
      { rm -f "$GENIA_APP_DIR/.current.tmp" && ln -sfn "$1" "$GENIA_APP_DIR/current"; }; }
}

# 지금 것(current 가 가리키는 폴더)만 남기고 옛 버전을 지운다 — 한 버전이 수백 MB 라 PVC 가 쌓이지 않게.
# (받다 만 .new.* 는 받기 시작 때 genia_install_latest 가 지운다. 숨김 파일 .bad 는 남긴다.)
genia_prune() {
  local keep d
  keep=$(readlink "$GENIA_APP_DIR/current" 2>/dev/null) || return 0
  for d in "$GENIA_APP_DIR"/*; do
    [ -e "$d" ] || [ -L "$d" ] || continue
    case "${d##*/}" in current | "$keep") continue ;; esac
    rm -rf "$d"
  done
}

# 감싸개 ~/.local/bin/genia — 홈은 휘발이라 매번 만든다. 공식 install.sh 의 감싸개와 같은 모양(인증서 기본값 + 실행 파일 exec)이고,
# 실행 파일은 /work 의 current 를 가리킨다(실행 파일은 자기 실제 경로 옆의 bin·assets 를 찾는다 — 링크가 아니라 감싸개인 이유).
# 인증서 기본값은 genia_ca 가 늘 정해 둔 GENIA_CA_CERT 다.
genia_wrapper() {
  mkdir -p "$HOME/.local/bin" || return 1
  cat > "$HOME/.local/bin/genia" <<EOF
#!/bin/sh
export NODE_EXTRA_CA_CERTS="\${NODE_EXTRA_CA_CERTS:-$GENIA_CA_CERT}"
exec "$GENIA_APP_DIR/current/genia" "\$@"
EOF
  chmod 755 "$HOME/.local/bin/genia"
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac
}

# 2. genia 프로그램 — 배포 서버의 latest.txt(「<키> <파일 이름> <sha256>」 줄)에서 이 아키텍처의 파일을 고른다.
#    그 버전이 /work/.genia-app/<줄기>/genia 로 이미 있으면 받지 않는다. 없으면 /work/tmp 에 받아 sha256 을 확인하고(다르면 버림),
#    임시 폴더에 풀어 <줄기> 로 옮긴 뒤 current 를 바꿔 끼우고 옛 버전을 지운다.
#    서버에 못 닿거나 실패하면: current 가 있으면 그것으로 계속(경고 한 줄, 0), 없으면 1 — 감독(tick)이 다음 회차에 다시 한다.
install_genia() {
  mkdir -p "$GENIA_APP_DIR" "$GENIA_WORK/tmp" || return 1
  if ! genia_install_latest; then
    if genia_ready; then
      log "경고: 새 Gen:iA Code 를 확인하지 못해 받아 둔 버전($(readlink "$GENIA_APP_DIR/current"))으로 계속합니다"
    else
      log "Gen:iA Code 를 받지 못했습니다 — 사내 Gen:iA 서버($GENIA_DOWNLOAD_URL) 접속을 확인하세요. 잠시 뒤 다시 합니다"
      return 1
    fi
  fi
  genia_wrapper || log "경고: $HOME/.local/bin/genia 감싸개를 만들지 못했습니다"
  log "Gen:iA Code $("$HOME/.local/bin/genia" --version 2>/dev/null </dev/null | head -n 1)"
  return 0
}

# genia_install_latest 의 실패 정리 — 받던 임시 폴더(dl·new — 부르는 함수의 local)를 지우고 사유를 남긴다. 늘 1.
genia_fail() {
  rm -rf "${dl:-}" "${new:-}"
  log "경고: $*"
  return 1
}

# install_genia 의 받기 한 번 — 성공(이미 있음 포함)이면 0, 그 밖은 사유를 로그에 남기고 1.
# 받은 파일이 손상됐으면(sha 불일치·풀기 실패·실행 파일 없음) 그 「파일 이름 sum」 을 .bad 에 적고, latest.txt 의 줄이 그대로인 동안은 다시
# 받지 않는다(같은 100MB 를 회차마다 받지 않게 — 서버가 줄을 바꾸면 다시 해 본다).
genia_install_latest() {
  local key dl="" new="" line file sum stem top d bad="$GENIA_APP_DIR/.bad"
  key=$(genia_arch_key) || genia_fail "Gen:iA Code 가 없는 아키텍처입니다: $(uname -m)" || return
  # 지난번에 받다 끊긴(종료 신호·SIGKILL) 임시 폴더를 먼저 치운다 — /work 는 영속이라 남기면 쌓인다.
  rm -rf "$GENIA_WORK/tmp"/genia-dl.* "$GENIA_APP_DIR"/.new.*
  dl=$(mktemp -d "$GENIA_WORK/tmp/genia-dl.XXXXXX") || return 1
  genia_fetch "$GENIA_DOWNLOAD_URL/latest.txt" "$dl/latest.txt" 30 2>/dev/null ||
    genia_fail "Gen:iA 배포 서버($GENIA_DOWNLOAD_URL/latest.txt)에 닿지 못했습니다" || return
  # 줄 끝 CR(윈도 줄바꿈)을 지우고, sha 는 소문자로 맞춰 비교한다(sha256sum 은 소문자를 낸다).
  line=$(tr -d '\r' < "$dl/latest.txt" | awk -v k="$key" '$1 == k { print $2, $3; exit }')
  file=${line% *}
  sum=$(printf '%s' "${line#* }" | tr 'A-F' 'a-f')
  # 파일 이름은 경로·폴더 이름이 된다 — 글자를 좁혀 서버 응답이 이상해도 엉뚱한 곳에 쓰지 않게.
  case "$file" in .* | *[!A-Za-z0-9._-]*) file="" ;; *.tar.gz) ;; *) file="" ;; esac
  case "$sum" in *[!0-9a-f]*) sum="" ;; esac
  [ -n "$file" ] && [ ${#sum} -eq 64 ] || genia_fail "latest.txt 에 $key 줄이 없거나 형식이 다릅니다" || return
  stem=${file%.tar.gz}
  if [ -x "$GENIA_APP_DIR/$stem/genia" ]; then
    rm -rf "$dl"
    [ "$(readlink "$GENIA_APP_DIR/current" 2>/dev/null)" = "$stem" ] || genia_link_current "$stem" || return 1
    genia_prune
    return 0
  fi
  [ "$(cat "$bad" 2>/dev/null)" != "$file $sum" ] ||
    genia_fail "$file 은 전에 받았을 때 손상돼 있었습니다 — 서버가 latest.txt 를 바꿀 때까지 다시 받지 않습니다" || return
  log "Gen:iA Code 를 받습니다: $file"
  genia_fetch "$GENIA_DOWNLOAD_URL/$file" "$dl/$file" 900 2>/dev/null || genia_fail "$file 을 받지 못했습니다" || return
  if [ "$(sha256_of "$dl/$file")" != "$sum" ]; then
    printf '%s\n' "$file $sum" > "$bad"
    genia_fail "받은 $file 의 sha256 이 latest.txt 와 다릅니다 — 버립니다"
    return
  fi
  # 같은 디스크(/work) 안의 임시 폴더에 풀어 mv 한 번으로 옮긴다 — 풀다 끊겨도 반쯤 풀린 버전 폴더가 남지 않는다.
  new=$(mktemp -d "$GENIA_APP_DIR/.new.XXXXXX") || genia_fail "$GENIA_APP_DIR 에 임시 폴더를 만들지 못했습니다" || return
  if ! tar -xzf "$dl/$file" -C "$new" 2>/dev/null; then
    printf '%s\n' "$file $sum" > "$bad"
    genia_fail "$file 을 풀지 못했습니다"
    return
  fi
  # 배포본 안은 폴더 하나(genia-<버전>-linux-<arch>/)다. 실행 파일이 든 첫 폴더를 쓴다.
  top=""
  for d in "$new"/*; do
    [ -x "$d/genia" ] && { top=$d; break; }
  done
  if [ -z "$top" ]; then
    printf '%s\n' "$file $sum" > "$bad"
    genia_fail "$file 안에 genia 실행 파일이 없습니다"
    return
  fi
  rm -rf "${GENIA_APP_DIR:?}/$stem"
  { mv "$top" "$GENIA_APP_DIR/$stem" && genia_link_current "$stem"; } ||
    genia_fail "받은 Gen:iA Code 를 $GENIA_APP_DIR 에 두지 못했습니다" || return
  rm -rf "$dl" "$new" "$bad"
  genia_prune
  log "Gen:iA Code 를 새로 두었습니다: $stem"
  return 0
}

# 3. genia-works 플러그인 — 기본은 빌드 때 굳힌 것(GENIA_PLUGIN_DIR). Works 의 마켓플레이스 버전에 genia 확장이 있으면 그것(genia_market_plugin).
#    결과 폴더의 스크립트를 lib.sh 의 adopt_plugin_scripts 로 쓰기로 한다(GW_SCRIPTS·gw-lib·AI 폴더 실제 경로).
use_plugin() {
  local plugin=$GENIA_PLUGIN_DIR
  # 명령 치환($(…))으로 부르지 않는다 — 치환을 기다리는 동안은 SIGTERM trap 이 미뤄진다. 결과는 GENIA_MARKET_PLUGIN 으로 받는다.
  GENIA_MARKET_PLUGIN=""
  genia_market_plugin && plugin=$GENIA_MARKET_PLUGIN
  adopt_plugin_scripts "$plugin/scripts"
}

# 마켓플레이스(<api origin>/claude/marketplace.json)의 genia-works 가 git-subdir(url·path·ref)면 그 ref 를 /work/.genia-plugin/<ref> 에 얕게 받고,
# 그 안에 genia/index.ts 가 있을 때만 그 플러그인 폴더를 GENIA_MARKET_PLUGIN 에 둔다(옛 ref 에는 genia 확장이 없다). 쓸 수 없으면(닿지 않음·형식
# 다름·genia/ 없음) 사유를 로그에 남기고 1 — 굳힌 것으로 계속한다.
# 캐시는 ref 이름 폴더다. 릴리스 태그(genia-works--v<버전>)는 내용이 바뀌지 않아 받아 둔 것을 그대로 쓰고, 그 밖(브랜치 등 움직이는 ref)은
# 매번 다시 받는다(첫 커밋에 머물지 않게). 지금 ref 말고 옛 ref 폴더·받다 만 임시 폴더는 지운다.
# clone 은 뒤에서 돌린다(bg_wait — SIGTERM 즉시 처리). 받기가 멈추면(초당 1KB 미만 30초) 그만둔다. 비공개 저장소면 자격 증명(setup_git) 전이라
# 실패하고 굳힌 것을 쓴다.
genia_market_plugin() {
  local want mk src tab url path ref dest tmp d
  want="$(api_origin)/claude/marketplace.json"
  mk=$(curl -fsS --connect-timeout 5 --max-time 15 "$want" 2>/dev/null </dev/null) || {
    log "경고: 마켓플레이스($want)에 닿지 못해 이미지에 굳힌 플러그인으로 계속합니다"
    return 1
  }
  src=$(printf '%s' "$mk" | jq -r '[.plugins[]? | select(.name == "genia-works") | .source][0]
      | if (type == "object" and .source == "git-subdir") then "\(.url)\t\(.path)\t\(.ref)" else empty end' 2>/dev/null)
  if [ -z "$src" ]; then
    log "마켓플레이스의 genia-works 가 git 저장소 형식이 아니라 이미지에 굳힌 플러그인을 씁니다"
    return 1
  fi
  tab=$(printf '\t')
  IFS="$tab" read -r url path ref <<SRC_EOF
$src
SRC_EOF
  # ref 는 폴더 이름, path 는 그 아래 경로가 된다 — 벗어나는 값은 받지 않는다.
  case "$ref" in '' | .* | *[!A-Za-z0-9._-]*) ref="" ;; esac
  case "$path" in '' | /* | *..* | *[!A-Za-z0-9._/-]*) path="" ;; esac
  case "$url" in https://* | http://* | file://*) ;; *) url="" ;; esac
  if [ -z "$ref" ] || [ -z "$path" ] || [ -z "$url" ]; then
    log "경고: 마켓플레이스의 genia-works 저장소 값이 이상해 이미지에 굳힌 플러그인을 씁니다"
    return 1
  fi
  mkdir -p "$GENIA_PLUGIN_CACHE" || return 1
  dest="$GENIA_PLUGIN_CACHE/$ref"
  for d in "$GENIA_PLUGIN_CACHE"/* "$GENIA_PLUGIN_CACHE"/.new.*; do
    [ -e "$d" ] || continue
    [ "$d" = "$dest" ] || rm -rf "$d"
  done
  case "$ref" in genia-works--v*) ;; *) rm -rf "$dest" ;; esac
  if [ ! -d "$dest/.git" ]; then
    # 빈 임시 폴더에 바로 받고 다 받은 뒤 mv 한 번으로 자리에 둔다(받다 끊겨도 반쯤 받은 ref 폴더가 남지 않게).
    tmp=$(mktemp -d "$GENIA_PLUGIN_CACHE/.new.XXXXXX") || return 1
    if ! bg_wait env GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 \
      clone -q --depth 1 --branch "$ref" --filter=blob:none --sparse "$url" "$tmp" >/dev/null 2>&1 </dev/null ||
      ! git -C "$tmp" sparse-checkout set "$path" >/dev/null 2>&1 </dev/null ||
      ! mv "$tmp" "$dest"; then
      rm -rf "$tmp"
      log "경고: 마켓플레이스의 genia-works($ref)를 받지 못해 이미지에 굳힌 플러그인을 씁니다"
      return 1
    fi
  fi
  if [ ! -f "$dest/$path/genia/index.ts" ]; then
    log "마켓플레이스의 genia-works($ref)에는 Gen:iA Code 확장이 없어 이미지에 굳힌 플러그인을 씁니다"
    return 1
  fi
  log "마켓플레이스의 genia-works($ref)를 씁니다"
  GENIA_MARKET_PLUGIN="$dest/$path"
}

# 4. genia 환경 — 설정·로그인 폴더를 AI 폴더(/work, 영속) 아래로(genia 가 스스로 갱신한 로그인이 Pod 를 다시 만들어도 남게).
#    tmux 서버(첫 칸)가 뜨기 전에 내보내 칸이 물려받게 한다(agent-window 의 GW_TMUX_ENV 는 PATH·서버 주소·워크스페이스만 넘긴다).
#    GENIA_SKIP_VERSION_CHECK 는 이미지 ENV, GENIA_WORKS_MCP_URL 은 runner env 그대로 칸까지 간다.
genia_env() {
  export GENIA_CODING_AGENT_DIR="$AI_DIR/genia-agent"
  mkdir -p "$GENIA_CODING_AGENT_DIR" && chmod 700 "$GENIA_CODING_AGENT_DIR"
}

# 5. genia 설정(settings.json) — 매번 덮어쓴다(재생성된 Pod 에 옛 값이 남지 않게).
#    defaultModel 은 모델 id(공급자는 배포본이 genia 로 고정 — lockedProvider. defaultProvider 도 같은 값으로 적어 둔다),
#    defaultProjectTrust always(사람 없는 칸이 신뢰 물음에 막히지 않게 — 에이전트 폴더 설정에만 둘 수 있다), quietStartup(시작 머리말·목록 숨김).
#    mcp.json 에는 genia-works 를 쓰지 않는다 — 손으로 적은 항목이 확장의 등록(신원 전환·키 보호)을 가린다.
write_genia_settings() {
  local out
  out=$(jq -n --slurpfile c "$CONFIG" '
      $c[0] as $c
      | { defaultProvider: "genia" }
      + (if (($c.config.model // "") | tostring) != "" then { defaultModel: $c.config.model } else {} end)
      + { defaultProjectTrust: "always", quietStartup: true }
    ') && gw_write_atomic "$GENIA_CODING_AGENT_DIR/settings.json" "$out"
}

# 6. 로그인 정보 시딩(계약 「로그인 정보」) — 보관본 $GENIA_CODING_AGENT_DIR/auth.json, 표식 $AI_DIR/state/login-version.
#    마운트 파일이 없거나 비었으면 보관본·표식을 지운다(연결 끊기가 실제로 끊기게). 표식이 GENIA_LOGIN_VERSION 과 다르면(없음 포함) 600 으로
#    원자적으로 복사하고 표식을 적는다. 같으면 그대로 — genia 가 스스로 갱신한 로그인을 옛 Secret 값으로 덮지 않는다.
#    쓰기는 gw-lib 의 gw_write_atomic(임시 파일 → 600 → mv) — 내용은 셸 내장 printf 로만 쓰여 외부 명령 인자·로그에 실리지 않는다.
seed_login() {
  local src="$GENIA_RUN_DIR/login-info" dst="$GENIA_CODING_AGENT_DIR/auth.json" mark="$AI_DIR/state/login-version"
  if [ ! -s "$src" ]; then
    rm -f "$dst" "$mark"
  elif [ "$(cat "$mark" 2>/dev/null)" != "${GENIA_LOGIN_VERSION:-}" ] || [ ! -s "$dst" ] || [ ! -f "$mark" ]; then
    gw_write_atomic "$dst" "$(cat "$src")" && gw_write_atomic "$mark" "${GENIA_LOGIN_VERSION:-}" ||
      log "경고: Gen:iA 로그인 정보를 $GENIA_CODING_AGENT_DIR 에 두지 못했습니다"
  fi
  genia_login_ready || log "경고: Gen:iA 로그인 정보가 연결되지 않았습니다 — 관리 화면에서 연결하세요(연결 전에는 칸을 띄우지 않습니다)"
  return 0
}

# 로그인 정보가 심겼는지 — 없으면 genia 가 칸에서 로그인 선택 화면(브라우저·코드 입력)을 띄우고 멈춘다(11-03 실측 — /gw-loop 가 돌지 않아
# work-loop 가 실패를 알릴 수도 없다). 연결을 새로 하면 runner 가 Pod 를 다시 만든다.
genia_login_ready() {
  [ -s "$GENIA_CODING_AGENT_DIR/auth.json" ]
}

# 칸을 띄울 수 있는지 — genia 를 받았고 로그인 정보가 있을 때만. 아니면 칸도 알림 감시 창도 띄우지 않는다.
can_launch() { genia_ready && genia_login_ready; }

# 감독 한 회차(부팅 첫 회차 포함) — genia 가 없으면 다시 받아 보고, 칸을 띄울 수 있으면 lib.sh 의 supervise_once(처음이면 start_projects,
# 그 뒤 죽은 칸 되살리기·6일 넘은 칸 다시 띄우기·알림 감시 창)를 돈다. 못 띄우면 아무것도 하지 않는다.
# 회차 번호를 $AI_DIR/state/supervise-ticks 에 적는다 — 감독이 도는지 밖에서(테스트·kubectl exec) 볼 수 있게.
GENIA_TICKS=0
tick() {
  GENIA_TICKS=$((GENIA_TICKS + 1))
  genia_ready || install_genia || :
  if can_launch; then supervise_once; fi
  printf '%s\n' "$GENIA_TICKS" > "$AI_DIR/state/supervise-ticks" 2>/dev/null
  return 0
}
