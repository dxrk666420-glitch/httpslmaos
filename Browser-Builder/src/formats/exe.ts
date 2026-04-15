import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import os from "os";

export async function buildExe(jsCode: string): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const src  = join(tmpDir, `bb_src_${Date.now()}.cjs`);
  const out  = join(tmpDir, `bb_out_${Date.now()}.exe`);

  // pkg requires CommonJS for simple entry points
  writeFileSync(src, jsCode, "utf8");

  try {
    execSync(
      `node "${require.resolve("pkg/lib-es5/bin.js")}" "${src}" ` +
      `--target node18-win-x64 --output "${out}" --compress GZip`,
      { timeout: 120_000, stdio: "pipe" }
    );
    const buf = require("fs").readFileSync(out);
    return buf;
  } finally {
    try { unlinkSync(src); } catch {}
    try { if (existsSync(out)) unlinkSync(out); } catch {}
  }
}
