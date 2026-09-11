#!/usr/bin/env node
/** Smoke: create → join → phone drop → rejoin → placeCall forward (durable pair). */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const PORT = 18787;
const root = dirname(fileURLToPath(import.meta.url));
const server = spawn("node", ["server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
await sleep(500);

function waitType(ws, type, ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${type}`)), ms);
    const onMsg = (d) => {
      const msg = JSON.parse(String(d));
      if (msg.type === type) {
        clearTimeout(t);
        ws.off("message", onMsg);
        resolve(msg);
      }
    };
    ws.on("message", onMsg);
  });
}

try {
  const url = `ws://127.0.0.1:${PORT}`;
  const pc = new WebSocket(url);
  await new Promise((r, j) => {
    pc.once("open", r);
    pc.once("error", j);
  });
  pc.send(JSON.stringify({ type: "create", name: "TestPC" }));
  const created = await waitType(pc, "created");

  const phone = new WebSocket(url);
  await new Promise((r) => phone.once("open", r));
  const pairedPc = waitType(pc, "paired");
  const pairedPhone = waitType(phone, "paired");
  phone.send(
    JSON.stringify({
      type: "join",
      role: "phone",
      sessionId: created.sessionId,
      secret: created.secret,
      name: "Pixel",
    }),
  );
  await Promise.all([pairedPc, pairedPhone, waitType(phone, "joined")]);

  phone.close();
  await waitType(pc, "peer_disconnected");
  await sleep(150);

  const phone2 = new WebSocket(url);
  await new Promise((r) => phone2.once("open", r));
  const rejoined = waitType(phone2, "rejoined");
  const pairedAgain = waitType(pc, "paired");
  phone2.send(
    JSON.stringify({
      type: "rejoin",
      role: "phone",
      sessionId: created.sessionId,
      secret: created.secret,
      name: "Pixel",
    }),
  );
  const rj = await rejoined;
  if (!rj.ok) throw new Error("rejoin failed: " + JSON.stringify(rj));
  await pairedAgain;

  const got = waitType(phone2, "placeCall");
  pc.send(JSON.stringify({ type: "placeCall", number: "+913146617028", direct: true }));
  const call = await got;
  if (call.number !== "+913146617028") throw new Error("forward failed");

  const health = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.json());
  if (!health.ok || health.paired < 1) throw new Error("health bad " + JSON.stringify(health));

  console.log("relay durable-pair smoke OK", health);
  pc.close();
  phone2.close();
  process.exitCode = 0;
} catch (e) {
  console.error("FAIL", e);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await sleep(100);
  process.exit(process.exitCode ?? 0);
}
