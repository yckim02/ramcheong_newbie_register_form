/* 람원교회 청년교구 새가족 등록폼 — 동작 (확정본: 구 시안 A)
 * 검색/등록은 같은 도메인의 서버리스 프록시(/api/*)를 호출한다. 비밀값 없음. */
(function () {
  "use strict";

  /* 등록 저장 — 폼과 같은 도메인의 서버리스 프록시를 거쳐
   * 청년부 공용 구글시트의 '새가족' 탭에 한 줄씩 쌓인다.
   * Apps Script 웹앱 URL과 토큰은 서버 환경변수에만 두므로
   * 이 파일에는 어떤 비밀값도 들어가지 않는다. */
  var REGISTER_ENDPOINT = "/api/register";

  var form = document.getElementById("regForm");
  var success = document.getElementById("success");
  var againBtn = document.getElementById("againBtn");
  var submitBtn = document.getElementById("submitBtn");
  var errorBox = document.getElementById("formError");
  var todayLabel = document.getElementById("todayLabel");

  var today = new Date();
  todayLabel.textContent = today.getFullYear() + " / " + String(today.getMonth() + 1).padStart(2, "0") + " / " + String(today.getDate()).padStart(2, "0");

  document.querySelectorAll("[data-reveal]").forEach(function (radio) {
    radio.addEventListener("change", function () {
      var group = radio.closest(".field");
      group.querySelectorAll(".conditional").forEach(function (box) { box.classList.remove("open"); });
      var targetId = radio.getAttribute("data-reveal");
      if (targetId) {
        var target = document.getElementById(targetId);
        if (target) {
          target.classList.add("open");
          var toFocus = target.querySelector("input[type=text]");
          if (toFocus) setTimeout(function () { toFocus.focus(); }, 180);
        }
      }
    });
  });

  /* ---------------------------------------------------------------------
   * 교회 검색 — 네이버 지역검색 API
   *
   * 브라우저에서 openapi.naver.com 을 직접 부를 수는 없다.
   *  (1) 네이버 오픈API는 브라우저 origin에 CORS를 허용하지 않고,
   *  (2) 호출에 필요한 Client Secret을 프론트에 두면 그대로 유출된다.
   * 그래서 폼과 같은 도메인에 함께 올리는 서버리스 프록시를 경유한다.
   * 프록시 코드/설정법: registration-form/api/church-search.js, README-배포.md
   * --------------------------------------------------------------------- */
  var CHURCH_SEARCH_ENDPOINT = "/api/church-search";
  var CHURCH_SEARCH_MIN_LEN = 2;

  var churchInput = document.getElementById("church_search_input");
  var churchResults = document.getElementById("churchResults");
  var churchManual = document.getElementById("churchManual");
  var churchManualInput = document.getElementById("prior_church_name");
  var churchIdField = document.getElementById("prior_church_id");
  var churchDenomField = document.getElementById("prior_church_denomination");
  var churchLocationField = document.getElementById("prior_church_location");
  var churchNaverField = document.getElementById("prior_church_naver");

  var churchTimer = null;
  var churchAbort = null;

  /* 검색어를 다시 입력하면 이전에 고른 교회의 흔적(위치/원본)만 지운다.
   * 교단·청년부는 새가족이 직접 적는 값이라 여기서 건드리지 않는다. */
  function resetChurchSelection() {
    churchIdField.value = "";
    churchLocationField.value = "";
    churchNaverField.value = "";
  }

  function selectChurch(c) {
    churchInput.value = c.name;
    churchManualInput.value = c.name;
    churchLocationField.value = c.roadAddress || c.address || "";
    // 네이버 지역검색은 이름/주소까지만 준다. 교단과 청년부 유무는
    // 아래 입력칸에서 새가족이 직접 적고, 검색결과 원본은 그대로 함께 넘긴다.
    churchIdField.value = "";
    churchNaverField.value = JSON.stringify(c);
    churchResults.hidden = true;
    churchManual.hidden = true;
  }

  function showManualChurchInput() {
    churchManual.hidden = false;
    churchResults.hidden = true;
    resetChurchSelection();
    churchManualInput.focus();
  }

  function churchStatus(msg, withManualBtn) {
    churchResults.innerHTML = "";
    var li = document.createElement("li");
    li.className = "church-status";
    li.textContent = msg;
    if (withManualBtn) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "church-manual-btn";
      btn.textContent = "직접 입력할게요";
      btn.addEventListener("click", showManualChurchInput);
      li.appendChild(btn);
    }
    churchResults.appendChild(li);
    churchResults.hidden = false;
  }

  function renderChurchResults(list) {
    if (!list.length) { churchStatus("검색 결과가 없어요. ", true); return; }
    churchResults.innerHTML = "";
    list.forEach(function (c) {
      var li = document.createElement("li");
      li.className = "church-result-item";
      li.tabIndex = 0;
      var nameEl = document.createElement("span");
      nameEl.className = "church-name";
      nameEl.textContent = c.name;
      var metaEl = document.createElement("span");
      metaEl.className = "church-meta";
      metaEl.textContent = c.roadAddress || c.address || "";
      li.appendChild(nameEl);
      li.appendChild(metaEl);
      li.addEventListener("click", function () { selectChurch(c); });
      li.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectChurch(c); }
      });
      churchResults.appendChild(li);
    });
    var foot = document.createElement("li");
    foot.className = "church-foot";
    var src = document.createElement("span");
    src.textContent = "네이버 지역검색 제공";
    var manualBtn = document.createElement("button");
    manualBtn.type = "button";
    manualBtn.className = "church-manual-btn";
    manualBtn.textContent = "목록에 없어요";
    manualBtn.addEventListener("click", showManualChurchInput);
    foot.appendChild(src);
    foot.appendChild(manualBtn);
    churchResults.appendChild(foot);
    churchResults.hidden = false;
  }

  function requestChurchSearch(q) {
    if (churchAbort) churchAbort.abort();
    churchAbort = (typeof AbortController !== "undefined") ? new AbortController() : null;
    churchStatus("검색 중...", false);
    fetch(CHURCH_SEARCH_ENDPOINT + "?q=" + encodeURIComponent(q),
          churchAbort ? { signal: churchAbort.signal } : {})
      .then(function (res) {
        if (!res.ok) throw new Error("search_failed_" + res.status);
        return res.json();
      })
      .then(function (data) { renderChurchResults((data && data.items) || []); })
      .catch(function (err) {
        if (err && err.name === "AbortError") return;
        console.error("[람청 새가족 등록폼] 교회 검색 실패", err);
        churchStatus("검색을 불러오지 못했어요. ", true);
      });
  }

  if (churchInput) {
    churchInput.addEventListener("input", function () {
      resetChurchSelection();
      churchManual.hidden = true;
      var q = churchInput.value.trim();
      if (churchTimer) clearTimeout(churchTimer);
      if (q.length < CHURCH_SEARCH_MIN_LEN) {
        if (churchAbort) churchAbort.abort();
        churchResults.hidden = true;
        return;
      }
      churchTimer = setTimeout(function () { requestChurchSearch(q); }, 300);
    });
  }

  /* ---------------------------------------------------------------------
   * 등록하기 클릭 시 "사랑배달부" 캐릭터가 버튼 위를 빠르게 지나가는 연출
   * --------------------------------------------------------------------- */
  function flyCourier(buttonEl) {
    if (!buttonEl || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var rect = buttonEl.getBoundingClientRect();
    var img = document.createElement("img");
    img.src = "./assets/courier.png";
    img.alt = "";
    img.className = "courier-fly";
    var flyWidth = Math.max(64, Math.min(110, rect.width * 0.3));
    var flyHeight = flyWidth * (280 / 480);
    img.style.width = flyWidth + "px";
    var topY = rect.top - flyHeight * 0.75;
    var startX = rect.left - flyWidth * 1.2;
    var endX = rect.right + flyWidth * 0.4;
    img.style.top = topY + "px";
    img.style.left = startX + "px";
    document.body.appendChild(img);
    var dx = endX - startX;
    var anim = img.animate(
      [
        { transform: "translateX(0)", opacity: 0 },
        { transform: "translateX(" + (dx * 0.12) + "px)", opacity: 1, offset: 0.14 },
        { transform: "translateX(" + (dx * 0.86) + "px)", opacity: 1, offset: 0.86 },
        { transform: "translateX(" + dx + "px)", opacity: 0 }
      ],
      { duration: 750, easing: "cubic-bezier(.25,.7,.3,1)" }
    );
    anim.onfinish = function () { img.remove(); };
  }

  function showError(msg) { errorBox.textContent = msg; errorBox.classList.add("show"); }
  function clearError() { errorBox.classList.remove("show"); errorBox.textContent = ""; }
  function getRadioValue(name) {
    var el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearError();

    var name = form.name.value.trim();
    var phone = form.phone.value.trim();
    if (!name) { showError("이름을 입력해주세요."); form.name.focus(); return; }
    if (!phone) { showError("연락처를 입력해주세요."); form.phone.focus(); return; }

    flyCourier(submitBtn);

    // '있음'으로 교회 정보를 적었다가 '없음'으로 바꿔 제출하면
    // 그 전에 적어둔 교회 정보는 보내지 않는다 (모순된 행 방지)
    var hasPriorChurch = getRadioValue("prior_church_status") === "있음";

    var payload = {
      name: name,
      gender: getRadioValue("gender"),
      birth_date: form.birth_date.value || null,
      phone: phone,
      prior_church_status: getRadioValue("prior_church_status"),
      prior_church_name: hasPriorChurch ? (form.prior_church_name.value.trim() || null) : null,
      prior_church_id: hasPriorChurch ? (churchIdField.value || null) : null,
      prior_church_denomination: hasPriorChurch ? (churchDenomField.value.trim() || null) : null,
      prior_church_location: hasPriorChurch ? (churchLocationField.value || null) : null,
      prior_church_has_youth_group: hasPriorChurch ? getRadioValue("prior_church_has_youth_group") : null,
      prior_church_naver: (hasPriorChurch && churchNaverField.value) ? JSON.parse(churchNaverField.value) : null,
      baptism_status: getRadioValue("baptism_status"),
      visit_source: getRadioValue("visit_source"),
      visit_source_etc: form.visit_source_etc.value.trim() || null,
      attendance_wish: getRadioValue("attendance_wish")
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "등록 중...";
    fetch(REGISTER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        // 503 = 서버에 시트 연결 정보(SHEETS_WEBHOOK_*)가 아직 설정되지 않은 상태
        if (res.status === 503) throw new Error("not_configured");
        if (!res.ok) throw new Error("submit_failed_" + res.status);
        form.classList.add("hidden");
        success.classList.add("show");
      })
      .catch(function (err) {
        console.error("[람청 새가족 등록폼] 제출 실패", err);
        if (err && err.message === "not_configured") {
          showError("등록 시스템 준비 중입니다. 교구 스태프에게 말씀해주세요.");
        } else {
          showError("등록 중 문제가 발생했습니다. 다시 시도해주세요.");
        }
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "등록하기";
      });
  });

  againBtn.addEventListener("click", function () {
    form.reset();
    document.querySelectorAll(".conditional.open").forEach(function (box) { box.classList.remove("open"); });
    if (churchInput) churchInput.value = "";
    resetChurchSelection();
    churchResults.hidden = true;
    churchManual.hidden = true;
    success.classList.remove("show");
    form.classList.remove("hidden");
    clearError();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
