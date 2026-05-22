'use client';

import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 2000,
      // Cap retry interval at 30s and add 50% jitter so a thundering herd
      // of reconnecting clients doesn't hammer the server simultaneously.
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
      reconnectionAttempts: Infinity,
      // Send the auth cookie on the Socket.IO handshake so cross-origin
      // (Next dev server → API) connections carry the dashboard auth cookie.
      withCredentials: true,
    });
  }
  return socket;
}
