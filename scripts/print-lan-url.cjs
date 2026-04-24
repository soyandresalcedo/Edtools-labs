/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Imprime URLs http://&lt;IP-LAN&gt;:PORT para probar en el móvil (misma Wi‑Fi).
 */
const os = require("os");

const port = process.env.PORT || 3000;

function ipv4s() {
  const out = [];
  try {
    for (const ifaces of Object.values(os.networkInterfaces())) {
      for (const i of ifaces ?? []) {
        const fam = i.family;
        if (fam === "IPv4" || fam === 4) {
          if (!i.internal) out.push(i.address);
        }
      }
    }
  } catch {
    // Sandboxes / entornos restringidos pueden fallar en networkInterfaces().
  }
  return out;
}

function isPrivateIPv4(a) {
  return (
    /^10\./.test(a) ||
    /^192\.168\./.test(a) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(a)
  );
}

const addrs = ipv4s();
const pick = addrs.find(isPrivateIPv4) || addrs[0] || null;

const line = (path) => `  http://${pick ?? "TU-IP-EN-LAN"}:${port}${path}`;

if (pick) {
  console.log("");
  console.log("  — Listo en red local (misma Wi‑Fi) —");
  console.log(line(""));
  console.log(line("/poc/tilt"));
  console.log("");
} else {
  console.log("");
  console.log(
    "  (No se detectó IP LAN; en Mac: Ajustes → Red, o `ipconfig getifaddr en0`)",
  );
  console.log(line(""));
  console.log(line("/poc/tilt"));
  console.log("");
}
