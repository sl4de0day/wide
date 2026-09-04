

const SM_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SM_B64_INDEX = (() => {
  const m = new Map();
  for (let i = 0; i < SM_B64.length; i++) m.set(SM_B64[i], i);
  return m;
})();

function smDecodeVlq(segment) {
  const out = [];
  let shift = 0;
  let value = 0;
  for (const ch of segment) {
    const digit = SM_B64_INDEX.get(ch);
    if (digit === undefined) return out;
    const cont = digit & 32;
    value += (digit & 31) << shift;
    if (cont) {
      shift += 5;
    } else {
      const negative = value & 1;
      value >>>= 1;
      out.push(negative ? -value : value);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

function smBaseName(p) {
  return String(p).split(/[\\/]/).pop().toLowerCase();
}

function smUrlBaseName(u) {
  return smBaseName(String(u).split(/[?#]/)[0]);
}

function smParseSourceMap(raw) {
  if (!raw || typeof raw.mappings !== "string") return null;
  const sources = raw.sources || [];
  const mappings = raw.mappings;
  const entries = [];

  let genLine = 0;
  let srcIndex = 0;
  let origLine = 0;
  let origCol = 0;

  for (const lineGroup of mappings.split(";")) {
    let genCol = 0;
    if (lineGroup) {
      for (const seg of lineGroup.split(",")) {
        if (!seg) continue;
        const fields = smDecodeVlq(seg);
        if (fields.length === 0) continue;
        genCol += fields[0];
        if (fields.length >= 4) {
          srcIndex += fields[1];
          origLine += fields[2];
          origCol += fields[3];
          entries.push({ genLine, genCol, srcIndex, origLine, origCol });
        }
      }
    }
    genLine += 1;
  }

  return { sources, entries };
}

function smOriginalPositionFor(map, genLine, genCol) {
  if (!map) return null;
  let chosen = null;
  for (const e of map.entries) {
    if (e.genLine > genLine) break;
    if (e.genLine < genLine) {
      chosen = e;
      continue;
    }
    if (e.genCol <= genCol) chosen = e;
    else break;
  }
  if (!chosen) return null;
  return { source: map.sources[chosen.srcIndex], line: chosen.origLine, column: chosen.origCol };
}

function smGeneratedPositionFor(map, sourceBase, origLine) {
  if (!map) return null;
  const wanted = smBaseName(sourceBase);
  let exact = null;
  let next = null;
  for (const e of map.entries) {
    if (smBaseName(map.sources[e.srcIndex]) !== wanted) continue;
    if (e.origLine === origLine) {
      if (!exact || e.genLine < exact.genLine || (e.genLine === exact.genLine && e.genCol < exact.genCol)) exact = e;
    } else if (e.origLine > origLine) {
      if (!next || e.origLine < next.origLine || (e.origLine === next.origLine && e.genLine < next.genLine)) next = e;
    }
  }
  const chosen = exact || next;
  if (!chosen) return null;
  return { line: chosen.genLine, column: chosen.genCol, mappedOrigLine: chosen.origLine };
}

function smHasSource(map, sourceBase) {
  if (!map) return false;
  const wanted = smBaseName(sourceBase);
  return (map.sources || []).some((s) => smBaseName(s) === wanted);
}

function smDecodeDataUri(uri) {
  const comma = uri.indexOf(",");
  if (comma < 0) return null;
  const meta = uri.slice(5, comma);
  const body = uri.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) return Buffer.from(body, "base64").toString("utf8");
    return decodeURIComponent(body);
  } catch {
    return null;
  }
}

function smHttpGet(url) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return resolve(null);
    }
    const transport = u.protocol === "https:" ? node_https : node_http;
    try {
      const request = transport.get(url, { timeout: 4000 }, (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          response.resume();
          return resolve(null);
        }
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve(body));
      });
      request.on("error", () => resolve(null));
      request.on("timeout", () => {
        request.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

async function smLoad(scriptUrl, sourceMapURL) {
  if (!sourceMapURL) return null;
  let text = null;
  if (sourceMapURL.startsWith("data:")) {
    text = smDecodeDataUri(sourceMapURL);
  } else {
    let abs = sourceMapURL;
    try {
      abs = new URL(sourceMapURL, scriptUrl).href;
    } catch {

    }
    text = await smHttpGet(abs);
  }
  if (!text) return null;
  let raw = null;
  try {
    raw = JSON.parse(text);
  } catch {
    try {
      raw = JSON.parse(text.replace(/^\)\]\}'?[^\n]*\n/, ""));
    } catch {
      return null;
    }
  }
  return smParseSourceMap(raw);
}
