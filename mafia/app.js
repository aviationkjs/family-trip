// 야식 도둑 마피아 실시간판 - 화면과 Firebase 연결
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, setPersistence, browserSessionPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDatabase, ref, onValue, update, set, get, remove, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDfnUSs5944iJJ7f-jPgpQ7DC6q1uN5CvU",
  authDomain: "nsn-search-d578c.firebaseapp.com",
  databaseURL: "https://nsn-search-d578c-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "nsn-search-d578c",
  storageBucket: "nsn-search-d578c.firebasestorage.app",
  messagingSenderId: "22061781213",
  appId: "1:22061781213:web:314bc177f8c41566254b34"
};

const C = window.MafiaCore;
const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getDatabase(fb);
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const app = $("app");

let D = null, uid = null, code = null, offset = 0;
let S = {}; // 구독한 데이터: meta, players, public, votes, me(secret), my(private), secretAll, actions, privateAll
let presenceRef = null;
let subs = {}, lastStatusKey = "", refTimer = 0, busy = false, voice = false;

// ---------- 공통 ----------
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const batchim = (w) => { const c = String(w).charCodeAt(String(w).length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0; };
const iga = (w) => w + (batchim(w) ? "이" : "가");
const now = () => Date.now() + offset;
const RTAG = { thief: "t", detective: "d", smeller: "s", citizen: "c" };
function toast(t) { const el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 1800); }
function buzz() { try { navigator.vibrate && navigator.vibrate(120); } catch (e) {} }
function speak(t) { if (!voice || !("speechSynthesis" in window)) return; try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = "ko-KR"; speechSynthesis.speak(u); } catch (e) {} }
const roomPath = (p) => "rooms/" + code + (p ? "/" + p : "");
function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function load(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }

// ---------- 시작 ----------
async function boot() {
  try { D = await fetch("../scenarios.json", { cache: "no-cache" }).then((r) => r.json()); }
  catch (e) { app.innerHTML = '<section class="card"><h2>상황 데이터를 못 불러왔어요</h2><p>scenarios.json 형식이 깨졌을 수 있어요. 쉼표를 확인해 주세요.</p></section>'; return; }
  await setPersistence(auth, params.has("tab") ? browserSessionPersistence : browserLocalPersistence);
  onAuthStateChanged(auth, (u) => { if (u) { uid = u.uid; afterLogin(); } });
  try { await signInAnonymously(auth); } catch (e) { app.innerHTML = '<section class="card"><h2>로그인 실패</h2><p>' + esc(e.message) + "</p></section>"; }
  onValue(ref(db, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });
}
let loggedIn = false;
function afterLogin() {
  if (loggedIn) return; loggedIn = true;
  const last = load("mafiaRoom");
  const want = params.get("room");
  if (want && /^\d{4}$/.test(want)) return renderHome(want);
  if (last) return tryRejoin(last);
  renderHome("");
}
async function tryRejoin(c) {
  const p = await get(ref(db, "rooms/" + c + "/players/" + uid)).catch(() => null);
  if (p && p.exists()) { enterRoom(c); } else { save("mafiaRoom", ""); renderHome(""); }
}

// ---------- 첫 화면 ----------
function renderHome(prefill, msg) {
  cleanup();
  $("status").hidden = true;
  app.innerHTML =
    '<h1>야식 도둑 <span>마피아</span></h1><p class="sub">4~8명이 각자 폰으로 하는 실시간 마피아. 진행과 집계는 폰이 알아서 해요.</p>' +
    (msg ? '<p class="warn">' + esc(msg) + "</p>" : "") +
    '<section class="card"><h3>내 이름</h3><input class="text" id="name" maxlength="8" placeholder="예: 민수" value="' + esc(load("mafiaName")) + '" aria-label="내 이름"></section>' +
    '<section class="card"><h3>방장이라면</h3><p class="sub">방을 만들면 링크와 QR이 생겨요.</p><button type="button" class="btn main" id="make">방 만들기</button></section>' +
    '<section class="card"><h3>초대받았다면</h3><input class="code" id="code" inputmode="numeric" maxlength="4" placeholder="0000" aria-label="방 번호" value="' + esc(prefill) + '">' +
    '<button type="button" class="btn main" id="join">입장하기</button></section>' +
    '<section class="card"><h3>규칙 요약</h3><ul class="list">' +
    "<li>역할: 야식 도둑, 탐정, 냄새쟁이(5명 이상), 시민</li>" +
    "<li>밤 1분: 도둑은 먹을 사람을 고르고, 탐정은 한 명을 조사해요. 모두 동시에 자기 폰만 봐요.</li>" +
    "<li>아침 1분: 야식을 도둑맞은 사람은 탈락. 아침 흔적은 대부분 도둑의 직업을 가리켜요.</li>" +
    "<li>토론 2분 뒤 각자 폰으로 투표. 동점이면 재투표 1번, 또 동점이면 추방 없음. 추방된 사람의 역할은 공개돼요.</li>" +
    "<li>도둑을 모두 쫓아내면 시민 팀 승리, 남은 시민 수가 도둑 수와 같아지면 도둑 승리.</li></ul></section>";
  $("make").onclick = async () => { const n = nameVal(); if (!n) return; await createRoom(n); };
  $("join").onclick = async () => { const n = nameVal(); if (!n) return; const c = $("code").value.trim(); if (!/^\d{4}$/.test(c)) return toast("방 번호 네 자리를 넣어 주세요"); await joinRoom(c, n); };
}
function nameVal() { const n = $("name").value.trim(); if (!n) { toast("이름을 먼저 넣어 주세요"); $("name").focus(); return ""; } save("mafiaName", n); return n; }

async function createRoom(name) {
  for (let i = 0; i < 8; i++) {
    const c = String(1000 + Math.floor(Math.random() * 9000));
    const ex = await get(ref(db, "rooms/" + c + "/meta"));
    if (ex.exists()) continue;
    await set(ref(db, "rooms/" + c + "/meta"), { host: uid, status: "lobby", day: 0, round: 1, createdAt: serverTimestamp() });
    return joinRoom(c, name);
  }
  toast("방 번호를 못 만들었어요. 다시 눌러 주세요");
}
async function joinRoom(c, name) {
  const m = await get(ref(db, "rooms/" + c + "/meta")).catch(() => null);
  if (!m || !m.exists()) return renderHome(c, "없는 방 번호예요.");
  const me = await get(ref(db, "rooms/" + c + "/players/" + uid));
  if (!me.exists()) {
    if (m.val().status !== "lobby") return renderHome(c, "이미 시작한 방이에요. 다음 판에 들어와 주세요.");
    const cnt = await get(ref(db, "rooms/" + c + "/players"));
    if (cnt.exists() && Object.keys(cnt.val()).length >= 8) return renderHome(c, "방이 꽉 찼어요 (최대 8명).");
    await set(ref(db, "rooms/" + c + "/players/" + uid), { name: name, joinedAt: serverTimestamp(), online: true });
  } else {
    await update(ref(db, "rooms/" + c + "/players/" + uid), { name: name, online: true });
  }
  enterRoom(c);
}

// ---------- 방 구독 ----------
function cleanup() {
  if (presenceRef) { try { onDisconnect(presenceRef).cancel(); } catch (e) {} presenceRef = null; } // 닫힌 방에 빈 기록이 다시 생기지 않게
  Object.values(subs).forEach((f) => { try { f(); } catch (e) {} });
  subs = {}; S = {}; code = null; lastStatusKey = "";
  clearInterval(refTimer); refTimer = 0;
}
function sub(key, path, fn) {
  if (subs[key]) return;
  subs[key] = onValue(ref(db, path), (s) => { fn(s.val()); }, () => { delete subs[key]; });
}
function unsub(key) { if (subs[key]) { subs[key](); delete subs[key]; } }
function enterRoom(c) {
  cleanup();
  code = c; save("mafiaRoom", c);
  const presence = ref(db, roomPath("players/" + uid + "/online"));
  presenceRef = presence;
  subs.conn = onValue(ref(db, ".info/connected"), (s) => {
    if (s.val() === true) { onDisconnect(presence).set(false); set(presence, true).catch(() => {}); }
  });
  sub("meta", roomPath("meta"), (v) => {
    if (v === null) { save("mafiaRoom", ""); cleanup(); return renderHome("", "방이 닫혔어요."); }
    S.meta = v; render();
  });
  sub("players", roomPath("players"), (v) => { S.players = v || {}; if (!S.players[uid] && S.meta) { save("mafiaRoom", ""); cleanup(); return renderHome("", "방에서 나왔어요."); } render(); });
  sub("public", roomPath("public"), (v) => { S.pub = v || {}; render(); });
  sub("votes", roomPath("votes"), (v) => { S.votes = v || {}; render(); });
  sub("me", roomPath("secret/" + uid), (v) => { S.me = v; render(); });
  sub("my", roomPath("private/" + uid), (v) => { S.my = v || {}; render(); });
  refTimer = setInterval(() => { referee(); paintTimer(); }, 500);
}
function roomObj() { return { meta: S.meta, players: S.players || {}, public: S.pub || {}, votes: S.votes || {}, secret: S.secretAll || {}, actions: S.actions || {}, "private": S.privateAll || {} }; }
const amHost = () => S.meta && S.meta.host === uid;

// ---------- 심판 (방장 폰) ----------
async function referee() {
  if (!S.meta || !S.players || busy) return;
  const room = roomObj();
  const ref0 = C.electReferee(room);
  if (ref0 === uid && S.meta.host !== uid) { busy = true; try { await update(ref(db, roomPath("meta")), { host: uid }); toast("심판을 이어받았어요"); } catch (e) {} busy = false; return; }
  if (!amHost()) { unsub("secretHost"); unsub("actions"); unsub("privateAll"); return; }
  sub("secretHost", roomPath("secret"), (v) => { S.secretAll = v || {}; });
  sub("actions", roomPath("actions"), (v) => { S.actions = v || {}; });
  sub("privateAll", roomPath("private"), (v) => { S.privateAll = v || {}; });
  if (S.meta.status !== "lobby" && S.meta.status !== "end" && !Object.keys(S.secretAll || {}).length) return; // 아직 못 받음
  const up = C.step(room, D, now());
  if (!up) return;
  busy = true;
  try { await update(ref(db, roomPath()), up); } catch (e) { console.warn("referee write", e); }
  busy = false;
}

// ---------- 화면 ----------
const STATUS_NAME = { lobby: "대기실", role: "역할 확인", night: "밤", morning: "아침", talk: "토론", vote: "투표", verdict: "투표 결과", end: "게임 끝" };
const SAY = { role: "모두 역할을 확인하세요.", night: "밤이 되었습니다. 모두 자기 휴대폰만 보세요.", morning: "아침이 밝았습니다.", talk: "토론을 시작합니다. 2분입니다.", vote: "투표 시간입니다.", verdict: "투표 결과를 발표합니다.", end: "게임이 끝났습니다." };
function P(u) { return (S.players || {})[u] || {}; }
function bySeat(s) { const p = S.players || {}; const u = Object.keys(p).find((k) => p[k].seat === s); return u ? p[u] : {}; }
function label(s) { const p = bySeat(s); return s + "번 " + esc(p.name || ""); }
function info(s) { return (((S.pub || {}).scene || {}).info || {})[s] || {}; }
function aliveSeats() { const p = S.players || {}; return Object.keys(p).filter((u) => p[u].seat && p[u].alive === true).map((u) => p[u].seat).sort((a, b) => a - b); }
function setReady() { const key = C.phaseKey(S.meta); return update(ref(db, roomPath("players/" + uid)), { ready: key }); }
function isReady() { return P(uid).ready === C.phaseKey(S.meta); }
function readyCount() { const p = S.players || {}, key = C.phaseKey(S.meta); const al = Object.keys(p).filter((u) => p[u].alive === true); return al.filter((u) => p[u].ready === key).length + "/" + al.length; }

function render() {
  if (!S.meta || !S.players) return;
  const m = S.meta, st = m.status, me = P(uid);
  const sk = st + "-" + m.day + "-" + (m.round || 1);
  if (sk !== lastStatusKey) { if (lastStatusKey) { buzz(); if (amHost()) speak(sayFor(st)); } lastStatusKey = sk; window.scrollTo(0, 0); }
  $("status").hidden = false;
  $("sCode").textContent = code; $("sMe").textContent = (me.seat ? me.seat + "번 " : "") + (me.name || "");
  $("sPhase").textContent = (m.day && st !== "lobby" && st !== "end" && st !== "role" ? m.day + "일째 " : "") + STATUS_NAME[st] + (st === "vote" && m.round === 2 ? " (재투표)" : "");
  const dead = me.seat && me.alive === false;
  if ((dead || st === "end") && !subs.secretAll) sub("secretAll", roomPath("secret"), (v) => { S.spect = v || {}; render(); });
  let html = "";
  if (st === "lobby") html = lobbyView();
  else if (!me.seat) html = '<section class="card"><h2>이번 판은 관전 중</h2><p>판이 이미 시작됐어요. 다음 판에 함께해요.</p></section>';
  else if (st === "role") html = roleView();
  else if (st === "night") html = dead ? spectView("밤") : nightView();
  else if (st === "morning") html = morningView();
  else if (st === "talk") html = talkView();
  else if (st === "vote") html = dead ? spectView("투표") : voteView();
  else if (st === "verdict") html = verdictView();
  else if (st === "end") html = endView();
  if (dead && st !== "end" && st !== "night" && st !== "vote") html += spectView();
  app.innerHTML = html;
  bind();
  paintTimer();
}
function sayFor(st) {
  if (st === "morning") { const r = (((S.pub || {}).days || {})[S.meta.day] || {}).night || {}; return "아침이 밝았습니다. " + (r.victim ? r.victim + "번의 " + iga(info(r.victim).food || "야식") + " 사라졌습니다." : "간밤에는 아무것도 사라지지 않았습니다."); }
  if (st === "verdict") { const v = (((S.pub || {}).days || {})[S.meta.day] || {}).vote || {}; return v.exiled ? v.exiled + "번이 추방되었습니다. 역할은 " + C.RNAME[v.role] + "입니다." : "이번 투표는 추방 없이 넘어갑니다."; }
  if (st === "end") return (S.meta.winner === "town" ? "시민 팀 승리!" : "야식 도둑 승리!");
  return SAY[st] || "";
}
function paintTimer() {
  const el = $("sTime"); if (!el || !S.meta) return;
  const dl = S.meta.deadline;
  if (!dl || S.meta.status === "lobby" || S.meta.status === "end") { el.hidden = true; return; }
  const left = Math.max(0, Math.ceil((dl - now()) / 1000));
  el.hidden = false; el.textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
  el.classList.toggle("low", left <= 10);
  const big = $("bigTimer"); if (big) { big.textContent = el.textContent; big.classList.toggle("low", left <= 10); }
}

// 대기실
function lobbyView() {
  const p = S.players || {}, list = Object.keys(p).sort((a, b) => (p[a].joinedAt || 0) - (p[b].joinedAt || 0));
  const link = location.origin + location.pathname + "?room=" + code;
  const n = list.length, ok = n >= 4 && n <= 8;
  let h = '<section class="card"><h2>대기실 · 방 ' + code + '</h2><div class="share"><div id="qr" class="qr" aria-label="입장 QR 코드"></div><div><p class="sub">QR을 찍거나 링크로 들어와요.</p><p class="link">' + esc(link) + '</p><button type="button" class="btn" id="copy">링크 복사</button></div></div></section>';
  h += '<section class="card"><h3>들어온 사람 ' + n + "명</h3>" + list.map((u, i) => '<div class="seatline"><span>' + (i + 1) + ". " + esc(p[u].name) + (u === S.meta.host ? ' <span class="tag s">방장</span>' : "") + (u === uid ? ' <span class="tag c">나</span>' : "") + "</span><span class=\"sub\">" + (p[u].online === false ? "연결 끊김" : "접속 중") + "</span></div>").join("") + "</section>";
  if (amHost()) {
    h += '<section class="card"><button type="button" class="btn" id="voice" aria-pressed="' + voice + '">' + (voice ? "소리 안내 켜짐" : "소리 안내 켜기 (방장 폰만)") + '</button>' +
      '<button type="button" class="btn main" id="start"' + (ok ? "" : " disabled") + ">" + (ok ? n + "명으로 시작하기" : "4~8명이 모이면 시작할 수 있어요") + "</button></section>";
  } else h += '<section class="card"><p>방장이 시작하기를 기다리는 중이에요.</p></section>';
  h += '<p class="foot"><button type="button" class="linkbtn" id="leave">방 나가기</button></p>';
  return h;
}
// 역할 확인
function holdCard() {
  const r = (S.me || {}).role; if (!r) return '<p class="sub">역할을 받는 중…</p>';
  const partners = ((S.me || {}).partners || []).map((s) => label(s)).join(", ");
  const mission = {
    thief: "밤마다 먹을 사람을 골라요. 낮에는 시치미 떼고, 남은 시민 수가 도둑 수와 같아지면 승리!" + (partners ? " 동료 도둑: " + partners : ""),
    detective: "밤마다 한 명을 골라 도둑인지 확인해요. 밝힐지는 당신이 정해요.",
    smeller: "밤마다 도둑에 대한 냄새 단서를 하나 받아요. 가끔 헷갈리는 단서도 있어요.",
    citizen: "특별한 능력은 없어요. 토론과 투표로 도둑을 모두 쫓아내면 승리!"
  }[r];
  return '<div class="hold ' + (r === "thief" ? "thief" : "town") + '" id="hold" role="button" tabindex="0" aria-label="누르고 있는 동안 내 역할 보기"><p class="cover">꾹 누르고 있는 동안만 보여요</p><div class="reveal"><p class="role">' + C.RNAME[r] + '</p><p class="mission">' + mission + "</p></div></div>";
}
function seatsTable(withRole) {
  const roles = withRole ? (S.pub.final ? S.pub.final.roles : rolesFromSpect()) : null;
  const p = S.players || {};
  return Object.keys(p).filter((u) => p[u].seat).sort((a, b) => p[a].seat - p[b].seat).map((u) => {
    const s = p[u].seat, dead = p[u].alive === false, r = roles && roles[s];
    return '<div class="seatline"><span class="' + (dead ? "dead" : "") + '">' + s + "번 " + esc(p[u].name) + ' <span class="sub">· ' + esc(info(s).trait || "") + "</span></span>" + (r ? '<span class="tag ' + RTAG[r] + '">' + C.RNAME[r] + "</span>" : '<span class="sub">' + esc(info(s).food || "") + "</span>") + "</div>";
  }).join("");
}
function rolesFromSpect() { const o = {}, sp = S.spect || {}; Object.keys(sp).forEach((u) => { const s = P(u).seat; if (s) o[s] = sp[u].role; }); return o; }
function readyBtn(text) { return isReady() ? '<p class="done">완료! 다른 사람을 기다리는 중 (' + readyCount() + ")</p>" : '<button type="button" class="btn main" id="ready">' + text + "</button>"; }
function roleView() {
  const sc = S.pub.scene || {}, me = P(uid), inf = info(me.seat);
  return '<section class="card"><h2>' + esc(sc.place && sc.place.name) + '</h2><p class="say">' + esc(sc.place && sc.place.intro) + "</p>" +
    (sc.situation ? "<p><b>오늘의 상황</b> · " + esc(sc.situation) + "</p>" : "") +
    "<p>나는 <b>" + me.seat + "번</b>, " + esc(inf.trait) + ". 내 야식은 <b>" + esc(inf.food + " " + inf.amount) + "</b>.</p></section>" +
    '<section class="card"><h3>내 역할</h3>' + holdCard() + readyBtn("확인했어요") + "</section>" +
    (sc.event ? '<section class="card"><h3>특별 사건: ' + esc(sc.event.name) + "</h3><p>" + esc(sc.event.text) + "</p></section>" : "") +
    '<section class="card"><h3>모두의 자리</h3>' + seatsTable(false) + "</section>";
}
// 밤
function nightView() {
  const d = S.meta.day, r = (S.me || {}).role, sc = S.pub.scene || {}, my = S.my || {};
  const alive = aliveSeats(), mySeat = P(uid).seat;
  let body = "";
  if (r === "thief") {
    if (sc.lockNight === d) body = '<p class="big">' + (sc.event && sc.event.id === "party" ? "다 같이 야식 파티를 해서 훔칠 게 없다." : "냉장고가 잠겨 있다.") + " 오늘 밤은 쉬어요.</p>" + readyBtn("확인");
    else {
      const partners = (S.me.partners || []).filter((s) => alive.indexOf(s) >= 0);
      const targets = alive.filter((s) => s !== mySeat && partners.indexOf(s) < 0);
      const curPick = getPick(), pp = (my.partnerPick || {})[d] || 0;
      body = "<p>오늘 밤 누구의 야식을 먹을까요?" + (partners.length ? " 동료와 같은 사람을 골라야 해요." : "") + '</p><div class="grid">' +
        targets.map((s) => '<button type="button" class="btn" id="t' + s + '" data-pick="' + s + '" aria-pressed="' + (curPick === s) + '">' + s + "<small>" + esc(bySeat(s).name) + "</small></button>").join("") + "</div>" +
        (partners.length ? '<p class="sub">동료 도둑의 선택: ' + (pp ? label(pp) : "아직") + "</p>" : "") +
        (curPick ? '<p class="done">' + label(curPick) + "의 " + esc(info(curPick).food) + "을(를) 노려요. (" + readyCount() + " 완료)</p>" : "");
    }
  } else if (r === "detective") {
    if (sc.event && sc.event.id === "blackout" && d === 1) body = '<p class="big">정전이라 아무것도 안 보인다.</p><p class="sub">오늘 밤은 조사할 수 없어요.</p>' + readyBtn("확인");
    else {
      const res = (my.checks || {})[d], curPick = getPick();
      body = "<p>도둑인지 확인할 사람을 한 명 고르세요. 한 번만 고를 수 있어요.</p>" + '<div class="grid">' +
        alive.filter((s) => s !== mySeat).map((s) => '<button type="button" class="btn" id="c' + s + '" data-check="' + s + '"' + (curPick ? " disabled" : "") + ' aria-pressed="' + (curPick === s) + '">' + s + "<small>" + esc(bySeat(s).name) + "</small></button>").join("") + "</div>" +
        (curPick ? (res && res.target === curPick ? '<p class="big">' + label(curPick) + "은(는) <span class=\"hl\">" + (res.thief ? "야식 도둑이다!" : "도둑이 아니다.") + "</span></p>" : '<p class="sub">조사 중…</p>') : "");
    }
    const past = Object.keys(my.checks || {}).filter((k) => +k < d);
    if (past.length) body += '<h3>지난 조사</h3><ul class="list">' + past.map((k) => "<li>" + k + "일째: " + label(my.checks[k].target) + " → " + (my.checks[k].thief ? "도둑" : "도둑 아님") + "</li>").join("") + "</ul>";
  } else if (r === "smeller") {
    const clue = (my.smell || {})[d];
    body = '<p class="sub">킁킁… 어디선가 냄새가 난다.</p><p class="big">' + (clue ? esc(clue) : "냄새를 맡는 중…") + "</p>" + (sc.event && sc.event.id === "misdelivery" ? '<p class="sub">이번 판엔 가짜 단서가 하나 섞여 있어요.</p>' : "") + (clue ? readyBtn("확인") : "");
  } else {
    const fakeResult = fakes[C.phaseKey(S.meta)];
    body = "<p>오늘 밤 할 일을 하나 고르세요.</p>" + (isReady() ? '<p class="big">' + esc(fakeResult || "조용한 밤이다.") + '</p><p class="done">완료! (' + readyCount() + ")</p>" :
      '<div class="row">' + D.fakeActions.map((a, i) => '<button type="button" class="btn grow" id="f' + i + '" data-fake="' + i + '">' + esc(a.button) + "</button>").join("") + "</div>");
  }
  return '<section class="card"><h2>' + d + '일째 밤</h2><p class="sub">다른 사람 화면을 보지 마세요. 모두 자기 폰에서 뭔가를 누르고 있어요.</p>' + body + "</section>" +
    '<section class="card"><h3>내 역할 다시 보기</h3>' + holdCard() + "</section>";
}
let picks = {}, fakes = {};
function getPick() { if (!S.meta) return 0; const k = C.phaseKey(S.meta); if (picks[k]) return picks[k]; const c = (((S.my || {}).checks) || {})[S.meta.day]; return c ? c.target : 0; }

// 아침
function morningView() {
  const d = S.meta.day, rec = (((S.pub.days || {})[d]) || {}).night || {}, v = rec.victim, sc = S.pub.scene || {};
  const meV = v && v === P(uid).seat;
  let h = '<section class="card"><h2>' + d + "일째 아침</h2>";
  if (v) {
    const f = info(v);
    h += '<p class="big"><span class="hl">' + label(v) + '</span>의 <span class="hl">' + esc(f.food + " " + f.amount) + "</span>" + (batchim(f.amount) ? "이" : "가") + " 사라졌다.</p>" +
      '<p class="out">' + label(v) + " (" + esc(f.trait) + ")은(는) 배가 고파 탈락." + (meV ? " 바로 당신이에요!" : "") + "</p>";
  } else h += '<p class="big">간밤에는 아무것도 사라지지 않았다.</p>' + (rec.lock ? '<p class="sub">' + (sc.event && sc.event.id === "party" ? "다 같이 야식 파티를 했다." : "냉장고가 잠겨 있었다.") + "</p>" : "");
  if (rec.trace) h += '<h3>아침 흔적</h3><p class="say">' + esc(rec.trace) + "</p>";
  if (rec.cctv) h += '<h3>고장 난 CCTV</h3><p class="say">' + esc(rec.cctv) + "</p>";
  h += (P(uid).alive ? readyBtn("확인했어요") : "") + "</section>";
  h += '<section class="card"><h3>남은 사람</h3>' + aliveSeats().map((s) => '<div class="seatline"><span>' + label(s) + '</span><span class="sub">' + esc(info(s).trait) + "</span></div>").join("") + "</section>";
  return h + logCard();
}
// 토론
function talkView() {
  return '<section class="card"><h2>' + S.meta.day + '일째 토론</h2><p class="timer" id="bigTimer"></p><p class="sub center">누가 야식을 먹었을까요? 탈락한 사람은 말하지 않아요.</p>' +
    (P(uid).alive ? readyBtn("토론 끝내기 (모두 누르면 바로 투표)") : "") + "</section>" +
    '<section class="card"><h3>남은 사람</h3>' + aliveSeats().map((s) => '<div class="seatline"><span>' + label(s) + '</span><span class="sub">' + esc(info(s).trait) + "</span></div>").join("") + "</section>" +
    (P(uid).alive ? '<section class="card"><h3>내 역할 다시 보기</h3>' + holdCard() + "</section>" : "") + logCard();
}
// 투표
function voteView() {
  const m = S.meta, d = m.day, r = m.round || 1, votes = (((S.votes || {})[d]) || {})[r] || {}, mine = votes[uid];
  const cand = (m.candidates || aliveSeats()).filter((s) => s !== P(uid).seat);
  const done = Object.keys(votes).length, total = aliveSeats().length;
  return '<section class="card"><h2>' + d + "일째 투표" + (r === 2 ? " · 재투표" : "") + "</h2>" +
    (r === 2 ? '<p class="out">동점이에요. 동점인 사람만 놓고 다시 투표해요. 또 동점이면 추방 없이 넘어가요.</p>' : "<p>도둑이라고 생각하는 사람을 골라요. 시간 안에는 바꿀 수 있어요.</p>") +
    '<div class="grid">' + cand.map((s) => '<button type="button" class="btn" id="v' + s + '" data-vote="' + s + '" aria-pressed="' + (mine === s) + '">' + s + "<small>" + esc(bySeat(s).name) + "</small></button>").join("") + "</div>" +
    '<button type="button" class="btn" id="v0" data-vote="0" aria-pressed="' + (mine === 0) + '">기권</button>' +
    '<p class="sub">투표한 사람 ' + done + "/" + total + "</p></section>";
}
// 투표 결과
function voteTable(d) {
  const byRound = ((S.votes || {})[d]) || {};
  return Object.keys(byRound).sort().map((r) => {
    const v = byRound[r];
    return "<h3>" + (r === "2" ? "재투표" : "투표") + '</h3><div class="votes">' + Object.keys(v).map((u) => '<div class="seatline"><span>' + P(u).seat + "번 " + esc(P(u).name) + '</span><span>→ ' + (v[u] ? label(v[u]) : "기권") + "</span></div>").join("") + "</div>";
  }).join("");
}
function verdictView() {
  const d = S.meta.day, rec = (((S.pub.days || {})[d]) || {}).vote || {};
  let h = '<section class="card"><h2>' + d + "일째 투표 결과</h2>";
  if (rec.exiled) h += '<p class="big"><span class="hl">' + label(rec.exiled) + '</span> 추방!</p><p class="big">역할은 <span class="' + (rec.role === "thief" ? "out" : "ok") + '">' + C.RNAME[rec.role] + "</span>" + (batchim(C.RNAME[rec.role]) ? "이었어요." : "였어요.") + "</p>";
  else h += '<p class="big">' + (rec.tie ? "또 동점! 이번엔 추방 없이 넘어가요." : "아무도 추방되지 않았어요.") + "</p>";
  h += voteTable(d) + (P(uid).alive ? readyBtn("확인했어요") : "") + "</section>";
  return h + logCard();
}
// 끝
function endView() {
  const f = S.pub.final || {}, w = f.winner || S.meta.winner;
  let h = '<section class="card"><p class="winner ' + (w === "town" ? "c" : "t") + '">' + (w === "town" ? "시민 팀 승리!" : "야식 도둑 승리!") + '</p><p class="center">' + (w === "town" ? "야식 도둑을 모두 잡았어요." : "남은 시민 수가 도둑 수와 같아졌어요.") + "</p></section>";
  h += '<section class="card"><h3>모든 역할</h3>' + seatsTable(true) + "</section>" + logCard();
  if (amHost()) h += '<section class="card"><button type="button" class="btn main" id="again">같은 사람끼리 한 판 더</button><button type="button" class="btn" id="close">방 닫기</button></section>';
  else h += '<section class="card"><p>방장이 한 판 더를 누르면 자동으로 대기실로 돌아가요.</p></section>';
  return h + '<p class="foot"><button type="button" class="linkbtn" id="leave">방 나가기</button></p>';
}
function spectView(what) {
  return '<section class="card spect"><h2>탈락했어요' + (what ? " · " + what + " 진행 중" : "") + '</h2><p class="sub">이제 모든 역할이 보여요. 남은 사람들에게 알려주면 안 돼요.</p>' + seatsTable(true) + "</section>";
}
function logCard() {
  const days = (S.pub || {}).days || {}, ks = Object.keys(days).map(Number).sort((a, b) => a - b);
  if (!ks.length) return "";
  const li = [];
  ks.forEach((d) => {
    const n = days[d].night, v = days[d].vote;
    if (n) li.push("<li>" + d + "일째 밤: " + (n.victim ? label(n.victim) + "의 " + esc(info(n.victim).food) + " 실종, 탈락" : "아무것도 사라지지 않음") + "</li>");
    if (v) li.push("<li>" + d + "일째 투표: " + (v.exiled ? label(v.exiled) + " 추방 (" + C.RNAME[v.role] + ")" : "추방 없음") + "</li>");
  });
  return '<section class="card"><h3>지금까지</h3><ul class="list">' + li.join("") + "</ul></section>";
}

// ---------- 버튼 ----------
function bind() {
  const h = $("hold");
  if (h) {
    const show = (v) => h.classList.toggle("show", v);
    h.addEventListener("pointerdown", (e) => { e.preventDefault(); try { h.setPointerCapture(e.pointerId); } catch (x) {} show(true); });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => h.addEventListener(t, () => show(false)));
    h.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); show(true); } });
    h.addEventListener("keyup", () => show(false));
    h.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  const qr = $("qr");
  if (qr && window.QRCode) { qr.innerHTML = ""; try { new QRCode(qr, { text: location.origin + location.pathname + "?room=" + code, width: 132, height: 132 }); } catch (e) {} }
}
app.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b || !code || !S.meta) return;
  const d = S.meta.day;
  if (b.id === "ready") return setReady();
  if (b.id === "copy") { try { await navigator.clipboard.writeText(location.origin + location.pathname + "?room=" + code); toast("링크를 복사했어요"); } catch (x) { toast("복사가 안 돼요. 링크를 길게 눌러 복사해 주세요"); } return; }
  if (b.id === "voice") { voice = !voice; if (voice) speak("소리 안내를 켰습니다."); render(); return; }
  if (b.id === "start") { const room = roomObj(); if (!C.canStart(room)) return; const up = C.startGame(room, D, now()); await update(ref(db, roomPath()), up); return; }
  if (b.id === "again") { await update(ref(db, roomPath()), C.resetRoom(roomObj())); return; }
  if (b.id === "close") { if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "한 번 더 누르면 방이 사라져요"; return; } await remove(ref(db, roomPath())); return; }
  if (b.id === "leave") {
    if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "한 번 더 누르면 나가요"; return; }
    if (S.meta.status === "lobby") await remove(ref(db, roomPath("players/" + uid))).catch(() => {});
    save("mafiaRoom", ""); cleanup(); return renderHome("");
  }
  const pk = C.phaseKey(S.meta);
  if (b.dataset.pick) { picks[pk] = +b.dataset.pick; render(); await set(ref(db, roomPath("actions/" + d + "/" + uid)), { target: picks[pk] }); await setReady(); return; }
  if (b.dataset.check) { if (getPick()) return; picks[pk] = +b.dataset.check; render(); await set(ref(db, roomPath("actions/" + d + "/" + uid)), { target: picks[pk] }); await setReady(); return; }
  if (b.dataset.fake) { fakes[pk] = D.fakeActions[+b.dataset.fake].result; await setReady(); render(); return; }
  if (b.dataset.vote !== undefined) { await set(ref(db, roomPath("votes/" + d + "/" + (S.meta.round || 1) + "/" + uid)), +b.dataset.vote); return; }
});

boot();
