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

  function isDragHit(e) {
    var target = e.target;
    if (target && target.closest && target.closest("#hc-winctl")) return false;
    var region = regionOf(target);
    if (region === "drag") {
      var interactiveInRegion = target && target.closest &&
        target.closest("button,a,input,select,textarea,[role='button'],[contenteditable]");
      return !interactiveInRegion;
    }
    if (region !== "no-drag" && e.clientY <= 36) {
      var interactive = target && target.closest &&
        target.closest("button,a,input,select,textarea,[role='button'],[contenteditable]");
      return !interactive;
    }
    return false;
  }

  var dragStart = null;
  document.addEventListener("mousedown", function (e) {
    if (e.button !== 0) { dragStart = null; return; }
    dragStart = isDragHit(e) ? { x: e.clientX, y: e.clientY } : null;
  }, true);

  document.addEventListener("mousemove", function (e) {
    if (!dragStart) return;
    if ((e.buttons & 1) === 0) { dragStart = null; return; }
    if (Math.abs(e.clientX - dragStart.x) >= 4 || Math.abs(e.clientY - dragStart.y) >= 4) {
      dragStart = null;
      cmd("drag");
    }
  }, true);

  document.addEventListener("mouseup", function () {
    dragStart = null;
  }, true);

  document.addEventListener("dblclick", function (e) {
    if (e.button !== 0) return;
    if (isDragHit(e)) cmd("maximize");
  }, true);

  window.addEventListener("keydown", function (e) {
    if (e.key === "F11" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      cmd("fullscreen");
    }
  }, true);

  var SVG_MIN = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 5h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  var SVG_MAX = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>';
  var SVG_RESTORE = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 2h5.5v5.5M1.5 3.5h5v5h-5z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SVG_CLOSE = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.75 1.75l6.5 6.5M8.25 1.75l-6.5 6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

  var hostWindowState = null;

  function build() {
    if (document.getElementById("hc-winctl")) return;
    var style = document.createElement("style");
    style.textContent = [
      "#hc-winctl{position:fixed;top:0;right:0;height:36px;display:flex;align-items:center;z-index:2147483647;",
      "  -webkit-app-region:no-drag;app-region:no-drag;user-select:none;}",
      "#hc-winctl button{width:46px;height:36px;border:0;background:transparent;color:var(--fg-dim,#A1A1AA);",
      "  display:flex;align-items:center;justify-content:center;cursor:default;outline:none;padding:0;",
      "  transition:background-color 140ms ease,color 140ms ease;}",
      "#hc-winctl button:hover{background:var(--hover,#17171E);color:var(--fg,#FFFFFF);}",
      "#hc-winctl button:active{background:var(--active,#1F1F29);}",
      "#hc-winctl button.close:hover{background:#e81123 !important;color:#ffffff !important;}",
      "#hc-winctl button.close:active{background:#c42b1c !important;color:#ffffff !important;}",
    ].join("");
    document.head.appendChild(style);

    var bar = document.createElement("div");
    bar.id = "hc-winctl";

    var btnMin = document.createElement("button");
    btnMin.className = "min";
    btnMin.title = "Minimize";
    btnMin.setAttribute("aria-label", "Minimize");
    btnMin.innerHTML = SVG_MIN;
    btnMin.addEventListener("click", function () { cmd("minimize"); });

    var btnMax = document.createElement("button");
    btnMax.className = "max";
    btnMax.title = "Maximize";
    btnMax.setAttribute("aria-label", "Maximize");
    btnMax.innerHTML = SVG_MAX;
    btnMax.addEventListener("click", function () { cmd("maximize"); });

    var btnClose = document.createElement("button");
    btnClose.className = "close";
    btnClose.title = "Close";
    btnClose.setAttribute("aria-label", "Close");
    btnClose.innerHTML = SVG_CLOSE;
    btnClose.addEventListener("click", function () { cmd("close"); });

    bar.appendChild(btnMin);
    bar.appendChild(btnMax);
    bar.appendChild(btnClose);
    document.body.appendChild(bar);

    function updateMaxIcon() {
      var isMax = hostWindowState
        ? Boolean(hostWindowState.maximized || hostWindowState.fullscreen)
        : (window.outerWidth >= screen.availWidth - 2 && window.outerHeight >= screen.availHeight - 2);
      btnMax.innerHTML = isMax ? SVG_RESTORE : SVG_MAX;
      btnMax.title = isMax ? "Restore" : "Maximize";
      btnMax.setAttribute("aria-label", btnMax.title);
    }

    if (wv && wv.addEventListener) {
      wv.addEventListener("message", function (e) {
        var msg = e && e.data;
        if (msg && msg.type === "event" && msg.channel === "host:windowState" && msg.payload) {
          hostWindowState = msg.payload;
          updateMaxIcon();
        }
      });
    }

    window.addEventListener("resize", updateMaxIcon);
    updateMaxIcon();
  }
  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
