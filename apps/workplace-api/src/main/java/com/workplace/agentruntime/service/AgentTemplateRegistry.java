package com.workplace.agentruntime.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.config.AgentRuntimeProperties;
import com.workplace.agentruntime.dto.AgentTemplate;
import com.workplace.agentruntime.dto.AgentTemplate.ConfigField;
import com.workplace.agentruntime.exception.InvalidAgentConfigException;
import com.workplace.auth.service.AgentProviders;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/**
 * AI 실행 템플릿 레지스트리(WP-1246) — 클래스패스 {@code agent-templates/*.yaml} 을 시작 때 한 번 읽어 검증하고 메모리에 둔다.
 *
 * <p>전역(테넌트와 무관) 읽기 전용 목록이다. 템플릿이 잘못되면(허용 밖 이미지·이름 중복·선택지 없는 select 등) {@link
 * IllegalStateException} 으로 앱이 뜨지 않게 한다 — 운영 중에 깨진 템플릿을 만나 500 이 나는 것보다 배포 때 바로 드러나는 편이 낫다.
 */
@Component
public class AgentTemplateRegistry {

  private static final ObjectMapper MAPPER = new ObjectMapper();
  private static final Set<String> KINDS = Set.of("SERVER", "WORKSPACE");
  private static final Set<String> FIELD_TYPES = Set.of("select", "text");

  /** select 칸의 optionsFrom 에 쓸 수 있는 값(WP-1405) — 지금은 「연결된 AI 계정의 모델 목록」 하나. */
  private static final String ACCOUNT_MODELS = "account-models";

  private static final Set<String> OPTIONS_FROM = Set.of(ACCOUNT_MODELS);

  /**
   * 계정 모델 칸에 저장할 수 있는 모델 id 꼴(WP-1405) — 1~128자, 공백·제어 문자 없이 영문·숫자와 {@code . _ : / @ [ ] -} 만.
   * 별칭(opus), 전체 id(claude-opus-5-5[1m]), 공급자 접두(provider/model)를 모두 받고, settings.json·defaultModel
   * 에 개행·공백 같은 이상한 값이 들어가지 않게 막는다.
   */
  private static final Pattern MODEL_ID = Pattern.compile("[A-Za-z0-9._:/@\\[\\]-]{1,128}");

  /** requires 에 쓸 수 있는 값(정규화 뒤) — 계정(claude·genia·chatgpt)과 저장소 토큰(repo). 오타가 조용히 무시되지 않게 막는다. */
  private static final Set<String> REQUIREMENTS =
      Stream.concat(AgentProviders.ACCOUNT_REQUIREMENTS.stream(), Stream.of("repo"))
          .collect(Collectors.toUnmodifiableSet());

  /**
   * 템플릿 YAML 의 이미지 태그 자리표시 — 이 API 의 릴리스 버전으로 바꾼다. 작업 공간 이미지는 API 와 같은 릴리스 태그로 빌드되므로(릴리스 카탈로그는 바뀌지
   * 않은 이미지도 태그를 승계한다), 템플릿을 릴리스마다 고치지 않아도 늘 같은 릴리스의 이미지를 가리킨다.
   */
  static final String APP_VERSION_TOKEN = "{appVersion}";

  /** 빌드 인자가 없는 로컬·테스트의 버전 값 — 이때는 이미지 태그를 {@code latest} 로 둔다. */
  private static final String DEV_VERSION = "dev";

  private final AgentRuntimeProperties properties;
  private final String appVersion;
  private volatile List<AgentTemplate> templates = List.of();

  public AgentTemplateRegistry(
      AgentRuntimeProperties properties, @Value("${info.app.version:dev}") String appVersion) {
    this.properties = properties;
    this.appVersion = appVersion;
  }

  /** 시작 때 클래스패스의 모든 템플릿 YAML 을 읽어 검증한다. 하나라도 틀리면 시작 실패. */
  @PostConstruct
  void init() {
    try {
      Resource[] resources =
          new PathMatchingResourcePatternResolver()
              .getResources("classpath*:agent-templates/*.yaml");
      List<String> sources = new ArrayList<>();
      for (Resource r : resources) {
        sources.add(new String(r.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
      }
      this.templates = load(sources, properties.allowedImagePrefixes(), appVersion);
    } catch (IOException e) {
      throw new IllegalStateException("실행 템플릿을 읽지 못했습니다", e);
    }
  }

  /** 모든 템플릿(이름순). */
  public List<AgentTemplate> list() {
    return templates;
  }

  /** 이름으로 템플릿 한 개. */
  public Optional<AgentTemplate> find(String name) {
    return templates.stream().filter(t -> t.name().equals(name)).findFirst();
  }

  /**
   * YAML 본문들을 템플릿으로 바꾸고 검증한다(순수 함수 — 단위 테스트가 직접 부른다).
   *
   * @param yamlSources 템플릿 YAML 본문 목록
   * @param allowedImagePrefixes 메인·보조 컨테이너 이미지가 시작해야 하는 접두사 중 하나
   * @param appVersion 이 API 의 릴리스 버전 — 본문의 {@value #APP_VERSION_TOKEN} 을 이 값으로(dev 면 latest) 바꾼다
   * @throws IllegalStateException 검증 실패 — 시작을 막는다
   */
  public static List<AgentTemplate> load(
      List<String> yamlSources, List<String> allowedImagePrefixes, String appVersion) {
    String tag =
        appVersion == null || appVersion.isBlank() || DEV_VERSION.equals(appVersion)
            ? "latest"
            : appVersion.strip();
    List<AgentTemplate> result = new ArrayList<>();
    Set<String> names = new HashSet<>();
    for (String src : yamlSources) {
      AgentTemplate t = parse(src.replace(APP_VERSION_TOKEN, tag));
      validate(t, allowedImagePrefixes);
      if (!names.add(t.name())) {
        throw new IllegalStateException("실행 템플릿 이름이 겹칩니다: " + t.name());
      }
      result.add(t);
    }
    result.sort((a, b) -> a.name().compareTo(b.name()));
    return List.copyOf(result);
  }

  private static AgentTemplate parse(String src) {
    try {
      // SafeConstructor — YAML 로 임의 객체를 만들지 못하게 한다(클래스패스 파일이지만 방어적으로).
      Object raw = new Yaml(new SafeConstructor(new LoaderOptions())).load(src);
      if (!(raw instanceof Map<?, ?> map)) {
        throw new IllegalStateException("실행 템플릿 YAML 이 객체가 아닙니다");
      }
      // account 는 requires 에서 정해진다 — 따로 적으면 어긋날 수 있어 받지 않는다(WP-1296·1297).
      if (map.containsKey("account")) {
        throw new IllegalStateException("실행 템플릿에 「account」 는 적을 수 없습니다 — requires 로 정해집니다");
      }
      return normalizeRequires(MAPPER.convertValue(raw, AgentTemplate.class));
    } catch (IllegalArgumentException e) {
      // Jackson 변환 실패(모르는 키·타입 불일치) — 시작 실패로 통일한다.
      throw new IllegalStateException("실행 템플릿 형식이 올바르지 않습니다: " + e.getMessage(), e);
    }
  }

  /**
   * 요구 이름 정규화 — 옛 이름 {@code github} 를 {@code repo}(GitHub·GitLab 저장소 토큰)와 같은 뜻으로 읽는다(WP-1268). 소비
   * 쪽(desired·켜기 전 확인·화면)이 {@code repo} 한 가지만 보게 이 한 곳에서 바꾸고, 겹치면 하나로 합친다.
   */
  private static AgentTemplate normalizeRequires(AgentTemplate t) {
    List<String> requires =
        t.requires().stream().map(r -> "github".equals(r) ? "repo" : r).distinct().toList();
    return new AgentTemplate(
        t.name(),
        t.version(),
        t.kind(),
        t.card(),
        t.image(),
        requires,
        t.config(),
        t.resources(),
        t.sidecars(),
        t.plugins());
  }

  /** 템플릿 한 개의 구조 검증 — 필수 값, 종류, 이미지 접두사, 설정 칸 규칙. */
  private static void validate(AgentTemplate t, List<String> allowedImagePrefixes) {
    String who = "실행 템플릿 「" + t.name() + "」";
    if (isBlank(t.name()) || isBlank(t.version())) {
      throw new IllegalStateException("실행 템플릿의 이름·버전이 비어 있습니다");
    }
    if (t.kind() == null || !KINDS.contains(t.kind())) {
      throw new IllegalStateException(who + " 의 종류는 SERVER 또는 WORKSPACE 여야 합니다");
    }
    if (t.card() == null || isBlank(t.card().title())) {
      throw new IllegalStateException(who + " 에 카드 제목이 없습니다");
    }
    for (String need : t.requires()) {
      if (!REQUIREMENTS.contains(need)) {
        throw new IllegalStateException(who + " 의 requires 값 「" + need + "」 를 알 수 없습니다");
      }
    }
    // 템플릿 하나에 AI 계정 하나 — 한 AI 의 활성 연결은 하나라 두 계정을 동시에 갖출 수 없다.
    if (t.requires().stream().filter(r -> AgentProviders.accountForRequirement(r) != null).count()
        > 1) {
      throw new IllegalStateException(who + " 는 AI 계정을 하나만 요구할 수 있습니다");
    }
    if ("WORKSPACE".equals(t.kind())) {
      if (isBlank(t.image())) {
        throw new IllegalStateException(who + " 은 작업 공간 템플릿이라 이미지가 필요합니다");
      }
      if (t.resources() == null) {
        throw new IllegalStateException(who + " 은 작업 공간 템플릿이라 자원 설정이 필요합니다");
      }
    }
    if (!isBlank(t.image())) {
      requireAllowedImage(who, t.image(), allowedImagePrefixes);
    }
    for (AgentTemplate.Sidecar s : t.sidecars()) {
      if (isBlank(s.name()) || isBlank(s.image())) {
        throw new IllegalStateException(who + " 의 보조 컨테이너에 이름·이미지가 필요합니다");
      }
      requireAllowedImage(who, s.image(), allowedImagePrefixes);
    }
    Set<String> keys = new HashSet<>();
    for (ConfigField f : t.config()) {
      if (isBlank(f.key()) || !keys.add(f.key())) {
        throw new IllegalStateException(who + " 의 설정 칸 key 가 비었거나 겹칩니다");
      }
      if (f.type() == null || !FIELD_TYPES.contains(f.type())) {
        throw new IllegalStateException(
            who + " 의 설정 칸 「" + f.key() + "」 형식은 select 또는 text 여야 합니다");
      }
      // optionsFrom 은 select 칸에만, 아는 값만 — 오타가 조용히 정적 선택지로 떨어지지 않게 시작을 막는다.
      if (f.optionsFrom() != null) {
        if (!"select".equals(f.type())) {
          throw new IllegalStateException(
              who + " 의 설정 칸 「" + f.key() + "」 은 select 가 아니라 optionsFrom 을 쓸 수 없습니다");
        }
        if (!OPTIONS_FROM.contains(f.optionsFrom())) {
          throw new IllegalStateException(
              who + " 의 설정 칸 「" + f.key() + "」 optionsFrom 값 「" + f.optionsFrom() + "」 를 알 수 없습니다");
        }
      }
      if ("select".equals(f.type())) {
        // 정적 options 는 optionsFrom 이 있어도 필수다 — 계정 목록을 받지 못할 때(옛 웹 포함) 보이는 기본 선택지라서.
        if (f.options().isEmpty()) {
          throw new IllegalStateException(who + " 의 선택 칸 「" + f.key() + "」 에 선택지가 없습니다");
        }
        if (f.defaultValue() != null
            && f.options().stream().noneMatch(o -> o.value().equals(f.defaultValue()))) {
          throw new IllegalStateException(who + " 의 선택 칸 「" + f.key() + "」 기본값이 선택지에 없습니다");
        }
      }
    }
  }

  private static void requireAllowedImage(String who, String image, List<String> prefixes) {
    if (prefixes.stream().noneMatch(image::startsWith)) {
      throw new IllegalStateException(who + " 의 이미지 「" + image + "」 는 허용된 레지스트리가 아닙니다");
    }
  }

  private static boolean isBlank(String s) {
    return s == null || s.isBlank();
  }

  /**
   * 입력 설정을 템플릿 정의에 맞춰 검증하고 기본값을 채운다.
   *
   * <ul>
   *   <li>템플릿에 없는 키 → 400
   *   <li>select 값이 선택지 밖 → 400(optionsFrom 칸은 선택지 대신 모델 id 꼴만 본다 — 꼴이 아니면 400, WP-1405)
   *   <li>비었는데 required 이고 기본값도 없음 → 400
   *   <li>키가 없는 칸 → 기본값(WP-1344: 「정해 둔 적 없음」)
   *   <li>키는 있고 값이 빈(공백만 포함) 선택(비필수) text 칸 → 기본값으로 채우지 않고 ""(사용자가 일부러 비움)
   *   <li>키는 있고 값이 빈 필수 칸·select 칸 → 기본값(없으면 필수는 400, 선택 select 는 키를 뺀다)
   * </ul>
   *
   * @return 정의된 칸 순서대로 값이 채워진 맵(기본값도 없고 키도 없는 선택 칸은 뺀다)
   */
  public static Map<String, String> validateConfig(AgentTemplate t, Map<String, String> input) {
    Map<String, String> in = input == null ? Map.of() : input;
    Set<String> known = new HashSet<>();
    for (ConfigField f : t.config()) known.add(f.key());
    for (String key : in.keySet()) {
      if (!known.contains(key)) {
        throw new InvalidAgentConfigException("이 템플릿에 없는 설정입니다: " + key);
      }
    }
    Map<String, String> out = new LinkedHashMap<>();
    for (ConfigField f : t.config()) {
      // 앞뒤 공백을 먼저 지운다 — select 선택지 비교와 저장 값이 text 칸과 같은 기준(다듬은 값)이 되게.
      String given = in.get(f.key()) == null ? null : in.get(f.key()).trim();
      String fallback = f.defaultValue() == null ? null : f.defaultValue().trim();
      // 선택(비필수) text 칸을 비워 보낸 것은 "비움"이라 기본값으로 되돌리지 않는다. select 는 값이 늘 선택지 중 하나여야 하므로 예전대로 기본값.
      boolean keepBlank = !f.required() && !"select".equals(f.type());
      final String v = given == null || (given.isEmpty() && !keepBlank) ? fallback : given;
      // 필수 칸은 기본값이 "" 여도 빈 값으로 저장하지 않고 아래 필수 검사(400)로 보낸다.
      if (keepBlank && v != null && v.isEmpty()) {
        out.put(f.key(), "");
        continue;
      }
      if (v == null || v.isBlank()) {
        if (f.required()) {
          throw new InvalidAgentConfigException("「" + f.label() + "」 값이 필요합니다");
        }
        continue;
      }
      if (ACCOUNT_MODELS.equals(f.optionsFrom())) {
        // 계정 모델 칸 — 선택지는 계정마다 다르고 별칭·목록 밖 id 도 정당하게 쓸 수 있어 정적 선택지와 대조하지 않는다. 저장 때마다 실시간
        // 목록을 부르면 저장이 외부 장애에 묶이므로 꼴만 본다. 켤 때(repin)도 같은 규칙이라 목록 밖 id 로 저장한 AI 가 400 을 맞지 않는다.
        if (!MODEL_ID.matcher(v).matches()) {
          throw new InvalidAgentConfigException("「" + f.label() + "」 값이 올바르지 않습니다");
        }
      } else if ("select".equals(f.type())
          && f.options().stream().noneMatch(o -> o.value().equals(v))) {
        throw new InvalidAgentConfigException("「" + f.label() + "」 에 고를 수 없는 값입니다");
      }
      out.put(f.key(), v);
    }
    return out;
  }
}
