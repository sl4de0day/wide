

const SOURCE_EXTENSIONS = /\.(?:m|c)?[jt]sx?$/;
const MAX_PROJECT_FILES = 3e3;
const norm = (path) => path.split(node_path.sep).join("/");
const overlay =  new Map();
let service = null;
let projectRoot = null;
function collectFiles(dir2, out) {
  if (out.length >= MAX_PROJECT_FILES) return;
  let entries;
  try {
    entries = node_fs.readdirSync(dir2, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_PROJECT_FILES) return;
    if (entry.isDirectory()) {
      if (!IGNORED$2.has(entry.name)) collectFiles(node_path.join(dir2, entry.name), out);
    } else if (SOURCE_EXTENSIONS.test(entry.name)) {
      out.push(norm(node_path.join(dir2, entry.name)));
    }
  }
}
const displayPartsToString = (parts) => ts.displayPartsToString(parts ?? []);
