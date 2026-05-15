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
      reconnectionAttempts: Infinity,
      // Send the auth cookie on the Socket.IO handshake so cross-origin
      // (Next dev server → API) connections carry the dashboard auth cookie.
      withCredentials: true,
    });
  }
  return socket;
}
