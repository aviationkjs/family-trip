/* 야식 도둑 마피아 실시간판 - 규칙 계산 (화면·서버와 무관한 순수 함수)
   심판 폰이 step()을 돌려 나온 변경분을 rooms/{방번호}에 그대로 쓴다. */
(function (root) {
  "use strict";
  var ROLES = { 4: [1, 1, 0, 2], 5: [1, 1, 1, 2], 6: [1, 1, 1, 3], 7: [2, 1, 1, 3], 8: [2, 1, 1, 4] }; // 도둑, 탐정, 냄새쟁이, 시민
  var SEC = { role: 90, night: 60, morning: 60, talk: 120, vote: 30, verdict: 20 };
  var RNAME = { thief: "야식 도둑", detective: "탐정", smeller: "냄새쟁이", citizen: "시민" };

  var rnd = Math.random;
  function setRandom(fn) { rnd = fn; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // ---------- 방 상태 읽기 도우미 ----------
  function phaseKey(m) { return (m.status || "") + "-" + (m.day || 0) + "-" + (m.round || 1); }
  function players(room) { return room.players || {}; }
  function seated(room) { var p = players(room); return Object.keys(p).filter(function (u) { return p[u].seat; }); }
  function aliveUids(room) { var p = players(room); return seated(room).filter(function (u) { return p[u].alive === true; }); }
  function uidOfSeat(room, s) { var p = players(room); return Object.keys(p).filter(function (u) { return p[u].seat === s; })[0]; }
  function seatOf(room, u) { return (players(room)[u] || {}).seat; }
  function roleOf(room, u) { return ((room.secret || {})[u] || {}).role; }
  function roleOfSeat(room, s) { return roleOf(room, uidOfSeat(room, s)); }
  function scene(room) { return ((room.public || {}).scene) || {}; }
  function normTraits(D) { return (D.traits || []).map(function (t) { return typeof t === "string" ? { name: t, clue: "" } : t; }); }

  function judge(room, aliveList) {
    var t = aliveList.filter(function (u) { return roleOf(room, u) === "thief"; }).length, c = aliveList.length - t;
    if (t === 0) return "town";
    if (t >= c) return "thief";
    return "";
  }

  // ---------- 단서 ----------
  function fill(tpl, o) { return String(tpl).replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); }
  function smellClue(room, D, d, aliveList) {
    var sc = scene(room), n = sc.n, smellerSeat = aliveList.map(function (u) { return seatOf(room, u); }).filter(function (s) { return roleOfSeat(room, s) === "smeller"; })[0];
    var aliveSeats = aliveList.map(function (u) { return seatOf(room, u); });
    var thieves = aliveSeats.filter(function (s) { return roleOfSeat(room, s) === "thief"; });
    var t = pick(thieves), who = thieves.length > 1 ? "도둑 중 한 명은" : "도둑은";
    var innocents = aliveSeats.filter(function (s) { return roleOfSeat(room, s) !== "thief" && s !== smellerSeat; });
    var T = D.smell;
    if (sc.fakeNight === d) {
      if (innocents.length >= 2) { var two = shuffle(innocents).slice(0, 2).sort(function (a, b) { return a - b; }); return fill(T.pair, { who: who, a: two[0], b: two[1] }); }
      return fill(T.notThief, { a: t });
    }
    var type = pick(["parity", "pair", "notThief", "neighbor"]);
    if (type === "parity") return fill(T.parity, { who: who, p: t % 2 ? "홀수" : "짝수" });
    if (type === "pair" && innocents.length) { var o = pick(innocents), pr = [t, o].sort(function (a, b) { return a - b; }); return fill(T.pair, { who: who, a: pr[0], b: pr[1] }); }
    if (type === "notThief" && innocents.length) return fill(T.notThief, { a: pick(innocents) });
    return fill(T.neighbor, { who: who, a: pick([t === 1 ? n : t - 1, t === n ? 1 : t + 1]) });
  }
  function traceOf(room, D, aliveList) {
    var sc = scene(room), seats = aliveList.map(function (u) { return seatOf(room, u); });
    var thieves = seats.filter(function (s) { return roleOfSeat(room, s) === "thief"; }), others = seats.filter(function (s) { return roleOfSeat(room, s) !== "thief"; });
    var truth = typeof D.traceTruth === "number" ? D.traceTruth : 0.7;
    var src = (rnd() < truth || !others.length) ? pick(thieves) : pick(others);
    var c = ((sc.info || {})[src] || {}).clue;
    return c || (D.morningLines && D.morningLines.length ? pick(D.morningLines) : "");
  }
  function cctvClue(room, D, aliveList) {
    var sc = scene(room), seats = aliveList.map(function (u) { return seatOf(room, u); });
    var thieves = seats.filter(function (s) { return roleOfSeat(room, s) === "thief"; }), t = pick(thieves), who = thieves.length > 1 ? "도둑 중 한 명은" : "도둑은";
    if (rnd() < 0.5) return "CCTV 속 그림자: " + fill(D.smell.parity, { who: who, p: t % 2 ? "홀수" : "짝수" });
    return "CCTV 속 그림자: " + fill(D.smell.neighbor, { who: who, a: pick([t === 1 ? sc.n : t - 1, t === sc.n ? 1 : t + 1]) });
  }

  // ---------- 판 시작 ----------
  function canStart(room) {
    var n = Object.keys(players(room)).length;
    return n >= 4 && n <= 8 && (room.meta || {}).status === "lobby";
  }
  function startGame(room, D, now) {
    var p = players(room), order = Object.keys(p).sort(function (a, b) { return (p[a].joinedAt || 0) - (p[b].joinedAt || 0); });
    var n = order.length, up = {}, cnt = ROLES[n];
    if (!cnt) return null;
    var roleList = [];
    [["thief", cnt[0]], ["detective", cnt[1]], ["smeller", cnt[2]], ["citizen", cnt[3]]].forEach(function (x) { for (var i = 0; i < x[1]; i++) roleList.push(x[0]); });
    roleList = shuffle(roleList);
    var thiefSeats = [];
    order.forEach(function (u, i) { if (roleList[i] === "thief") thiefSeats.push(i + 1); });
    order.forEach(function (u, i) {
      var s = i + 1;
      up["players/" + u + "/seat"] = s; up["players/" + u + "/alive"] = true; up["players/" + u + "/ready"] = null;
      up["secret/" + u] = { role: roleList[i], partners: roleList[i] === "thief" ? thiefSeats.filter(function (x) { return x !== s; }) : [] };
    });
    // 상황
    var foods = shuffle(D.foods), traits = shuffle(normTraits(D)), info = {};
    for (var s = 1; s <= n; s++) info[s] = { food: foods[(s - 1) % foods.length].name, amount: foods[(s - 1) % foods.length].amount, trait: traits[(s - 1) % traits.length].name, clue: traits[(s - 1) % traits.length].clue || "" };
    var ev = rnd() < (D.eventChance || 0) ? pick(D.events) : null;
    up["public/scene"] = {
      n: n, place: pick(D.places), situation: D.situations && D.situations.length ? pick(D.situations) : "",
      event: ev, info: info,
      lockNight: ev && ev.id === "fridgelock" ? 1 + Math.floor(rnd() * 2) : ev && ev.id === "party" ? 1 : 0,
      fakeNight: ev && ev.id === "misdelivery" ? 1 + Math.floor(rnd() * 3) : 0,
      cctv: !!(ev && ev.id === "cctv")
    };
    up["meta/status"] = "role"; up["meta/day"] = 0; up["meta/round"] = 1; up["meta/deadline"] = now + SEC.role * 1000;
    up["meta/n"] = n; up["meta/winner"] = null; up["meta/pendingWin"] = null; up["meta/candidates"] = null;
    return up;
  }
  // 같은 사람끼리 한 판 더: 대기실로 되돌린다
  function resetRoom(room) {
    var up = { secret: null, "private": null, actions: null, votes: null, "public": null };
    Object.keys(players(room)).forEach(function (u) { up["players/" + u + "/seat"] = null; up["players/" + u + "/alive"] = null; up["players/" + u + "/ready"] = null; });
    up["meta/status"] = "lobby"; up["meta/day"] = 0; up["meta/round"] = 1; up["meta/deadline"] = null; up["meta/winner"] = null; up["meta/pendingWin"] = null; up["meta/candidates"] = null;
    return up;
  }

  // ---------- 단계 전환 ----------
  function enterNight(room, D, d, now) {
    var up = { "meta/status": "night", "meta/day": d, "meta/round": 1, "meta/deadline": now + SEC.night * 1000, "meta/pendingWin": null, "meta/candidates": null };
    var alive = aliveUids(room);
    alive.forEach(function (u) { if (roleOf(room, u) === "smeller") up["private/" + u + "/smell/" + d] = smellClue(room, D, d, alive); });
    return up;
  }
  function nightUpkeep(room, D) {
    var m = room.meta, d = m.day, up = {}, acts = ((room.actions || {})[d]) || {}, priv = room["private"] || {}, sc = scene(room);
    var alive = aliveUids(room);
    alive.forEach(function (u) {
      var r = roleOf(room, u), a = acts[u];
      if (r === "detective" && a && a.target && !(sc.event && sc.event.id === "blackout" && d === 1)) {
        var cur = ((priv[u] || {}).checks || {})[d];
        if (!cur || cur.target !== a.target) up["private/" + u + "/checks/" + d] = { target: a.target, thief: roleOfSeat(room, a.target) === "thief" };
      }
      if (r === "thief") {
        alive.forEach(function (o) {
          if (o === u || roleOf(room, o) !== "thief") return;
          var pt = (acts[o] && acts[o].target) || 0, curp = (((priv[u] || {}).partnerPick || {})[d]) || 0;
          if (pt !== curp) up["private/" + u + "/partnerPick/" + d] = pt;
        });
      }
    });
    return up;
  }
  function resolveNight(room, D, now) {
    var m = room.meta, d = m.day, sc = scene(room), alive = aliveUids(room), acts = ((room.actions || {})[d]) || {}, up = {};
    var thieves = alive.filter(function (u) { return roleOf(room, u) === "thief"; });
    var targets = alive.filter(function (u) { return roleOf(room, u) !== "thief"; }).map(function (u) { return seatOf(room, u); });
    var victim = 0;
    if (sc.lockNight !== d && targets.length) {
      var picks = thieves.map(function (u) { return acts[u] && acts[u].target; }).filter(function (s) { return targets.indexOf(s) >= 0; });
      if (!picks.length) victim = pick(targets);
      else if (picks.every(function (s) { return s === picks[0]; })) victim = picks[0];
      else victim = pick(picks);
    }
    var after = alive.slice(), rec = { victim: victim, lock: sc.lockNight === d };
    if (victim) {
      var vu = uidOfSeat(room, victim);
      up["players/" + vu + "/alive"] = false;
      after = alive.filter(function (u) { return u !== vu; });
    }
    var win = judge(room, after);
    if (victim && !win) rec.trace = traceOf(room, D, after);
    if (d === 1 && sc.cctv && !win) rec.cctv = cctvClue(room, D, after);
    up["public/days/" + d + "/night"] = rec;
    up["meta/status"] = "morning"; up["meta/deadline"] = now + SEC.morning * 1000; up["meta/pendingWin"] = win || null;
    return up;
  }
  function tally(room, now) {
    var m = room.meta, d = m.day, r = m.round || 1, votes = (((room.votes || {})[d]) || {})[r] || {}, alive = aliveUids(room), cand = m.candidates || alive.map(function (u) { return seatOf(room, u); });
    var count = {};
    alive.forEach(function (u) { var v = votes[u]; if (v && cand.indexOf(v) >= 0) count[v] = (count[v] || 0) + 1; });
    var max = 0; Object.keys(count).forEach(function (k) { if (count[k] > max) max = count[k]; });
    var top = Object.keys(count).filter(function (k) { return count[k] === max && max > 0; }).map(Number).sort(function (a, b) { return a - b; });
    var up = {};
    if (top.length > 1 && r === 1) {
      up["meta/round"] = 2; up["meta/candidates"] = top; up["meta/deadline"] = now + SEC.vote * 1000;
      return up;
    }
    var exiled = top.length === 1 ? top[0] : 0, after = alive;
    var rec = { exiled: exiled, tie: top.length > 1, rounds: r };
    if (exiled) {
      var eu = uidOfSeat(room, exiled);
      up["players/" + eu + "/alive"] = false; rec.role = roleOf(room, eu);
      after = alive.filter(function (u) { return u !== eu; });
    }
    up["public/days/" + d + "/vote"] = rec;
    up["meta/status"] = "verdict"; up["meta/deadline"] = now + SEC.verdict * 1000; up["meta/pendingWin"] = judge(room, after) || null; up["meta/candidates"] = null;
    return up;
  }
  function endGame(room, win) {
    var up = { "meta/status": "end", "meta/winner": win, "meta/deadline": null }, roles = {};
    seated(room).forEach(function (u) { roles[seatOf(room, u)] = roleOf(room, u); });
    up["public/final"] = { winner: win, roles: roles };
    return up;
  }
  function setPhase(status, now, extra) {
    var up = { "meta/status": status, "meta/deadline": now + SEC[status] * 1000 };
    if (extra) Object.keys(extra).forEach(function (k) { up[k] = extra[k]; });
    return up;
  }

  // 심판 폰이 주기적으로 부르는 함수. 바꿀 것이 없으면 null.
  function step(room, D, now) {
    var m = room.meta;
    if (!m || !m.status || m.status === "lobby" || m.status === "end") return null;
    var key = phaseKey(m), alive = aliveUids(room), p = players(room);
    var allReady = alive.length > 0 && alive.every(function (u) { return p[u].ready === key; });
    var late = !!m.deadline && now >= m.deadline;
    switch (m.status) {
      case "role": return (allReady || late) ? enterNight(room, D, 1, now) : null;
      case "night": {
        var up = nightUpkeep(room, D);
        if (allReady || late) { var r = resolveNight(room, D, now); Object.keys(r).forEach(function (k) { up[k] = r[k]; }); }
        return Object.keys(up).length ? up : null;
      }
      case "morning":
        if (!(allReady || late)) return null;
        return m.pendingWin ? endGame(room, m.pendingWin) : setPhase("talk", now);
      case "talk": return (allReady || late) ? setPhase("vote", now, { "meta/round": 1, "meta/candidates": null }) : null;
      case "vote": {
        var votes = (((room.votes || {})[m.day]) || {})[m.round || 1] || {};
        var allVoted = alive.every(function (u) { return votes[u] !== undefined && votes[u] !== null; });
        return (allVoted || late) ? tally(room, now) : null;
      }
      case "verdict":
        if (!(allReady || late)) return null;
        return m.pendingWin ? endGame(room, m.pendingWin) : enterNight(room, D, m.day + 1, now);
    }
    return null;
  }

  // 심판 정하기: 지금 심판이 접속해 있지 않으면, 가장 먼저 들어온 접속자가 이어받는다
  function electReferee(room) {
    var m = room.meta || {}, p = players(room);
    if (m.host && p[m.host] && p[m.host].online === true) return m.host;
    var on = Object.keys(p).filter(function (u) { return p[u].online === true; }).sort(function (a, b) { return (p[a].joinedAt || 0) - (p[b].joinedAt || 0); });
    return on[0] || m.host;
  }

  root.MafiaCore = {
    ROLES: ROLES, SEC: SEC, RNAME: RNAME, setRandom: setRandom,
    phaseKey: phaseKey, aliveUids: aliveUids, uidOfSeat: uidOfSeat, seatOf: seatOf, roleOf: roleOf,
    canStart: canStart, startGame: startGame, resetRoom: resetRoom, step: step, electReferee: electReferee, judge: judge
  };
})(typeof window !== "undefined" ? window : globalThis);
