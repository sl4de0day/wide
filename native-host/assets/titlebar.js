

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

  function build() {
    if (document.getElementById("hc-winctl")) return;
    var style = document.createElement("style");
    style.textContent = [
      "#hc-winctl{position:fixed;top:0;right:0;height:36px;display:flex;z-index:2147483647;",
      "  -webkit-app-region:no-drag;app-region:no-drag;font-family:'Segoe MDL2 Assets';}",

      "#hc-winctl button{width:46px;height:36px;border:0;background:transparent;color:#94b4c1;",
      "  font-size:10px;line-height:36px;cursor:default;outline:none;padding:0;}",
      "#hc-winctl button:hover{background:#94b4c114;}",
      "#hc-winctl button.close:hover{background:#ffffff;color:#213448;}",
    ].join("");
    document.head.appendChild(style);

    var bar = document.createElement("div");
    bar.id = "hc-winctl";
    var defs = [["min", ""], ["max", ""], ["close", ""]];
    defs.forEach(function (d) {
      var b = document.createElement("button");
      if (d[0] === "close") b.className = "close";
      b.textContent = d[1];
      b.addEventListener("click", function () {
        cmd(d[0] === "min" ? "minimize" : d[0] === "max" ? "maximize" : "close");
      });
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
  }
  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
