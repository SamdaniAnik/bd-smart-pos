import { io } from "socket.io-client";

const socket = io(import.meta.env.VITE_SOCKET_URL || "http://127.0.0.1:5001", {
  transports: ["websocket"],
});

export default socket;
