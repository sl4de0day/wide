

(function () {
  "use strict";
  if (window.__wideChrome) return;
  window.__wideChrome = true;

  var wv = window.chrome && window.chrome.webview;
  function cmd(name) { try { wv.postMessage({ type: "host-cmd", cmd: name }); } catch (e) {} }

  function regionOf(el) {
    while (el && el.nodeType === 1) {
      var r = getComputedStyle(el).getPropertyValue("-webkit-app-region") ||
              getComputedStyle(el).getPropertyValue("app-region");
      if (r) { r = r.trim(); if (r === "drag" || r === "no-drag") return r; }
      el = el.parentElement;
    }
    return "";
  }
  document.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    var target = e.target;
    if (target && target.closest && target.closest("#hc-winctl")) return;
    var region = regionOf(target);
    if (region === "drag") { cmd("drag"); return; }

    if (region !== "no-drag" && e.clientY <= 36) {
      var t = target;
      var interactive = t && t.closest &&
        t.closest("button,a,input,select,textarea,[role='button'],[contenteditable]");
      if (!interactive) cmd("drag");
    }
  }, true);

  var SVG_MIN = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 5h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  var SVG_MAX = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>';
  var SVG_RESTORE = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 2h5.5v5.5M1.5 3.5h5v5h-5z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SVG_CLOSE = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.75 1.75l6.5 6.5M8.25 1.75l-6.5 6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

  function build() {
    if (document.getElementById("hc-winctl")) return;
    var style = document.createElement("style");
    style.textContent = [
      "#hc-winctl{position:fixed;top:0;right:0;height:36px;display:flex;align-items:center;z-index:2147483647;",
      "  -webkit-app-region:no-drag;app-region:no-drag;user-select:none;}",
      "#hc-winctl button{width:46px;height:36px;border:0;background:transparent;color:#94b4c1;",
      "  display:flex;align-items:center;justify-content:center;cursor:default;outline:none;padding:0;",
      "  transition:background-color 120ms ease,color 120ms ease;}",
      "#hc-winctl button:hover{background:rgba(148, 180, 193, 0.14);color:#d8dee9;}",
      "#hc-winctl button:active{background:rgba(148, 180, 193, 0.22);}",
      "#hc-winctl button.close:hover{background:#e81123 !important;color:#ffffff !important;}",
      "#hc-winctl button.close:active{background:#c42b1c !important;color:#ffffff !important;}",
    ].join("");
    document.head.appendChild(style);

    var bar = document.createElement("div");
    bar.id = "hc-winctl";

    var btnMin = document.createElement("button");
    btnMin.className = "min";
    btnMin.title = "Küçült";
    btnMin.setAttribute("aria-label", "Küçült");
    btnMin.innerHTML = SVG_MIN;
    btnMin.addEventListener("click", function () { cmd("minimize"); });

    var btnMax = document.createElement("button");
    btnMax.className = "max";
    btnMax.title = "Büyüt";
    btnMax.setAttribute("aria-label", "Büyüt");
    btnMax.innerHTML = SVG_MAX;
    btnMax.addEventListener("click", function () { cmd("maximize"); });

    var btnClose = document.createElement("button");
    btnClose.className = "close";
    btnClose.title = "Kapat";
    btnClose.setAttribute("aria-label", "Kapat");
    btnClose.innerHTML = SVG_CLOSE;
    btnClose.addEventListener("click", function () { cmd("close"); });

    bar.appendChild(btnMin);
    bar.appendChild(btnMax);
    bar.appendChild(btnClose);
    document.body.appendChild(bar);

    // Pencere maksimize durumuna göre simgeyi güncelle
    function updateMaxIcon() {
      var isMax = (window.outerWidth >= screen.availWidth && window.outerHeight >= screen.availHeight);
      btnMax.innerHTML = isMax ? SVG_RESTORE : SVG_MAX;
      btnMax.title = isMax ? "Geri Yükle" : "Büyüt";
      btnMax.setAttribute("aria-label", btnMax.title);
    }
    window.addEventListener("resize", updateMaxIcon);
  }
  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
