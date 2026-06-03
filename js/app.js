/**
 * 아이랑 세종 AI - 메인 앱 로직
 *
 * 구성:
 *  1) 탭 라우팅
 *  2) 외출 추천: 자연어/조건 입력 → 8개 기준 점수화 → 상위 3개 + 대체안
 *  3) AI 질문: 키워드 기반 분류 → 공식 링크 + 응급 체크리스트
 *  4) 행정 대시보드: localStorage 기반 비식별 집계 통계
 */

// ============================================================
// 0. 공통 유틸
// ============================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const LOG_KEY = "irang_sejong_log_v1";
function loadLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); }
  catch { return []; }
}
function pushLog(event) {
  const log = loadLog();
  log.push({ ...event, ts: Date.now() });
  // 최근 1000건만 유지
  localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-1000)));
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

// ============================================================
// 1. 탭 라우팅
// ============================================================

function activateTab(name) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  $$(".page").forEach(p => p.classList.toggle("active", p.id === name));
  if (name === "dashboard") renderDashboard();
}

function initTabs() {
  $$(".tab").forEach(t => {
    t.addEventListener("click", () => activateTab(t.dataset.tab));
  });
}

// ============================================================
// 2. 외출 추천 (Feature 1)
// ============================================================

// 사용자 조건에서 자연어 키워드 추출 (간단한 룰 기반)
function parseFreeText(text) {
  const conditions = {};
  if (!text) return conditions;
  const t = text.trim();

  // 월령 추출 (예: "8개월", "24개월")
  const ageM = t.match(/(\d{1,2})\s*개월/);
  if (ageM) conditions.ageMonths = parseInt(ageM[1], 10);

  // 자녀 수 / 쌍둥이
  if (/쌍둥이|쌍동이|twin/i.test(t)) conditions.twin = true;

  // 유모차 종류
  if (/쌍둥이\s*유모차|광폭|트윈/i.test(t)) conditions.stroller = "twin";
  else if (/유모차/.test(t)) conditions.stroller = "regular";

  // 수유실 필요
  if (/수유실|수유/.test(t)) conditions.needNursing = true;

  // 기저귀
  if (/기저귀/.test(t)) conditions.needDiaper = true;

  // 날씨
  if (/비\s*오|우천|비\s*와|비가/.test(t)) conditions.weather = "rain";
  else if (/폭염|더위|뜨거|한낮/.test(t)) conditions.weather = "heat";
  else if (/추위|영하|한파/.test(t)) conditions.weather = "cold";
  else if (/미세먼지|황사/.test(t)) conditions.weather = "dust";

  // 실내/실외 선호
  if (/실내/.test(t)) conditions.preferIndoor = true;
  if (/실외|야외|밖/.test(t)) conditions.preferIndoor = false;

  // 무료
  if (/무료|공짜/.test(t)) conditions.freeOnly = true;

  // 생활권 (간단 매칭)
  for (const d of DISTRICTS) {
    if (t.includes(d.replace("동", ""))) { conditions.district = d; break; }
  }

  return conditions;
}

// 8개 기준 점수화
function scoreFacility(facility, cond) {
  let score = 0;
  const reasons = [];
  let hardFail = false;

  // (1) 영유아 편의 (max 20)
  let infantScore = 0;
  if (facility.facilities.nursing) infantScore += 8;
  if (facility.facilities.diaper) infantScore += 8;
  if (facility.facilities.washingHotWater) infantScore += 4;
  if (cond.needNursing && !facility.facilities.nursing) {
    hardFail = true;
    reasons.push({ type: "warn", text: "수유실이 없어 조건에 부합하지 않음" });
  }
  if (cond.needDiaper && !facility.facilities.diaper) {
    hardFail = true;
    reasons.push({ type: "warn", text: "기저귀 교환대가 없어 조건에 부합하지 않음" });
  }
  score += infantScore;
  if (facility.facilities.nursing) reasons.push({ type: "ok", text: "수유실 있음" });
  if (facility.facilities.diaper) reasons.push({ type: "ok", text: "기저귀 교환대 있음" });
  if (facility.facilities.washingHotWater) reasons.push({ type: "ok", text: "세면·온수 가능" });

  // (2) 이동 편의 (max 20)
  let moveScore = 0;
  if (facility.accessibility.stroller) moveScore += 6;
  if (facility.accessibility.twinStroller) moveScore += 6;
  if (facility.accessibility.elevator) moveScore += 4;
  if (facility.accessibility.ramp) moveScore += 4;
  if (cond.stroller === "twin" && !facility.accessibility.twinStroller) {
    hardFail = true;
    reasons.push({ type: "warn", text: "광폭/쌍둥이 유모차 진입 어려움" });
  }
  if (cond.stroller && !facility.accessibility.stroller) {
    hardFail = true;
    reasons.push({ type: "warn", text: "유모차 진입 어려움" });
  }
  score += moveScore;
  if (cond.stroller === "twin" && facility.accessibility.twinStroller) {
    reasons.push({ type: "ok", text: "쌍둥이 유모차 진입 가능" });
  } else if (cond.stroller === "regular" && facility.accessibility.stroller) {
    reasons.push({ type: "ok", text: "유모차 진입 가능" });
  }

  // (3) 주차 편의 (max 10)
  if (facility.parking.available) score += 5;
  if (facility.parking.indoor) score += 5;
  if (facility.parking.indoor) reasons.push({ type: "ok", text: "실내 주차 가능" });

  // (4) 혼잡도 (max 10) - 주말/평일 추정
  const isWeekend = [0, 6].includes(new Date().getDay());
  const crowd = isWeekend ? facility.crowdedness.weekend : facility.crowdedness.weekday;
  if (crowd === "low") score += 10;
  else if (crowd === "mid") score += 6;
  else if (crowd === "high") score += 2;
  if (crowd === "low") reasons.push({ type: "ok", text: "현재 비교적 한산" });
  if (crowd === "high") reasons.push({ type: "info", text: "주말·시간대에 따라 혼잡 가능" });

  // (5) 비용 (max 5)
  if (facility.cost.free) score += 5;
  if (cond.freeOnly && !facility.cost.free) {
    hardFail = true;
    reasons.push({ type: "warn", text: "유료 시설 (무료만 원함)" });
  }
  if (facility.cost.free) reasons.push({ type: "ok", text: "무료" });

  // (6) 운영시간 (max 10) - 오늘 열려있는지 간단 추정
  const todayName = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"][new Date().getDay()];
  const closedToday = facility.closedDays.some(d => d.includes(todayName));
  if (!closedToday) score += 10;
  else { hardFail = true; reasons.push({ type: "warn", text: `오늘(${todayName}) 휴관` }); }

  // (7) 환경 적합도 (max 15) - 날씨
  if (cond.weather) {
    const adapt = facility.weatherAdapt[cond.weather];
    if (adapt === "good") { score += 15; reasons.push({ type: "ok", text: `${weatherLabel(cond.weather)}에 적합 (실내·쾌적)` }); }
    else if (adapt === "fair") { score += 8; reasons.push({ type: "info", text: `${weatherLabel(cond.weather)}에 일부 적합` }); }
    else { score += 0; reasons.push({ type: "warn", text: `${weatherLabel(cond.weather)}에는 비추천` }); }
  } else {
    score += 8; // 날씨 미지정 시 중간값
  }
  if (cond.preferIndoor === true && !facility.indoor) {
    hardFail = true;
    reasons.push({ type: "warn", text: "실내 선호인데 실외 시설" });
  }

  // (8) 월령 적합도 (max 10)
  if (cond.ageMonths != null) {
    const [minM, maxM] = facility.ageRange;
    if (cond.ageMonths >= minM && cond.ageMonths <= maxM) {
      score += 10;
      reasons.push({ type: "ok", text: `${cond.ageMonths}개월 적합 (대상 ${minM}~${maxM}개월)` });
    } else if (cond.ageMonths < minM) {
      score += 2;
      reasons.push({ type: "info", text: `권장 월령(${minM}개월~)보다 어림 - 보호자 판단 필요` });
    }
  } else {
    score += 6;
  }

  return { score, reasons, hardFail };
}

function weatherLabel(w) {
  return { rain: "우천", heat: "폭염", cold: "한파", dust: "미세먼지 나쁨" }[w] || "현재 날씨";
}

// 추천 실행
function runRecommendation() {
  const text = $("#recommend-text").value;
  const ageInput = $("#recommend-age").value;
  const districtInput = $("#recommend-district").value;
  const strollerInput = $("#recommend-stroller").value;
  const weatherInput = $("#recommend-weather").value;
  const needNursing = $("#recommend-nursing").checked;
  const needDiaper = $("#recommend-diaper").checked;
  const freeOnly = $("#recommend-free").checked;
  const preferIndoor = $("#recommend-indoor").checked;

  // 1) 자연어 텍스트 우선 파싱
  const parsed = parseFreeText(text);
  // 2) 폼 입력값으로 덮어쓰기
  const cond = {
    ...parsed,
    ageMonths: ageInput ? parseInt(ageInput, 10) : parsed.ageMonths,
    district: districtInput || parsed.district,
    stroller: strollerInput || parsed.stroller,
    weather: weatherInput || parsed.weather,
    needNursing: needNursing || parsed.needNursing,
    needDiaper: needDiaper || parsed.needDiaper,
    freeOnly: freeOnly || parsed.freeOnly,
    preferIndoor: preferIndoor ? true : parsed.preferIndoor,
  };

  // 로깅 (비식별)
  pushLog({
    type: "search",
    district: cond.district || "전체",
    ageBucket: bucketAge(cond.ageMonths),
    weather: cond.weather || null,
    needNursing: !!cond.needNursing,
    needTwinStroller: cond.stroller === "twin",
  });

  // 점수 계산
  const scored = FACILITIES.map(f => ({
    facility: f,
    ...scoreFacility(f, cond),
  }));

  // hardFail 제외 후 정렬
  const pass = scored.filter(s => !s.hardFail).sort((a, b) => b.score - a.score);
  const alt = scored.filter(s => s.hardFail).sort((a, b) => b.score - a.score);

  // 생활권 가까운 곳 보너스 (있을 경우)
  if (cond.district) {
    pass.sort((a, b) => {
      const aLocal = a.facility.district === cond.district ? 1 : 0;
      const bLocal = b.facility.district === cond.district ? 1 : 0;
      if (aLocal !== bLocal) return bLocal - aLocal;
      return b.score - a.score;
    });
  }

  renderRecommendResults(pass.slice(0, 3), alt.slice(0, 2), cond);
}

function bucketAge(m) {
  if (m == null) return "미지정";
  if (m <= 6) return "0~6개월";
  if (m <= 12) return "7~12개월";
  if (m <= 24) return "13~24개월";
  return "25~36개월";
}

function renderRecommendResults(top, alt, cond) {
  const root = $("#recommend-results");
  root.innerHTML = "";

  // 조건 요약
  const summary = el("div", { class: "summary" }, [
    el("strong", {}, "AI가 이해한 오늘의 조건"),
    el("p", {}, conditionsToText(cond)),
  ]);
  root.appendChild(summary);

  if (top.length === 0) {
    root.appendChild(el("div", { class: "empty" }, "조건에 정확히 맞는 시설을 찾지 못했습니다. 조건을 일부 완화하여 다시 검색해 보세요."));
  } else {
    root.appendChild(el("h3", { class: "section-title" }, `오늘 추천 장소 (${top.length}곳)`));
    top.forEach((r, i) => root.appendChild(renderCard(r, i + 1, false)));
  }

  if (alt.length > 0) {
    root.appendChild(el("h3", { class: "section-title alt" }, "조건 조정 시 대체 가능"));
    alt.forEach((r, i) => root.appendChild(renderCard(r, i + 1, true)));
  }

  // 안내 문구
  root.appendChild(el("p", {
    class: "disclaimer",
    html: `※ 운영시간·예약·휴관 등 변동 정보는 <b>공식 페이지에서 최종 확인</b>해 주세요. 정보 갱신 기준일: <b>${DATA_UPDATED}</b>`
  }));
}

function conditionsToText(c) {
  const parts = [];
  if (c.ageMonths != null) parts.push(`${c.ageMonths}개월`);
  if (c.district) parts.push(c.district);
  if (c.stroller === "twin") parts.push("쌍둥이 유모차");
  else if (c.stroller === "regular") parts.push("일반 유모차");
  if (c.weather) parts.push(weatherLabel(c.weather));
  if (c.preferIndoor === true) parts.push("실내 선호");
  if (c.needNursing) parts.push("수유실 필요");
  if (c.needDiaper) parts.push("기저귀 교환대 필요");
  if (c.freeOnly) parts.push("무료만");
  return parts.length > 0 ? parts.join(" · ") : "조건이 입력되지 않아 기본값으로 추천합니다.";
}

function renderCard(r, rank, isAlt) {
  const f = r.facility;
  const reasonChips = r.reasons.slice(0, 6).map(rs =>
    el("span", { class: `chip ${rs.type}` }, rs.text)
  );
  const ribbon = el("div", { class: "ribbon" }, `${isAlt ? "대체" : "추천"} ${rank}`);
  const badge = f.managed
    ? el("span", { class: "badge managed" }, "세종시 관리")
    : el("span", { class: "badge external" }, "공식 페이지 연결");

  const todayName = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"][new Date().getDay()];
  const isWeekend = [0, 6].includes(new Date().getDay());
  const hour = isWeekend ? f.hours.weekend : f.hours.weekday;

  return el("article", { class: `card ${isAlt ? "alt" : ""}` }, [
    ribbon,
    el("div", { class: "card-head" }, [
      el("h4", {}, f.name),
      badge,
    ]),
    el("p", { class: "muted" }, `${f.category} · ${f.district}`),
    el("p", { class: "desc" }, f.description),
    el("div", { class: "chips" }, reasonChips),
    el("dl", { class: "kv" }, [
      el("dt", {}, "오늘 운영"), el("dd", {}, `${todayName} ${hour}`),
      el("dt", {}, "예약"), el("dd", {}, f.reservation ? "필요" : "불필요"),
      el("dt", {}, "비용"), el("dd", {}, f.cost.free ? "무료" : (f.cost.fee || "유료")),
      el("dt", {}, "주소"), el("dd", {}, f.address),
      el("dt", {}, "정보 갱신"), el("dd", {}, f.updatedAt),
    ]),
    el("div", { class: "actions" }, [
      el("a", {
        class: "btn primary",
        href: f.officialUrl,
        target: "_blank",
        rel: "noopener",
        onclick: () => pushLog({ type: "click", facilityId: f.id, district: f.district })
      }, "공식 안내 보기 →"),
    ]),
  ]);
}

// ============================================================
// 3. AI 질문 (Feature 2)
// ============================================================

const QA_KEYWORDS = {
  응급: ["응급", "119", "경련", "의식", "호흡곤란", "토혈", "혈변", "피", "쓰러"],
  열: ["열", "발열", "고열", "체온", "38도", "39도"],
  예방접종: ["예방접종", "접종", "백신", "BCG", "DTaP", "MMR"],
  발달: ["뒤집기", "걷기", "말", "옹알이", "발달", "성장", "기기", "앉기"],
  보육: ["어린이집", "보육", "시간제", "돌봄", "원아모집", "입소"],
  외출: ["외출", "갈 만한", "갈만한", "추천", "데려갈", "나들이"],
  프로그램: ["프로그램", "수업", "교실", "강좌", "교육"],
  건강: ["설사", "구토", "감기", "콧물", "기침", "발진", "아토피", "수면"],
};

function classifyQuestion(q) {
  // 응급 우선
  for (const cat of ["응급", "열", "예방접종", "발달", "보육", "외출", "프로그램", "건강"]) {
    if (QA_KEYWORDS[cat].some(k => q.includes(k))) return cat;
  }
  return "기타";
}

function handleAsk() {
  const q = $("#ask-input").value.trim();
  if (!q) return;
  const cat = classifyQuestion(q);

  pushLog({ type: "ask", category: cat, length: q.length });

  const root = $("#ask-result");
  root.innerHTML = "";

  // 분류 표시
  root.appendChild(el("div", { class: "summary" }, [
    el("strong", {}, "AI가 분류한 질문 영역"),
    el("p", {}, `「${q}」 → 분류: ${cat}`),
  ]));

  // 응급/열 → 위험신호 + 공식 응급 안내
  if (cat === "응급" || cat === "열") {
    root.appendChild(renderEmergencyBlock(cat === "열" ? "열" : "응급"));
  }

  // 발달/건강 → 진단 금지 안내 + 위험신호 + 공식 정보
  if (cat === "발달" || cat === "건강") {
    root.appendChild(el("div", { class: "warning" }, [
      el("strong", {}, "안내"),
      el("p", {}, "AI는 진단을 제공하지 않습니다. 아래는 보호자가 참고할 수 있는 공식 정보와 위험신호 안내이며, 증상이 의심되면 보건소 또는 의료기관 상담을 권장합니다."),
    ]));
  }

  // 공식 링크 매핑
  const links = OFFICIAL_LINKS[cat] || OFFICIAL_LINKS.외출;
  root.appendChild(el("h3", { class: "section-title" }, "관련 공식 정보"));
  const list = el("div", { class: "link-list" });
  links.forEach(l => list.appendChild(
    el("a", {
      class: "link-card",
      href: l.url,
      target: "_blank",
      rel: "noopener",
      onclick: () => pushLog({ type: "ask-click", url: l.url, category: cat })
    }, [
      el("strong", {}, l.name),
      el("p", { class: "muted" }, l.note),
    ])
  ));
  root.appendChild(list);

  // 외출 분류 → 추천 기능으로 연결 제안
  if (cat === "외출") {
    root.appendChild(el("div", { class: "cta" }, [
      el("p", {}, "외출 장소 추천은 [외출 추천] 탭의 AI 추천을 이용해 보세요."),
      el("button", {
        class: "btn primary",
        onclick: () => {
          $("#recommend-text").value = q;
          activateTab("recommend");
        }
      }, "외출 추천으로 이동 →"),
    ]));
  }
}

function renderEmergencyBlock(kind) {
  const list = EMERGENCY_CHECKLIST[kind === "열" ? "열" : "호흡"];
  return el("div", { class: "warning emergency" }, [
    el("strong", {}, "🚨 위험신호 안내"),
    el("p", {}, "다음 중 하나라도 해당되면 즉시 119 또는 가까운 의료기관에 연락하세요."),
    el("ul", {}, list.map(item => el("li", {}, item))),
    el("p", { class: "emergency-call" }, [
      el("a", { href: "tel:119", class: "btn danger" }, "119 신고"),
      el("a", { href: "https://www.e-gen.or.kr/", target: "_blank", rel: "noopener", class: "btn secondary" }, "응급실 찾기"),
    ]),
  ]);
}

// ============================================================
// 4. 행정 대시보드 (Feature 3)
// ============================================================

function renderDashboard() {
  const log = loadLog();
  const root = $("#dashboard-content");
  root.innerHTML = "";

  // 헤더
  root.appendChild(el("div", { class: "dash-head" }, [
    el("p", { class: "muted" }, `총 ${log.length}건의 비식별 이벤트가 수집되었습니다. (개인정보·정확 위치 미수집)`),
    el("button", { class: "btn ghost small", onclick: seedDemoData }, "시연용 샘플 데이터 추가"),
    el("button", { class: "btn ghost small", onclick: clearLog }, "로그 초기화"),
  ]));

  if (log.length === 0) {
    root.appendChild(el("div", { class: "empty" }, "아직 수집된 이벤트가 없습니다. [외출 추천] 또는 [AI 질문]을 사용하면 비식별 통계가 누적됩니다. 또는 위의 '시연용 샘플 데이터 추가' 버튼을 눌러 데모 통계를 확인할 수 있습니다."));
    return;
  }

  // 1) 생활권별 검색량
  const searches = log.filter(l => l.type === "search");
  const districtCount = countBy(searches, "district");
  root.appendChild(renderBarChart("생활권별 검색량", districtCount, "건"));

  // 2) 월령대별 분포
  const ageCount = countBy(searches, "ageBucket");
  root.appendChild(renderBarChart("월령대별 검색 분포", ageCount, "건"));

  // 3) 조건별 (수유실 요청 / 쌍둥이 유모차)
  const nurseCount = searches.filter(s => s.needNursing).length;
  const twinCount = searches.filter(s => s.needTwinStroller).length;
  root.appendChild(renderKeyMetrics([
    { label: "수유실 필요 검색", value: nurseCount, hint: "수유실 개선·확충 우선지역 검토 신호" },
    { label: "쌍둥이/광폭 유모차 검색", value: twinCount, hint: "출입 동선 점검 신호" },
    { label: "공식 안내 클릭률", value: clickThroughRate(log), hint: "추천 → 공식 페이지 도달" },
  ]));

  // 4) 질문 카테고리
  const asks = log.filter(l => l.type === "ask");
  const catCount = countBy(asks, "category");
  root.appendChild(renderBarChart("AI 질문 카테고리 분포", catCount, "건"));

  // 5) 최근 이벤트 (테이블)
  root.appendChild(renderRecentEvents(log.slice(-20).reverse()));

  // 6) 행정 활용 가이드
  root.appendChild(el("div", { class: "note" }, [
    el("strong", {}, "활용 안내"),
    el("ul", {}, [
      el("li", {}, "이 통계는 단독 정책결정 근거가 아닌, 민원·이용실적·현장 확인을 보완하는 조기 수요 신호입니다."),
      el("li", {}, "개인을 식별할 수 있는 정보(이름·주소·이동경로)는 수집하지 않으며, 생활권·월령대·카테고리 단위로만 집계됩니다."),
      el("li", {}, "특정 생활권에서 수유실 검색이 반복되면 해당 지역의 편의시설 개선 필요성을, 광폭 유모차 검색이 특정 시설에 집중되면 출입 동선 점검 필요성을 살펴볼 수 있습니다."),
    ]),
  ]));
}

function countBy(arr, key) {
  const counts = {};
  arr.forEach(item => {
    const k = item[key] || "기타";
    counts[k] = (counts[k] || 0) + 1;
  });
  return counts;
}

function renderBarChart(title, data, unit = "") {
  const max = Math.max(1, ...Object.values(data));
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const wrap = el("div", { class: "chart" }, [
    el("h3", {}, title),
  ]);
  if (entries.length === 0) {
    wrap.appendChild(el("p", { class: "muted" }, "데이터 없음"));
    return wrap;
  }
  entries.forEach(([label, val]) => {
    const row = el("div", { class: "bar-row" }, [
      el("span", { class: "bar-label" }, label),
      el("div", { class: "bar-track" }, [
        el("div", { class: "bar-fill", style: `width:${(val / max * 100).toFixed(1)}%` }),
      ]),
      el("span", { class: "bar-value" }, `${val}${unit}`),
    ]);
    wrap.appendChild(row);
  });
  return wrap;
}

function renderKeyMetrics(metrics) {
  return el("div", { class: "metrics" }, metrics.map(m =>
    el("div", { class: "metric" }, [
      el("p", { class: "metric-label" }, m.label),
      el("p", { class: "metric-value" }, String(m.value)),
      el("p", { class: "metric-hint" }, m.hint),
    ])
  ));
}

function clickThroughRate(log) {
  const searches = log.filter(l => l.type === "search").length;
  const clicks = log.filter(l => l.type === "click" || l.type === "ask-click").length;
  if (searches === 0) return "0%";
  return Math.min(100, Math.round(clicks / searches * 100)) + "%";
}

function renderRecentEvents(events) {
  const wrap = el("div", { class: "chart" }, [el("h3", {}, "최근 이벤트 (최신 20건)")]);
  const table = el("table", { class: "events-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "시간"),
      el("th", {}, "유형"),
      el("th", {}, "요약"),
    ])),
  ]);
  const tbody = el("tbody");
  events.forEach(e => {
    const t = new Date(e.ts).toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit", month: "2-digit", day: "2-digit" });
    let summary = "";
    if (e.type === "search") summary = `${e.district} / ${e.ageBucket}${e.needNursing ? " / 수유실" : ""}${e.needTwinStroller ? " / 쌍둥이유모차" : ""}`;
    else if (e.type === "ask") summary = `카테고리: ${e.category}`;
    else if (e.type === "click") summary = `시설#${e.facilityId} (${e.district})`;
    else if (e.type === "ask-click") summary = `공식링크 클릭 (${e.category})`;
    tbody.appendChild(el("tr", {}, [
      el("td", {}, t),
      el("td", {}, e.type),
      el("td", {}, summary),
    ]));
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function clearLog() {
  if (!confirm("수집된 이벤트 로그를 모두 삭제할까요? (브라우저 로컬에만 저장된 시연용 데이터입니다)")) return;
  localStorage.removeItem(LOG_KEY);
  renderDashboard();
}

function seedDemoData() {
  // 시연용: 그럴듯한 분포의 가상 이벤트 60건 생성
  const districts = ["도담동", "아름동", "고운동", "새롬동", "보람동", "다정동", "반곡동"];
  const ages = ["0~6개월", "7~12개월", "13~24개월", "25~36개월"];
  const categories = ["외출", "보육", "건강", "예방접종", "프로그램", "발달"];
  const weights = { "도담동": 12, "아름동": 9, "고운동": 11, "새롬동": 8, "보람동": 6, "다정동": 7, "반곡동": 7 };
  const log = loadLog();
  for (let i = 0; i < 50; i++) {
    const d = weightedPick(districts, weights);
    log.push({
      type: "search",
      district: d,
      ageBucket: ages[Math.floor(Math.random() * ages.length)],
      weather: ["rain", "heat", null, null, "dust"][Math.floor(Math.random() * 5)],
      needNursing: Math.random() < (d === "도담동" || d === "고운동" ? 0.6 : 0.3),
      needTwinStroller: Math.random() < 0.2,
      ts: Date.now() - Math.random() * 1000 * 60 * 60 * 24 * 30,
    });
  }
  for (let i = 0; i < 30; i++) {
    log.push({
      type: "ask",
      category: categories[Math.floor(Math.random() * categories.length)],
      length: 20 + Math.floor(Math.random() * 30),
      ts: Date.now() - Math.random() * 1000 * 60 * 60 * 24 * 30,
    });
  }
  for (let i = 0; i < 25; i++) {
    log.push({
      type: "click",
      facilityId: 1 + Math.floor(Math.random() * 30),
      district: districts[Math.floor(Math.random() * districts.length)],
      ts: Date.now() - Math.random() * 1000 * 60 * 60 * 24 * 30,
    });
  }
  localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-1000)));
  renderDashboard();
}

function weightedPick(items, weights) {
  const total = items.reduce((s, i) => s + (weights[i] || 1), 0);
  let r = Math.random() * total;
  for (const i of items) {
    r -= (weights[i] || 1);
    if (r <= 0) return i;
  }
  return items[0];
}

// ============================================================
// 5. 초기화
// ============================================================

function init() {
  initTabs();

  // 외출 추천 폼 옵션 채우기
  const dSel = $("#recommend-district");
  DISTRICTS.forEach(d => dSel.appendChild(el("option", { value: d }, d)));

  // 이벤트 바인딩
  $("#recommend-btn").addEventListener("click", runRecommendation);
  $("#ask-btn").addEventListener("click", handleAsk);
  $("#ask-input").addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleAsk();
  });

  // 예시 버튼
  $$(".example-btn").forEach(b => {
    b.addEventListener("click", () => {
      $("#recommend-text").value = b.dataset.example;
    });
  });
  $$(".example-q").forEach(b => {
    b.addEventListener("click", () => {
      $("#ask-input").value = b.dataset.q;
    });
  });

  // 초기 화면 데이터
  $("#total-facilities").textContent = String(FACILITIES.length);
  $("#total-managed").textContent = String(FACILITIES.filter(f => f.managed).length);
  $("#total-districts").textContent = String(DISTRICTS.length);
}

document.addEventListener("DOMContentLoaded", init);
