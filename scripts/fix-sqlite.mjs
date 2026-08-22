import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../dist/index.js", import.meta.url);
const source = readFileSync(path, "utf8");
const fixed = source
  .replaceAll('require("sqlite")', 'require("node:sqlite")')
  .replaceAll("require('sqlite')", "require('node:sqlite')");

if (fixed !== source) {
  writeFileSync(path, fixed);
  console.log("fix-sqlite: restored node: prefix in dist/index.js");
} else {
  console.log("fix-sqlite: nothing to patch");
}
