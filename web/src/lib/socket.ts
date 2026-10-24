// Opens the hub's WebSocket (/ws on the same origin) behind the small handler interface both apps use.
export interface SocketHandlers {
  onOpen(send: (msg: string) => void): void;
  onMessage(data: string): void;
  onClose(code: number): void;
}

export interface SocketLike {
  close(): void;
}

export function openBrowserSocket(h: SocketHandlers): SocketLike {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => h.onOpen((msg) => ws.send(msg));
  ws.onmessage = (e) => h.onMessage(String(e.data));
  ws.onclose = (e) => h.onClose(e.code);
  ws.onerror = () => ws.close();
  return { close: () => ws.close() };
}
