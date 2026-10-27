const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
pkg.version = process.env.RELEASE_VERSION?.trim().replace(/^v/, "") || pkg.version;

if (fs.existsSync(DIST)) {
  for (const entry of fs.readdirSync(DIST)) {
    if (entry === "main" || entry === "preload" || entry === "renderer") continue;
    fs.rmSync(path.join(DIST, entry), { recursive: true, force: true });
  }
} else {
  fs.mkdirSync(DIST, { recursive: true });
}

pkg.qwqnt.inject = {
  main: "./main/index.js",
  preload: "./preload/index.js",
  renderer: "./renderer/index.js",
};
delete pkg.devDependencies;
delete pkg.scripts;
delete pkg.packageManager;
delete pkg.trustedDependencies;
fs.writeFileSync(path.join(DIST, "package.json"), JSON.stringify(pkg, null, 2), "utf8");

for (const file of ["LICENSE", "README.md"])
  if (fs.existsSync(path.join(ROOT, file)))
    fs.copyFileSync(path.join(ROOT, file), path.join(DIST, file));

console.log(`dist/ packaged as ${pkg.name}@${pkg.version}`);
