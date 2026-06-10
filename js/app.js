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
// 0-1. 자동 환경 판단 (날씨 · 미세먼지) — Open-Meteo (API 키 불필요)
// ============================================================

const SEJONG_COORDS = { lat: 36.4801, lon: 127.2890 }; // 세종시 중심부

// 실시간 자동 환경 상태 (전역)
const AUTO_ENV = {
  loaded: false, ok: false,
  weather: null,   // "rain" | "heat" | "cold" | null(쾌적)
  dustBad: false,  // 미세먼지 나쁨 이상 여부
  temp: null, pm25: null, pm10: null, dustGrade: 0,
  wlabel: "정보 없음",
  summary: "실시간 정보를 불러오는 중…",
};

// Open-Meteo weather_code 중 강수/강설 코드
const RAIN_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
const SNOW_CODES = [71, 73, 75, 77, 85, 86];
const DUST_LABELS = ["좋음", "보통", "나쁨", "매우 나쁨"];

// 한국 환경부 기준 미세먼지 등급(0:좋음 ~ 3:매우나쁨), 둘 중 나쁜 값 채택
function classifyDust(pm25, pm10) {
  const g25 = pm25 == null ? 0 : pm25 <= 15 ? 0 : pm25 <= 35 ? 1 : pm25 <= 75 ? 2 : 3;
  const g10 = pm10 == null ? 0 : pm10 <= 30 ? 0 : pm10 <= 80 ? 1 : pm10 <= 150 ? 2 : 3;
  return Math.max(g25, g10);
}

async function fetchAutoEnv() {
  const banner = document.querySelector("#weather-banner");
  if (banner) banner.classList.add("loading");
  try {
    const fcUrl = `https://api.open-meteo.com/v1/forecast?latitude=${SEJONG_COORDS.lat}&longitude=${SEJONG_COORDS.lon}&current=temperature_2m,precipitation,weather_code&timezone=Asia%2FSeoul`;
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${SEJONG_COORDS.lat}&longitude=${SEJONG_COORDS.lon}&current=pm10,pm2_5&timezone=Asia%2FSeoul`;
    // 응답이 느릴 경우 6초 후 중단 (화면이 멈추지 않도록)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const [fcRes, aqRes] = await Promise.all([
      fetch(fcUrl, { signal: ctrl.signal }),
      fetch(aqUrl, { signal: ctrl.signal }),
    ]);
    clearTimeout(timer);
    const fc = await fcRes.json();
    const aq = await aqRes.json();

    const temp = fc.current.temperature_2m;
    const precip = fc.current.precipitation;
    const code = fc.current.weather_code;
    const pm25 = aq.current.pm2_5;
    const pm10 = aq.current.pm10;

    let weather = null, wlabel = "맑음·쾌적";
    if (precip > 0 || RAIN_CODES.includes(code)) { weather = "rain"; wlabel = "비"; }
    else if (SNOW_CODES.includes(code)) { weather = "rain"; wlabel = "눈"; }
    else if (temp >= 31) { weather = "heat"; wlabel = "폭염"; }
    else if (temp <= 0) { weather = "cold"; wlabel = "한파"; }

    const dg = classifyDust(pm25, pm10);
    Object.assign(AUTO_ENV, {
      loaded: true, ok: true, weather, dustBad: dg >= 2,
      temp, pm25, pm10, dustGrade: dg, wlabel,
      summary: `${wlabel} · 기온 ${Math.round(temp)}℃ · 미세먼지 ${DUST_LABELS[dg]}`,
    });
  } catch (e) {
    Object.assign(AUTO_ENV, {
      loaded: true, ok: false, weather: null, dustBad: false,
      summary: "날씨 정보를 불러오지 못해 '쾌적' 기준으로 추천합니다.",
    });
  }
  renderWeatherBanner();
  return AUTO_ENV;
}

function envIcon() {
  if (!AUTO_ENV.ok) return "⚠️";
  if (AUTO_ENV.weather === "rain") return "🌧️";
  if (AUTO_ENV.weather === "heat") return "🔥";
  if (AUTO_ENV.weather === "cold") return "❄️";
  if (AUTO_ENV.dustBad) return "😷";
  return "☀️";
}

function renderWeatherBanner() {
  const banner = document.querySelector("#weather-banner");
  if (!banner) return;
  banner.classList.remove("loading", "demo");
  const detail = banner.querySelector(".wb-detail");
  const icon = banner.querySelector(".wb-icon");
  const strongEl = banner.querySelector("strong");
  if (strongEl) strongEl.textContent = "오늘 세종 날씨 · 미세먼지 (자동)";
  if (detail) detail.textContent = AUTO_ENV.summary;
  if (icon) icon.textContent = envIcon();
  banner.classList.toggle("alert", AUTO_ENV.ok && (!!AUTO_ENV.weather || AUTO_ENV.dustBad));
}

// 데모(맑은 날 기준) 동안 배너를 '예시' 상태로 표시 — 추천 결과와 일치시킴
function renderDemoBanner() {
  const banner = document.querySelector("#weather-banner");
  if (!banner) return;
  banner.classList.remove("loading", "alert");
  banner.classList.add("demo");
  const detail = banner.querySelector(".wb-detail");
  const icon = banner.querySelector(".wb-icon");
  const strongEl = banner.querySelector("strong");
  if (icon) icon.textContent = "☀️";
  if (strongEl) strongEl.textContent = "예시 화면 · 맑은 날 기준";
  if (detail) detail.textContent = "맑음 · 미세먼지 좋음 기준의 예시입니다. 실제 날씨로 보려면 ‘새로고침’을 눌러주세요.";
}

// 배너를 실제 날씨 상태로 되돌림 (사용자가 직접 검색/새로고침할 때)
function exitDemoBanner() {
  const banner = document.querySelector("#weather-banner");
  if (banner && banner.classList.contains("demo")) renderWeatherBanner();
}

// ============================================================
// 0-2. 요일 · 시간대 · 운영시간 헬퍼
// ============================================================

const DAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

// daySel: "" (오늘) | "0".."6"
function resolveDay(daySel) {
  const isToday = (daySel === "" || daySel == null);
  const idx = isToday ? new Date().getDay() : parseInt(daySel, 10);
  return { idx, name: DAY_NAMES[idx], isWeekend: idx === 0 || idx === 6, isToday };
}

// 운영시간 문자열 파싱: "09:00-18:00" | "상시" | "휴무"
function parseHoursStr(str) {
  if (!str) return { unknown: true };
  if (str.includes("상시")) return { always: true };
  if (str.includes("휴무")) return { closed: true };
  const m = str.match(/(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})/);
  if (!m) return { unknown: true };
  return { open: (+m[1]) + (+m[2]) / 60, close: (+m[3]) + (+m[4]) / 60 };
}

// 시간대 → 대표 시각(소수 시간)
function slotHour(slot) {
  if (slot === "morning") return 10.5;
  if (slot === "afternoon") return 14.5;
  if (slot === "evening") return 18.5;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

function slotLabel(slot) {
  return { morning: "오전", afternoon: "오후", evening: "저녁" }[slot] || "지금";
}

// ============================================================
// 1. 탭 라우팅
// ============================================================

let demoRecommendDone = false;
let demoAskDone = false;

function activateTab(name) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  $$(".page").forEach(p => p.classList.toggle("active", p.id === name));
  window.scrollTo(0, 0);
  if (name === "dashboard") renderDashboard();

  // 심사위원 데모: 탭을 처음 열면 대표 예시를 자동 표시
  if (name === "recommend" && !demoRecommendDone && !$("#recommend-results").hasChildNodes()) {
    demoRecommendDone = true;
    runRecommendDemo();
  }
  if (name === "ask" && !demoAskDone && !$("#ask-result").hasChildNodes()) {
    demoAskDone = true;
    $("#ask-input").value = "9개월 아기가 38.3도 열이 나는데 언제 병원에 가야 하나요?";
    handleAsk();
  }
}

// 외출 추천 데모 입력값 채우고 실행 (실내·야외가 골고루 보이도록 중립 조건)
function runRecommendDemo() {
  $("#recommend-text").value = "15개월 아이랑 오늘 오후에 갈 만한 곳 추천해줘.";
  $("#recommend-age").value = "15";
  $("#recommend-stroller").value = "regular";
  $("#recommend-time").value = "afternoon";
  // 발표 데모는 '맑은 날·미세먼지 좋음' 기준으로 고정해 항상 실내+야외가 함께 노출되도록
  runRecommendation({ ok: true, weather: null, dustBad: false });
  // 배너도 '맑은 날 기준 예시'로 맞춰 표시 (추천 결과와 일치)
  renderDemoBanner();
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

  // 날씨 (자연어에 명시되면 자동값보다 우선)
  if (/비\s*오|우천|비\s*와|비가|장마/.test(t)) conditions.weather = "rain";
  else if (/폭염|더위|뜨거|한낮|무더/.test(t)) conditions.weather = "heat";
  else if (/추위|영하|한파|눈\s*오|눈\s*와/.test(t)) conditions.weather = "cold";

  // 미세먼지 (날씨와 별도 플래그)
  if (/미세먼지|황사|초미세/.test(t)) conditions.dustBad = true;

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

  // 선택한 요일 기준
  const day = resolveDay(cond.day);

  // (4) 혼잡도 (max 10) - 선택 요일 기준
  let crowd = day.isWeekend ? facility.crowdedness.weekend : facility.crowdedness.weekday;
  if (crowd === "n/a") crowd = "mid";
  if (crowd === "low") { score += 10; reasons.push({ type: "ok", text: `${day.name} 비교적 한산` }); }
  else if (crowd === "mid") { score += 6; }
  else if (crowd === "high") { score += 2; reasons.push({ type: "info", text: `${day.name}·시간대에 따라 혼잡 가능` }); }

  // (5) 비용 (max 5)
  if (facility.cost.free) { score += 5; reasons.push({ type: "ok", text: "무료" }); }
  if (cond.costPref === "free" && !facility.cost.free) {
    hardFail = true;
    reasons.push({ type: "warn", text: "유료 시설 (무료만 원함)" });
  }

  // (6) 운영시간 (max 10) - 선택 요일 휴관 + 시간대 운영 여부
  const closedThatDay = facility.closedDays.some(d => d.includes(day.name));
  const hoursStr = day.isWeekend ? facility.hours.weekend : facility.hours.weekday;
  const ph = parseHoursStr(hoursStr);
  if (closedThatDay || ph.closed) {
    hardFail = true;
    reasons.push({ type: "warn", text: `${day.name} 휴관` });
  } else if (ph.always) {
    score += 10;
    reasons.push({ type: "ok", text: "상시 개방" });
  } else if (ph.unknown) {
    score += 6;
  } else {
    const reqH = slotHour(cond.timeSlot);
    if (reqH < ph.open || reqH >= ph.close) {
      hardFail = true;
      reasons.push({ type: "warn", text: `${slotLabel(cond.timeSlot)}에는 운영시간(${hoursStr}) 밖` });
    } else {
      score += 10;
      reasons.push({ type: "ok", text: `${slotLabel(cond.timeSlot)} 운영 중 (${hoursStr})` });
    }
  }

  // (7) 환경 적합도 (max 15) - 자동 판단된 날씨 + 미세먼지 동시 반영
  const envFactors = [];
  if (cond.weather) envFactors.push({ key: cond.weather, label: weatherLabel(cond.weather) });
  if (cond.dustBad) envFactors.push({ key: "dust", label: "미세먼지 나쁨" });
  if (envFactors.length > 0) {
    // 가장 불리한 적합도를 기준으로 평가
    let worst = "good";
    envFactors.forEach(f => {
      const a = facility.weatherAdapt[f.key] || "good";
      if (a === "poor") worst = "poor";
      else if (a === "fair" && worst !== "poor") worst = "fair";
    });
    const labels = envFactors.map(f => f.label).join("·");
    if (worst === "good") { score += 15; reasons.push({ type: "ok", text: `${labels} 상황에도 적합 (실내·쾌적)` }); }
    else if (worst === "fair") { score += 8; reasons.push({ type: "info", text: `${labels} 시 일부만 적합` }); }
    else { reasons.push({ type: "warn", text: `${labels} 시 비추천 (야외)` }); }
  } else {
    score += 12; // 쾌적한 날
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
function runRecommendation(envOverride) {
  // 데모는 '맑은 날 기준' 등 환경을 강제할 수 있음. 일반 검색은 실시간 자동 환경(AUTO_ENV) 사용
  const env = envOverride || AUTO_ENV;
  const text = $("#recommend-text").value;
  const ageInput = $("#recommend-age").value;
  const districtInput = $("#recommend-district").value;
  const strollerInput = $("#recommend-stroller").value;
  const daySel = $("#recommend-day").value;
  const timeSel = $("#recommend-time").value;
  const costSel = $("#recommend-cost").value;
  const needNursing = $("#recommend-nursing").checked;
  const needDiaper = $("#recommend-diaper").checked;
  const preferIndoor = $("#recommend-indoor").checked;

  // 1) 자연어 텍스트 우선 파싱
  const parsed = parseFreeText(text);
  // 2) 폼 입력값 + 자동 환경(날씨·미세먼지)으로 종합
  const cond = {
    ...parsed,
    ageMonths: ageInput ? parseInt(ageInput, 10) : parsed.ageMonths,
    district: districtInput || parsed.district,
    stroller: strollerInput || parsed.stroller,
    // 날씨·미세먼지: 자연어에 명시 없으면 자동 판단값 사용
    weather: parsed.weather || env.weather || null,
    dustBad: parsed.dustBad || env.dustBad || false,
    weatherAuto: !parsed.weather && !!env.weather,
    dustAuto: !parsed.dustBad && env.dustBad,
    day: daySel,
    timeSlot: timeSel,
    costPref: costSel,
    needNursing: needNursing || parsed.needNursing,
    needDiaper: needDiaper || parsed.needDiaper,
    preferIndoor: preferIndoor ? true : parsed.preferIndoor,
  };

  // 로깅 (비식별)
  pushLog({
    type: "search",
    district: cond.district || "전체",
    ageBucket: bucketAge(cond.ageMonths),
    weather: cond.weather || null,
    dustBad: !!cond.dustBad,
    day: resolveDay(cond.day).name,
    timeSlot: slotLabel(cond.timeSlot),
    costPref: cond.costPref || "any",
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

  // 카테고리 다양화: 같은 유형 중복 방지 (복합커뮤니티센터는 1곳까지만) + 야외 보장
  const top = diversify(pass, 3, cond);
  renderRecommendResults(top, alt.slice(0, 4), cond);
}

// 오늘 야외 활동이 적합한가 (실내 선호·우천·폭염·미세먼지 나쁨이 아니면 적합)
function isOutdoorSuitable(cond) {
  if (!cond) return true;
  if (cond.preferIndoor) return false;
  if (cond.weather === "rain" || cond.weather === "heat") return false;
  if (cond.dustBad) return false;
  return true;
}

// 추천 결과 다양화 — 서로 다른 시설 유형이 골고루 나오도록
function diversify(sortedPass, n, cond) {
  const picked = [];
  const usedCats = new Set();
  // 1차: 점수 높은 순으로 서로 다른 카테고리에서 한 곳씩
  for (const s of sortedPass) {
    if (picked.length >= n) break;
    if (usedCats.has(s.facility.category)) continue;
    picked.push(s);
    usedCats.add(s.facility.category);
  }
  // 2차: 자리가 남으면 채우되 복합커뮤니티센터는 1곳까지만 허용
  if (picked.length < n) {
    for (const s of sortedPass) {
      if (picked.length >= n) break;
      if (picked.includes(s)) continue;
      const compCount = picked.filter(p => p.facility.category === "복합커뮤니티센터").length;
      if (s.facility.category === "복합커뮤니티센터" && compCount >= 1) continue;
      picked.push(s);
    }
  }
  // 3차: 오늘 야외가 적합한데 실내만 뽑혔다면, 한 자리를 가장 점수 높은 야외로 교체
  if (isOutdoorSuitable(cond) && picked.length === n && !picked.some(p => !p.facility.indoor)) {
    const bestOutdoor = sortedPass.find(s => !s.facility.indoor && !picked.includes(s));
    if (bestOutdoor) {
      picked.sort((a, b) => b.score - a.score);
      picked[picked.length - 1] = bestOutdoor; // 가장 낮은 실내 추천을 야외로 교체
    }
  }
  picked.sort((a, b) => b.score - a.score);
  return picked;
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

  // AI가 반영한 조건 (자연어 이해 결과)
  const condItems = buildConditionItems(cond);
  const condGrid = el("dl", { class: "cond-grid" }, condItems.flatMap(([k, v]) => [
    el("dt", {}, k), el("dd", {}, v),
  ]));
  root.appendChild(el("div", { class: "summary" }, [
    el("strong", {}, "AI가 반영한 조건"),
    condGrid,
  ]));

  if (top.length === 0) {
    root.appendChild(el("div", { class: "empty" }, "조건에 정확히 맞는 시설을 찾지 못했습니다. 조건을 일부 완화하여 다시 검색해 보세요."));
  } else {
    root.appendChild(el("h3", { class: "section-title" }, `추천 장소 (${top.length}곳 · 서로 다른 유형)`));
    top.forEach((r, i) => root.appendChild(renderCard(r, i + 1, false, cond)));
  }

  // 야외가 오늘 조건 때문에 빠진 경우 이유 안내
  if (top.length > 0 && !top.some(r => !r.facility.indoor) && !isOutdoorSuitable(cond)) {
    let reason = "오늘 조건상";
    if (cond.preferIndoor) reason = "‘실내 선호’를 선택하셔서";
    else if (cond.weather === "rain") reason = "오늘 비가 와서";
    else if (cond.weather === "heat") reason = "오늘 폭염으로";
    else if (cond.dustBad) reason = "오늘 미세먼지가 나빠서";
    root.appendChild(el("p", { class: "outdoor-note" },
      `🌳 ${reason} 야외(공원·수목원)는 추천에서 제외했습니다. 날씨·미세먼지가 좋은 날에는 야외도 함께 추천됩니다.`));
  }

  // AI가 제외한 후보 (이유 표시) — 단순 검색과 차별화
  if (alt.length > 0) {
    root.appendChild(el("h3", { class: "section-title alt" }, "AI가 제외한 후보 (이유)"));
    root.appendChild(renderExcluded(alt));
  }

  // 안내 문구
  root.appendChild(el("p", {
    class: "disclaimer",
    html: `※ 운영시간·예약·휴관 등 변동 정보는 <b>공식 페이지에서 최종 확인</b>해 주세요. 정보 갱신 기준일: <b>${DATA_UPDATED}</b>`
  }));
}

// AI가 반영한 조건을 라벨/값 목록으로
function buildConditionItems(c) {
  const items = [];
  items.push(["월령", c.ageMonths != null ? `${c.ageMonths}개월` : "미지정"]);
  if (c.district) items.push(["생활권", c.district]);
  items.push(["방문", `${resolveDay(c.day).name} ${slotLabel(c.timeSlot)}`]);
  if (c.stroller) items.push(["이동수단", c.stroller === "twin" ? "쌍둥이/광폭 유모차" : "일반 유모차"]);
  const env = [];
  if (c.weather) env.push(weatherLabel(c.weather) + (c.weatherAuto ? "(자동)" : ""));
  if (c.dustBad) env.push("미세먼지 나쁨" + (c.dustAuto ? "(자동)" : ""));
  items.push(["오늘 환경", env.length ? env.join(", ") : "쾌적"]);
  const pri = [];
  if (c.preferIndoor) pri.push("실내");
  if (c.needNursing) pri.push("수유실");
  if (c.needDiaper) pri.push("기저귀 교환대");
  if (c.costPref === "free") pri.push("무료만");
  if (pri.length) items.push(["우선조건", pri.join(", ")]);
  return items;
}

// 제외된 후보를 이유와 함께 간단히 표시
function renderExcluded(alt) {
  const box = el("div", { class: "excluded" });
  alt.forEach(r => {
    const warn = r.reasons.find(x => x.type === "warn");
    box.appendChild(el("div", { class: "excluded-row" }, [
      el("span", { class: "ex-name" }, r.facility.name),
      el("span", { class: "ex-cat muted" }, r.facility.category),
      el("span", { class: "ex-reason" }, warn ? warn.text : "조건 미충족"),
    ]));
  });
  return box;
}

function conditionsToText(c) {
  const parts = [];
  if (c.ageMonths != null) parts.push(`${c.ageMonths}개월`);
  if (c.district) parts.push(c.district);
  parts.push(`${resolveDay(c.day).name} ${slotLabel(c.timeSlot)}`);
  if (c.stroller === "twin") parts.push("쌍둥이 유모차");
  else if (c.stroller === "regular") parts.push("일반 유모차");
  if (c.weather) parts.push(weatherLabel(c.weather) + (c.weatherAuto ? "(자동)" : ""));
  if (c.dustBad) parts.push("미세먼지 나쁨" + (c.dustAuto ? "(자동)" : ""));
  if (c.preferIndoor === true) parts.push("실내 선호");
  if (c.needNursing) parts.push("수유실 필요");
  if (c.needDiaper) parts.push("기저귀 교환대 필요");
  if (c.costPref === "free") parts.push("무료만");
  return parts.join(" · ");
}

function renderCard(r, rank, isAlt, cond = {}) {
  const f = r.facility;
  const reasonChips = r.reasons.slice(0, 6).map(rs =>
    el("span", { class: `chip ${rs.type}` }, rs.text)
  );
  const ribbon = el("div", { class: "ribbon" }, `${isAlt ? "대체" : "추천"} ${rank}`);
  const badge = f.managed
    ? el("span", { class: "badge managed" }, "세종시 관리")
    : el("span", { class: "badge external" }, "공식 페이지 연결");

  const day = resolveDay(cond.day);
  const hour = day.isWeekend ? f.hours.weekend : f.hours.weekday;
  const score = Math.min(100, Math.round(r.score));

  return el("article", { class: `card ${isAlt ? "alt" : ""}` }, [
    ribbon,
    el("div", { class: "card-head" }, [
      el("h4", {}, f.name),
      badge,
    ]),
    el("p", { class: "muted" }, `${f.category} · ${f.district}`),
    f.highlight ? el("p", { class: "highlight-tag" }, `★ ${f.highlight}`) : null,
    el("div", { class: "score-line" }, [
      el("span", { class: "score-badge" }, `적합도 ${score}점`),
      el("div", { class: "score-track" }, [
        el("div", { class: "score-fill", style: `width:${score}%` }),
      ]),
    ]),
    el("p", { class: "desc" }, f.description),
    el("p", { class: "chips-label" }, "추천 이유"),
    el("div", { class: "chips" }, reasonChips),
    el("dl", { class: "kv" }, [
      el("dt", {}, `${day.name} 운영`), el("dd", {}, `${hour}`),
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
  발달: ["뒤집기", "걷기", "말", "옹알이", "발달", "성장", "기기", "앉기", "기지 않", "기지않", "기어", "걷지", "서지", "뒤집지", "말이 늦", "말을 안", "말이 느"],
  보육: ["어린이집", "보육", "시간제", "돌봄", "원아모집", "입소", "맡길", "맡기"],
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

// 질문에서 월령 추출
function extractAgeMonths(q) {
  const m = q.match(/(\d{1,2})\s*개월/);
  return m ? parseInt(m[1], 10) : null;
}

// 질문 내용에 맞는 위험신호 체크리스트 키 선택
function pickChecklist(cat, q) {
  if (cat === "열") return "열";
  if (cat === "응급") {
    if (/설사|구토|토/.test(q)) return "설사구토";
    if (/발진|두드러기/.test(q)) return "발진";
    return "호흡";
  }
  if (cat === "건강") {
    if (/설사|구토|토/.test(q)) return "설사구토";
    if (/발진|두드러기|아토피/.test(q)) return "발진";
    if (/기침|호흡|쌕쌕|숨/.test(q)) return "호흡";
    return null;
  }
  return null;
}

function urgencyBadge(meta) {
  return el("span", { class: `urgency-badge ${meta.urgency}` }, meta.urgencyLabel);
}

function renderAskSteps(meta) {
  const ol = el("ol", { class: "steps-list" });
  meta.steps.forEach(s => ol.appendChild(el("li", {}, s)));
  return el("div", { class: "ask-steps" }, [
    el("strong", { class: "ask-steps-title" }, "이 질문에 적용된 AI 처리 단계"),
    ol,
  ]);
}

function handleAsk() {
  const q = $("#ask-input").value.trim();
  if (!q) return;
  const cat = classifyQuestion(q);
  const meta = QA_META[cat] || QA_META["기타"];
  const ageM = extractAgeMonths(q);

  pushLog({ type: "ask", category: cat, urgency: meta.urgency, length: q.length });

  const root = $("#ask-result");
  root.innerHTML = "";

  // 1단계) 질문 분석 결과 박스
  const rows = [
    ["월령", ageM != null ? `${ageM}개월` : "질문에 명시 없음"],
    ["주제", meta.topic],
    ["긴급도", meta.urgencyLabel],
    ["AI 처리 원칙", meta.principle],
  ];
  root.appendChild(el("div", { class: "analysis-box" }, [
    el("div", { class: "analysis-head" }, [
      el("strong", {}, "AI 질문 분석 결과"),
      urgencyBadge(meta),
    ]),
    el("p", { class: "analysis-q" }, `“${q}”`),
    el("dl", { class: "analysis-grid" }, rows.flatMap(([k, v]) => [
      el("dt", {}, k), el("dd", {}, v),
    ])),
  ]));

  // 2단계) 처리 단계
  root.appendChild(renderAskSteps(meta));

  // 3단계) 위험신호 체크리스트 (의료성 질문)
  const clKey = pickChecklist(cat, q);
  if (cat === "응급" || cat === "열") {
    root.appendChild(renderEmergencyBlock(clKey, true));
  } else if (clKey) {
    root.appendChild(renderEmergencyBlock(clKey, false));
  }

  // 진단하지 않음 안내 (체크리스트가 없는 발달/건강 질문)
  if (cat === "발달" || (cat === "건강" && !clKey)) {
    root.appendChild(el("div", { class: "warning" }, [
      el("strong", {}, "AI는 진단하지 않습니다"),
      el("p", {}, "아래는 보호자가 참고할 수 있는 공식 정보와 안내이며, 우려가 지속되면 보건소 또는 의료기관 상담을 권장합니다."),
    ]));
  }

  // 공식정보 연결
  const links = OFFICIAL_LINKS[cat] || OFFICIAL_LINKS["외출"];
  root.appendChild(el("h3", { class: "section-title" }, "공식정보 연결"));
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

  // 외출 분류 → 추천 기능 연결
  if (cat === "외출") {
    root.appendChild(el("div", { class: "cta" }, [
      el("p", {}, "오늘 날씨·월령·이동 조건을 반영한 장소 추천은 [외출 추천] 기능이 더 정확합니다."),
      el("button", {
        class: "btn primary",
        onclick: () => {
          $("#recommend-text").value = q;
          activateTab("recommend");
        }
      }, "외출 추천으로 이동 →"),
    ]));
  }

  // 면책
  root.appendChild(el("p", {
    class: "disclaimer",
    html: "※ AI는 진단·처방을 하지 않습니다. 신청·운영·휴관 등 변동 정보와 건강 판단은 <b>공식 페이지·의료기관에서 최종 확인</b>해 주세요."
  }));
}

function renderEmergencyBlock(key, isEmergency = true) {
  const list = EMERGENCY_CHECKLIST[key] || EMERGENCY_CHECKLIST["호흡"];
  const titleMap = { 열: "발열 위험신호", 호흡: "호흡 관련 위험신호", 설사구토: "설사·구토 위험신호", 발진: "발진 위험신호" };
  return el("div", { class: `warning ${isEmergency ? "emergency" : ""}` }, [
    el("strong", {}, `🚨 먼저 확인할 위험신호 — ${titleMap[key] || "위험신호"}`),
    el("p", {}, "다음 중 하나라도 해당되면 즉시 119 또는 가까운 의료기관에 연락하세요."),
    el("ul", { class: "checklist" }, list.map(item => el("li", {}, item))),
    el("p", { class: "emergency-call" }, [
      el("a", { href: "tel:119", class: "btn danger" }, "119 신고"),
      el("a", { href: "https://www.e-gen.or.kr/", target: "_blank", rel: "noopener", class: "btn secondary" }, "응급실·야간진료 찾기"),
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

  // 0) 조기 수요 신호 요약 (그래서 공무원이 무엇을 보는가)
  root.appendChild(renderSignals(log));

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

// 조기 수요 신호 요약 — "그래서 행정이 무엇을 봐야 하는가"
function renderSignals(log) {
  const searches = log.filter(l => l.type === "search");
  const asks = log.filter(l => l.type === "ask");
  const signals = [];

  const nurseByD = countBy(searches.filter(s => s.needNursing), "district");
  const topNurse = Object.entries(nurseByD).sort((a, b) => b[1] - a[1])[0];
  if (topNurse && topNurse[1] >= 2 && topNurse[0] !== "전체") {
    signals.push(`🍼 ${topNurse[0]} 생활권 — 수유실 검색 ${topNurse[1]}건: 편의시설 개선·확충 우선지역 검토`);
  }

  const twinByD = countBy(searches.filter(s => s.needTwinStroller), "district");
  const topTwin = Object.entries(twinByD).sort((a, b) => b[1] - a[1])[0];
  if (topTwin && topTwin[1] >= 1 && topTwin[0] !== "전체") {
    signals.push(`♿ ${topTwin[0]} 생활권 — 광폭/쌍둥이 유모차 검색 ${topTwin[1]}건: 출입 동선·경사로 점검`);
  }

  const careAsk = asks.filter(a => a.category === "보육").length;
  if (careAsk >= 1) {
    signals.push(`🕑 시간제보육 관련 질문 ${careAsk}건: 돌봄 공백 생활권 파악 및 안내 보강`);
  }

  const urgentAsk = asks.filter(a => a.urgency === "high" || a.urgency === "caution").length;
  if (urgentAsk >= 1) {
    signals.push(`🏥 건강·발달 등 주의 필요 질문 ${urgentAsk}건: 보건소 연계 안내 강화`);
  }

  const card = el("div", { class: "signal-card" }, [
    el("strong", { class: "signal-title" }, "이번 기간 조기 수요 신호"),
  ]);

  if (signals.length === 0) {
    card.appendChild(el("p", { class: "muted" }, "아직 신호로 집계할 데이터가 부족합니다. 검색·질문이 누적되면 자동으로 표시됩니다."));
    return card;
  }

  const ul = el("ul", { class: "signal-list" });
  signals.forEach(s => ul.appendChild(el("li", {}, s)));
  card.appendChild(ul);
  card.appendChild(el("div", { class: "signal-actions" }, [
    el("strong", {}, "행정 활용"),
    el("p", {}, "시설 개선 검토 · 프로그램 홍보 보완 · 담당부서 현장 확인 요청 (단독 정책근거가 아닌 보조 신호)"),
  ]));
  return card;
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
  $("#recommend-btn").addEventListener("click", () => { exitDemoBanner(); runRecommendation(); });
  $("#ask-btn").addEventListener("click", handleAsk);

  // 자동 날씨·미세먼지 조회 + 새로고침 버튼
  fetchAutoEnv();
  const wRefresh = $("#weather-refresh");
  if (wRefresh) wRefresh.addEventListener("click", fetchAutoEnv);
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

  // 심사위원 데모: 대시보드가 비어 보이지 않도록 최초 1회 샘플 통계 시드
  if (loadLog().length === 0) seedDemoData();
}

document.addEventListener("DOMContentLoaded", init);
