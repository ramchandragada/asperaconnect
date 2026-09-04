#!/usr/bin/env node
/**
 * Aspera Connect cloud relay — WhatsApp-style pairing across networks.
 *
 * Both PC and phone dial OUT to this server over WebSocket.
 * QR carries only a short-lived session id + secret (not IPs).
 *
 * Protocol (JSON text frames):
 *   { "type":"create", "role":"pc", "name":"Office-PC" }
 *   → { "type":"created", "sessionId":"...", "secret":"...", "expiresInSec":600 }
 *
 *   { "type":"join", "role":"phone", "sessionId":"...", "secret":"...", "name":"Pixel" }
 *   → { "type":"joined", "ok":true }
 *   → both get { "type":"paired", "pcName":"...", "phoneName":"..." }
 *
 * After paired, any other JSON message is forwarded to the peer.
 * Heartbeat: { "type":"ping" } → { "type":"pong" }
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8787);
const TTL_MS = Number(process.env.SESSION_TTL_MS || 10 * 60 * 1000);
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 5000);

/** @typedef {{ id: string, secret: string, pc: import('ws').WebSocket|null, phone: import('ws').WebSocket|null, pcName: string, phoneName: string, createdAt: number, paired: boolean }} Session */

/** @type {Map<string, Session>} */
const sessions = new Map();

function newId() {
  return randomBytes(12).toString("base64url");
}

function newSecret() {
  return randomBytes(24).toString("base64url");
}

function cleanup() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > TTL_MS) {
      try {
        s.pc?.close();
      } catch {}
      try {
        s.phone?.close();
      } catch {}
      sessions.delete(id);
    }
  }
}
setInterval(cleanup, 30_000).unref();

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

function peerOf(session, ws) {
  if (session.pc === ws) return session.phone;
  if (session.phone === ws) return session.pc;
  return null;
}

function detach(ws) {
  for (const [id, s] of sessions) {
    if (s.pc === ws) s.pc = null;
    if (s.phone === ws) s.phone = null;
    if (!s.pc && !s.phone) sessions.delete(id);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Aspera Connect relay — connect with WebSocket\n");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  /** @type {string|null} */
  let sessionId = null;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      send(ws, { type: "error", reason: "bad_json" });
      return;
    }
    const type = msg?.type;

    if (type === "ping") {
      send(ws, { type: "pong" });
      return;
    }

    if (type === "create") {
      cleanup();
      if (sessions.size >= MAX_SESSIONS) {
        send(ws, { type: "error", reason: "relay_busy" });
        return;
      }
      const id = newId();
      const secret = newSecret();
      sessions.set(id, {
        id,
        secret,
        pc: ws,
        phone: null,
        pcName: String(msg.name || "PC").slice(0, 64),
        phoneName: "",
        createdAt: Date.now(),
        paired: false,
      });
      sessionId = id;
      send(ws, {
        type: "created",
        sessionId: id,
        secret,
        expiresInSec: Math.floor(TTL_MS / 1000),
      });
      return;
    }

    if (type === "join") {
      const id = String(msg.sessionId || "");
      const secret = String(msg.secret || "");
      const s = sessions.get(id);
      if (!s || s.secret !== secret) {
        send(ws, { type: "joined", ok: false, reason: "invalid_or_expired" });
        return;
      }
      if (Date.now() - s.createdAt > TTL_MS) {
        sessions.delete(id);
        send(ws, { type: "joined", ok: false, reason: "expired" });
        return;
      }
      if (s.phone && s.phone !== ws) {
        send(ws, { type: "joined", ok: false, reason: "already_paired" });
        return;
      }
      s.phone = ws;
      s.phoneName = String(msg.name || "Phone").slice(0, 64);
      s.paired = true;
      sessionId = id;
      send(ws, { type: "joined", ok: true });
      const payload = {
        type: "paired",
        pcName: s.pcName,
        phoneName: s.phoneName,
      };
      send(s.pc, payload);
      send(s.phone, payload);
      return;
    }

    // Forward companion protocol messages to peer after pairing.
    if (sessionId) {
      const s = sessions.get(sessionId);
      if (!s || !s.paired) {
        send(ws, { type: "error", reason: "not_paired" });
        return;
      }
      const other = peerOf(s, ws);
      if (!other) {
        send(ws, { type: "error", reason: "peer_gone" });
        return;
      }
      // Do not forward relay control types.
      if (["create", "join", "created", "joined", "paired", "ping", "pong"].includes(type)) {
        return;
      }
      send(other, msg);
      return;
    }

    send(ws, { type: "error", reason: "unknown_type" });
  });

  ws.on("close", () => detach(ws));
  ws.on("error", () => detach(ws));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`aspera-relay listening on :${PORT}`);
});
