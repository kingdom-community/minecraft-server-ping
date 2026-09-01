# @kingdom-community/minecraft-server-ping

A zero-dependency TypeScript implementation of the Minecraft **Server List
Ping** protocol. Point it at a host and it opens a TCP socket, speaks the
handshake/request/response exchange by hand over `node:net`, and hands back the
server's MOTD, player count, version, favicon and the round-trip latency — or a
plain "offline" value when the server is unreachable, silent, or answering with
something that is not the protocol.
