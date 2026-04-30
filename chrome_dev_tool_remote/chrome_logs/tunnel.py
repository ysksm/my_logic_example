"""SSH port forwarding for Chrome remote debugging using paramiko."""

from __future__ import annotations

import select
import socket
import threading
from typing import Any

import paramiko


class SSHTunnel:
    """SSH local port forwarding using paramiko (supports password auth)."""

    def __init__(
        self,
        ssh_host: str,
        remote_port: int = 9222,
        local_port: int = 9222,
        ssh_port: int = 22,
        ssh_user: str | None = None,
        ssh_password: str | None = None,
        ssh_key: str | None = None,
    ):
        self.ssh_host = ssh_host
        self.remote_port = remote_port
        self.local_port = local_port
        self.ssh_port = ssh_port
        self.ssh_user = ssh_user
        self.ssh_password = ssh_password
        self.ssh_key = ssh_key
        self._client: paramiko.SSHClient | None = None
        self._server_socket: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    @property
    def is_active(self) -> bool:
        return (
            self._client is not None
            and self._client.get_transport() is not None
            and self._client.get_transport().is_active()
        )

    def start(self) -> None:
        """Start SSH port forwarding in background."""
        if self.is_active:
            return

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        connect_kwargs: dict[str, Any] = {
            "hostname": self.ssh_host,
            "port": self.ssh_port,
            "timeout": 10,
        }
        if self.ssh_user:
            connect_kwargs["username"] = self.ssh_user
        if self.ssh_password:
            connect_kwargs["password"] = self.ssh_password
        if self.ssh_key:
            connect_kwargs["key_filename"] = self.ssh_key

        try:
            client.connect(**connect_kwargs)
        except Exception as e:
            client.close()
            raise RuntimeError(f"SSH connection failed: {e}") from e

        self._client = client
        self._stop_event.clear()

        # Start local forwarding server
        self._server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server_socket.bind(("localhost", self.local_port))
        self._server_socket.listen(5)
        self._server_socket.settimeout(1.0)

        self._thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._thread.start()

    def _accept_loop(self) -> None:
        """Accept incoming connections and forward them."""
        while not self._stop_event.is_set():
            try:
                conn, addr = self._server_socket.accept()
            except socket.timeout:
                continue
            except OSError:
                break

            transport = self._client.get_transport()
            if transport is None or not transport.is_active():
                conn.close()
                break

            try:
                channel = transport.open_channel(
                    "direct-tcpip",
                    ("localhost", self.remote_port),
                    addr,
                )
            except Exception:
                conn.close()
                continue

            t = threading.Thread(
                target=self._forward, args=(conn, channel), daemon=True
            )
            t.start()

    @staticmethod
    def _forward(local_sock: socket.socket, channel: paramiko.Channel) -> None:
        """Bidirectionally forward data between local socket and SSH channel."""
        try:
            while True:
                r, _, _ = select.select([local_sock, channel], [], [], 1.0)
                if local_sock in r:
                    data = local_sock.recv(65536)
                    if not data:
                        break
                    channel.sendall(data)
                if channel in r:
                    data = channel.recv(65536)
                    if not data:
                        break
                    local_sock.sendall(data)
        except Exception:
            pass
        finally:
            channel.close()
            local_sock.close()

    def stop(self) -> None:
        """Stop SSH port forwarding."""
        self._stop_event.set()
        if self._server_socket:
            try:
                self._server_socket.close()
            except Exception:
                pass
            self._server_socket = None
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None
        if self._client:
            self._client.close()
            self._client = None

    def __del__(self):
        self.stop()

    def __repr__(self) -> str:
        status = "active" if self.is_active else "inactive"
        return (
            f"SSHTunnel({status}: "
            f"localhost:{self.local_port} -> "
            f"{self.ssh_host}:{self.remote_port})"
        )
