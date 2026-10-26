// Worker: เสิร์ฟไฟล์ static + ห้อง Shared Note ผ่าน WebSocket
//
// /api/note/<ห้อง> -> ส่งต่อไปที่ Durable Object ของห้องนั้น (1 ห้อง = 1 instance)
// ไฟล์อื่นๆ Cloudflare เสิร์ฟจาก assets ให้เอง ไม่ผ่านโค้ดนี้

import { DurableObject } from 'cloudflare:workers';

const MAX_LENGTH = 100_000; // จำกัดขนาดโน้ต กันคนแปะข้อความยักษ์

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/note\/([\w-]{1,40})$/);
    if (!match) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const stub = env.NOTE_ROOM.get(env.NOTE_ROOM.idFromName(match[1].toLowerCase()));
    return stub.fetch(request);
  },
};

export class NoteRoom extends DurableObject {
  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    // hibernation API: ห้องที่ไม่มีใครพิมพ์จะไม่กินเวลา CPU
    this.ctx.acceptWebSocket(server);
    const text = (await this.ctx.storage.get('text')) ?? '';
    server.send(JSON.stringify({ type: 'text', text, online: this.ctx.getWebSockets().length }));
    this.broadcastOnline();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg.type !== 'text' || typeof msg.text !== 'string') return;
    const text = msg.text.slice(0, MAX_LENGTH);
    await this.ctx.storage.put('text', text);
    const out = JSON.stringify({ type: 'text', text });
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) other.send(out);
    }
  }

  webSocketClose(ws) {
    this.broadcastOnline(ws);
  }

  webSocketError(ws) {
    this.broadcastOnline(ws);
  }

  // แจ้งทุกคนว่าตอนนี้มีกี่คนออนไลน์ (leaving = คนที่กำลังออก ไม่นับ)
  broadcastOnline(leaving = null) {
    const sockets = this.ctx.getWebSockets().filter(s => s !== leaving);
    const out = JSON.stringify({ type: 'online', online: sockets.length });
    for (const s of sockets) s.send(out);
  }
}
