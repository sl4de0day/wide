

(function () {
  "use strict";
  if (window.__wideEnginePatch) return;
  window.__wideEnginePatch = true;

  var origCreate = document.createElement.bind(document);
  document.createElement = function (tag, options) {
    if (typeof tag === "string" && tag.toLowerCase() === "webview") {
      var frame = origCreate("iframe");
      frame.setAttribute("data-was-webview", "1");
      frame.style.border = "0";

      frame.getWebContentsId = function () { return 1; };
      frame.executeJavaScript = function () { return Promise.resolve(null); };
      frame.reload = function () {
        try { frame.contentWindow.location.reload(); } catch (e) {}
      };
      frame.loadURL = function (url) { frame.src = url; };
      frame.stop = function () {};
      frame.addEventListener = (function (orig) {
        return function (type, fn, opts) {

          if (type === "dom-ready" || type === "did-finish-load") {
            return orig.call(frame, "load", fn, opts);
          }
          return orig.call(frame, type, fn, opts);
        };
      })(frame.addEventListener.bind(frame));

      var origSetAttr = frame.setAttribute.bind(frame);
      frame.setAttribute = function (name, value) {
        if (name === "partition" || name === "allowpopups" ||
            name === "webpreferences" || name === "nodeintegration") return;
        return origSetAttr(name, value);
      };
      return frame;
    }
    return origCreate(tag, options);
  };
})();
