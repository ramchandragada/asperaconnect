#!/usr/bin/env node
/**
 * Aspera Connect cloud relay — WhatsApp-style pairing across networks.
 *
 * Pair ONCE. Sessions stay alive for days so PC/phone can reconnect
 * without scanning QR again (rejoin with the same sessionId + secret).
 *
 * Protocol (JSON text frames):
 *   { "type":"create", "role":"pc", "name":"Office-PC" }
 *   → { "type":"created", "sessionId":"...", "secret":"...", "expiresInSec":600 }
 *
 *   { "type":"join", "role":"phone", "sessionId":"...", "secret":"...", "name":"Pixel" }
 *   → { "type":"joined", "ok":true }
 *   → both get { "type":"paired", "pcName":"...", "phoneName":"..." }
 *
 *   { "type":"rejoin", "role":"pc"|"phone", "sessionId":"...", "secret":"...", "name":"..." }
 *   → { "type":"rejoined", "ok":true, "paired":true }
 *   → if peer online: both get { "type":"paired", ... }
 *
 * After paired, any other JSON message is forwarded to the peer.
 * Heartbeat: { "type":"ping" } → { "type":"pong" }
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8787);
/** Unpaired QR offer lifetime */
const PAIR_OFFER_TTL_MS = Number(process.env.SESSION_TTL_MS || 10 * 60 * 1000);
/** Paired link lifetime from last activity (default 30 days) */
const PAIRED_TTL_MS = Number(process.env.PAIRED_TTL_MS || 30 * 24 * 60 * 60 * 1000);
/** Drop paired session only after BOTH sides offline this long */
const BOTH_OFFLINE_TTL_MS = Number(process.env.BOTH_OFFLINE_TTL_MS || 24 * 60 * 60 * 1000);
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 5000);

/**
 * @typedef {{
 *   id: string,
 *   secret: string,
 *   pc: import('ws').WebSocket|null,
 *   phone: import('ws').WebSocket|null,
 *   pcName: string,
 *   phoneName: string,
 *   createdAt: number,
 *   lastActivity: number,
 *   paired: boolean,
 *   bothOfflineSince: number|null,
 * }} Session
 */

/** @type {Map<string, Session>} */
const sessions = new Map();

function newId() {
  return randomBytes(12).toString("base64url");
}

function newSecret() {
  return randomBytes(24).toString("base64url");
}

function touch(s) {
  s.lastActivity = Date.now();
  if (s.pc || s.phone) s.bothOfflineSince = null;
}

function cleanup() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (!s.paired) {
      if (now - s.createdAt > PAIR_OFFER_TTL_MS) {
        try {
          s.pc?.close();
        } catch {}
        try {
          s.phone?.close();
        } catch {}
        sessions.delete(id);
      }
      continue;
    }
    // Paired: keep while either side is connected, or until long idle offline.
    if (s.pc || s.phone) {
      if (now - s.lastActivity > PAIRED_TTL_MS) {
        try {
          s.pc?.close();
        } catch {}
        try {
          s.phone?.close();
        } catch {}
        sessions.delete(id);
      }
      continue;
    }
    if (s.bothOfflineSince == null) s.bothOfflineSince = now;
    if (now - s.bothOfflineSince > BOTH_OFFLINE_TTL_MS) {
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
  for (const [, s] of sessions) {
    let changed = false;
    if (s.pc === ws) {
      s.pc = null;
      changed = true;
    }
    if (s.phone === ws) {
      s.phone = null;
      changed = true;
    }
    if (!changed) continue;
    if (s.paired && (s.pc || s.phone)) {
      const other = s.pc || s.phone;
      send(other, { type: "peer_disconnected" });
    }
    if (!s.pc && !s.phone) {
      if (!s.paired) {
        sessions.delete(s.id);
      } else if (s.bothOfflineSince == null) {
        s.bothOfflineSince = Date.now();
      }
    }
  }
}

function attachRole(s, role, ws, name) {
  if (role === "pc") {
    if (s.pc && s.pc !== ws) {
      try {
        s.pc.close();
      } catch {}
    }
    s.pc = ws;
    if (name) s.pcName = String(name).slice(0, 64);
  } else {
    if (s.phone && s.phone !== ws) {
      try {
        s.phone.close();
      } catch {}
    }
    s.phone = ws;
    if (name) s.phoneName = String(name).slice(0, 64);
  }
  touch(s);
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    let paired = 0;
    for (const s of sessions.values()) if (s.paired) paired += 1;
    res.end(JSON.stringify({ ok: true, sessions: sessions.size, paired }));
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
      const now = Date.now();
      sessions.set(id, {
        id,
        secret,
        pc: ws,
        phone: null,
        pcName: String(msg.name || "PC").slice(0, 64),
        phoneName: "",
        createdAt: now,
        lastActivity: now,
        paired: false,
        bothOfflineSince: null,
      });
      sessionId = id;
      send(ws, {
        type: "created",
        sessionId: id,
        secret,
        expiresInSec: Math.floor(PAIR_OFFER_TTL_MS / 1000),
      });
      return;
    }

    if (type === "join" || type === "rejoin") {
      const id = String(msg.sessionId || "");
      const secret = String(msg.secret || "");
      const role = String(msg.role || (type === "join" ? "phone" : "")).toLowerCase();
      const s = sessions.get(id);
      if (!s || s.secret !== secret) {
        send(ws, {
          type: type === "rejoin" ? "rejoined" : "joined",
          ok: false,
          reason: "invalid_or_expired",
        });
        return;
      }

      if (type === "join") {
        if (!s.paired && Date.now() - s.createdAt > PAIR_OFFER_TTL_MS) {
          sessions.delete(id);
          send(ws, { type: "joined", ok: false, reason: "expired" });
          return;
        }
        if (role && role !== "phone") {
          send(ws, { type: "joined", ok: false, reason: "role_must_be_phone" });
          return;
        }
        // First-time phone join (or phone replacing its socket).
        attachRole(s, "phone", ws, msg.name);
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

      // rejoin — either role, for durable one-time pair
      if (!s.paired) {
        send(ws, { type: "rejoined", ok: false, reason: "not_paired_yet" });
        return;
      }
      if (role !== "pc" && role !== "phone") {
        send(ws, { type: "rejoined", ok: false, reason: "role_required" });
        return;
      }
      attachRole(s, role, ws, msg.name);
      sessionId = id;
      send(ws, { type: "rejoined", ok: true, paired: true });
      if (s.pc && s.phone) {
        const payload = {
          type: "paired",
          pcName: s.pcName,
          phoneName: s.phoneName,
        };
        send(s.pc, payload);
        send(s.phone, payload);
      }
      return;
    }

    // Forward companion protocol messages to peer after pairing.
    if (sessionId) {
      const s = sessions.get(sessionId);
      if (!s || !s.paired) {
        send(ws, { type: "error", reason: "not_paired" });
        return;
      }
      touch(s);
      const other = peerOf(s, ws);
      if (!other) {
        send(ws, { type: "error", reason: "peer_gone" });
        return;
      }
      if (
        ["create", "join", "rejoin", "created", "joined", "rejoined", "paired", "ping", "pong"].includes(
          type,
        )
      ) {
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
  console.log(`aspera-relay listening on :${PORT} (durable pairs enabled)`);
});
