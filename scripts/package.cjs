const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const pkgRaw = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
const pkg = JSON.parse(pkgRaw);
const releaseVersion = process.env.RELEASE_VERSION?.trim().replace(/^v/, "");

if (releaseVersion) pkg.version = releaseVersion;

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

const license = path.join(ROOT, "LICENSE");
if (fs.existsSync(license)) fs.copyFileSync(license, path.join(DIST, "LICENSE"));

const readme = path.join(ROOT, "README.md");
if (fs.existsSync(readme)) fs.copyFileSync(readme, path.join(DIST, "README.md"));

console.log(`dist/ packaged as ${pkg.name}@${pkg.version}`);
