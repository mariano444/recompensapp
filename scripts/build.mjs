import { mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");

const env = {
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://gzptxigymwcvijejvbjm.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    "sb_publishable_nMh5ZL67YV2nkGod5DdHLw_YYaHKcvn",
  NEXT_PUBLIC_MP_PUBLIC_KEY: process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "",
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
};

const mainHtmlPath = path.join(root, "recompensapp.html");
const adminHtmlPath = path.join(root, "recompensapp_admin_config.html");
const schemaPath = path.join(root, "recompensapp_supabase_schema.sql");
const bridgePath = path.join(root, "src", "supabase-bridge.js");
const adminPath = path.join(root, "src", "admin-runtime.js");

function injectScripts(html, scripts) {
  return html.replace(
    "</body>",
    `${scripts.map((src) => `<script src="${src}"></script>`).join("\n")}\n</body>`
  );
}

await rm(distDir, { recursive: true, force: true });
await mkdir(path.join(distDir, "assets"), { recursive: true });

const [mainHtml, adminHtml, bridgeJs, adminJs] = await Promise.all([
  readFile(mainHtmlPath, "utf8"),
  readFile(adminHtmlPath, "utf8"),
  readFile(bridgePath, "utf8"),
  readFile(adminPath, "utf8")
]);

const runtimeConfig = `window.RUNTIME_CONFIG = ${JSON.stringify(env, null, 2)};\n`;

const builtMain = injectScripts(mainHtml, [
  "./assets/runtime-config.js",
  "./assets/supabase-bridge.js"
]);

const builtAdmin = injectScripts(adminHtml, [
  "./assets/runtime-config.js",
  "./assets/admin-runtime.js"
]);

await Promise.all([
  writeFile(path.join(distDir, "index.html"), builtMain, "utf8"),
  writeFile(
    path.join(distDir, "recompensapp_admin_config.html"),
    builtAdmin,
    "utf8"
  ),
  writeFile(path.join(distDir, "assets", "runtime-config.js"), runtimeConfig, "utf8"),
  writeFile(path.join(distDir, "assets", "supabase-bridge.js"), bridgeJs, "utf8"),
  writeFile(path.join(distDir, "assets", "admin-runtime.js"), adminJs, "utf8"),
  copyFile(schemaPath, path.join(distDir, "recompensapp_supabase_schema.sql"))
]);

console.log(`Build listo en ${distDir}`);
