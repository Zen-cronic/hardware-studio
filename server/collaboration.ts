import { Server, type Hocuspocus } from "@hocuspocus/server";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import * as Y from "yjs";
import { Store } from "./store";

export const ROOM_MESSAGE_LIMIT = 65_536;
export const NOTES_MESSAGE_LIMIT = 1_000_000;

class ManagedCollaborationServer extends Server {
  private sockets = new Set<WebSocket>();
  private closing?: Promise<void>;
  private stopAccepting: () => void;

  constructor(store: Store, port: number, address: string) {
    let stopping = false;
    const requireOpen = () => {
      if (stopping) throw { code: 1012, reason: "Collaboration is restarting." };
    };
    super({
      port, address, quiet: true, stopOnSignals: false, debounce: 500, maxDebounce: 1500,
      async onConnect() { requireOpen(); },
      async onAuthenticate({ documentName, token, connectionConfig }) {
        requireOpen();
        const role = store.authorize(documentName, token);
        connectionConfig.readOnly = role === "viewer";
        return { role };
      },
      async onLoadDocument({ documentName, document }) {
        // Hocuspocus constructs a fresh document before this hook and does not
        // register rejected loads in its map. Release its awareness timer here.
        if (stopping) document.destroy();
        requireOpen();
        const row = store.db.prepare("SELECT content FROM documents WHERE id=?").get(documentName) as { content: Buffer } | undefined;
        if (row) Y.applyUpdate(document, new Uint8Array(row.content));
        return document;
      },
      async beforeHandleMessage({ update }) {
        if (update.byteLength > NOTES_MESSAGE_LIMIT) throw new Error("Shared notes are too large.");
      },
      async onStoreDocument({ documentName, document }) {
        const content = Y.encodeStateAsUpdate(document);
        if (content.byteLength > 2_000_000) throw new Error("Shared notes are too large.");
        store.db.prepare("INSERT INTO documents VALUES(?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content")
          .run(documentName, Buffer.from(content));
      },
    }, { maxPayload: NOTES_MESSAGE_LIMIT });
    this.stopAccepting = () => { stopping = true; };
    // Standalone connections use Server's handler; shared connections enter below.
    this.webSocketServer.on("connection", socket => { this.track(socket); });
  }

  private track(socket: WebSocket) {
    if (this.closing) { socket.close(1012, "Collaboration is restarting."); return; }
    this.sockets.add(socket);
    socket.once("close", () => { this.sockets.delete(socket); });
  }

  handleConnection(socket: WebSocket, request: IncomingMessage) {
    this.track(socket);
    if (!this.closing) this.hocuspocus.handleConnection(socket, request);
  }

  override async listen(port?: number, callback: any = null): Promise<Hocuspocus> {
    if (port !== undefined) this.configuration.port = port;
    if (typeof callback === "function") this.hocuspocus.configuration.extensions.push({ onListen: callback });
    // Bind the actual host explicitly; Node's listen options do not accept "address".
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => { this.httpServer.removeListener("listening", ready); reject(error); };
      const ready = () => { this.httpServer.removeListener("error", failed); resolve(); };
      this.httpServer.once("error", failed);
      this.httpServer.once("listening", ready);
      this.httpServer.listen({ port: this.configuration.port, host: this.configuration.address });
    });
    await this.hocuspocus.hooks("onListen", {
      instance: this.hocuspocus, configuration: this.configuration, port: this.address.port,
    });
    return this.hocuspocus;
  }

  override destroy(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopAccepting();
    this.closing = this.drain();
    return this.closing;
  }

  private async drain() {
    const listenerClosed = new Promise<void>((resolve, reject) => {
      this.httpServer.close(error => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error);
        else resolve();
      });
    });
    // Include unauthenticated sockets, which closeConnections() cannot see yet.
    await Promise.all([...this.sockets].map(socket => new Promise<void>(resolve => {
      if (socket.readyState === 3) { resolve(); return; }
      const timer = setTimeout(() => { socket.terminate(); }, 1000);
      socket.once("close", () => { clearTimeout(timer); resolve(); });
      socket.close(1001, "Server shutting down.");
    })));
    await Promise.allSettled([...this.hocuspocus.loadingDocuments.values()]);
    // The supported wrapper waits for debounced stores and document unload hooks.
    await super.destroy();
    await Promise.allSettled([...this.hocuspocus.unloadingDocuments.values()]);
    await listenerClosed;
  }
}

export function createCollaborationServer(store: Store, port = 4175, address = "127.0.0.1") {
  return new ManagedCollaborationServer(store, port, address);
}
