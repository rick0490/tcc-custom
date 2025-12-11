#!/usr/bin/env python3
"""
Tournament WebSocket Client

Socket.IO client for real-time tournament updates from admin dashboard.
Provides instant match updates instead of polling.

Events listened:
- matches:update - Match state changes
- tournament:update - Tournament configuration changes
- ticker:message - Ticker messages (for notification)
- display:registered - Connection acknowledgment
"""

import os
import time
import threading
import socketio
from enum import Enum
from typing import Optional, Callable, Dict, Any
from dataclasses import dataclass


class ConnectionStatus(Enum):
    """WebSocket connection status"""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    ERROR = "error"


@dataclass
class ConnectionInfo:
    """Connection status information"""
    status: ConnectionStatus
    last_event_time: float = 0
    reconnect_attempts: int = 0
    error_message: str = ""


class TournamentWebSocket:
    """Socket.IO client for tournament real-time updates

    Connects to admin dashboard WebSocket server and receives
    real-time match updates, eliminating the need for polling.

    Usage:
        ws = TournamentWebSocket(base_url="https://admin.despairhardware.com")
        ws.on_matches_update = my_handler
        ws.connect(device_id="streamdeck-1")
        # ... later
        ws.disconnect()
    """

    def __init__(self, base_url: str = "https://admin.despairhardware.com",
                 api_token: Optional[str] = None,
                 reconnect_delay: float = 1.0,
                 max_reconnect_delay: float = 60.0):
        """Initialize WebSocket client

        Args:
            base_url: Admin dashboard URL (http/https)
            api_token: Optional API token for authentication
            reconnect_delay: Initial reconnection delay in seconds
            max_reconnect_delay: Maximum reconnection delay in seconds
        """
        self.base_url = base_url.rstrip('/')
        self._api_token = api_token or os.environ.get('ADMIN_API_TOKEN')

        # Reconnection settings
        self._reconnect_delay = reconnect_delay
        self._max_reconnect_delay = max_reconnect_delay
        self._current_reconnect_delay = reconnect_delay

        # Connection state
        self._status = ConnectionStatus.DISCONNECTED
        self._device_id: Optional[str] = None
        self._last_event_time = 0
        self._reconnect_attempts = 0
        self._error_message = ""

        # Socket.IO client with automatic reconnection
        self._sio = socketio.Client(
            reconnection=True,
            reconnection_attempts=0,  # Unlimited retries
            reconnection_delay=reconnect_delay,
            reconnection_delay_max=max_reconnect_delay,
            logger=False,
            engineio_logger=False
        )

        # Event callbacks (set by controller)
        self.on_matches_update: Optional[Callable[[Dict[str, Any]], None]] = None
        self.on_tournament_update: Optional[Callable[[Dict[str, Any]], None]] = None
        self.on_ticker_message: Optional[Callable[[Dict[str, Any]], None]] = None
        self.on_connection_change: Optional[Callable[[ConnectionStatus], None]] = None

        # Register internal event handlers
        self._setup_handlers()

        # Thread lock for status updates
        self._lock = threading.Lock()

    def _setup_handlers(self):
        """Set up Socket.IO event handlers"""

        @self._sio.event
        def connect():
            """Handle successful connection"""
            print("[WebSocket] Connected to server")
            self._set_status(ConnectionStatus.CONNECTED)
            self._reconnect_attempts = 0
            self._current_reconnect_delay = self._reconnect_delay

            # Register as Stream Deck device
            if self._device_id:
                self._sio.emit('display:register', {
                    'displayType': 'streamdeck',
                    'displayId': self._device_id
                })
                print(f"[WebSocket] Registered as device: {self._device_id}")

        @self._sio.event
        def disconnect():
            """Handle disconnection"""
            print("[WebSocket] Disconnected from server")
            self._set_status(ConnectionStatus.DISCONNECTED)

        @self._sio.event
        def connect_error(data):
            """Handle connection error"""
            error_msg = str(data) if data else "Unknown error"
            print(f"[WebSocket] Connection error: {error_msg}")
            self._error_message = error_msg
            self._set_status(ConnectionStatus.ERROR)

        @self._sio.on('display:registered')
        def on_display_registered(data):
            """Handle registration acknowledgment"""
            print(f"[WebSocket] Registration confirmed: {data}")
            self._last_event_time = time.time()

        @self._sio.on('matches:update')
        def on_matches_update(data):
            """Handle match updates"""
            self._last_event_time = time.time()
            print(f"[WebSocket] Received matches:update")
            if self.on_matches_update:
                try:
                    self.on_matches_update(data)
                except Exception as e:
                    print(f"[WebSocket] Error in matches:update handler: {e}")

        @self._sio.on('tournament:update')
        def on_tournament_update(data):
            """Handle tournament updates"""
            self._last_event_time = time.time()
            print(f"[WebSocket] Received tournament:update")
            if self.on_tournament_update:
                try:
                    self.on_tournament_update(data)
                except Exception as e:
                    print(f"[WebSocket] Error in tournament:update handler: {e}")

        @self._sio.on('ticker:message')
        def on_ticker_message(data):
            """Handle ticker messages"""
            self._last_event_time = time.time()
            print(f"[WebSocket] Received ticker:message: {data.get('message', '')[:50]}")
            if self.on_ticker_message:
                try:
                    self.on_ticker_message(data)
                except Exception as e:
                    print(f"[WebSocket] Error in ticker:message handler: {e}")

        # Socket.IO reconnection events
        @self._sio.event
        def reconnect_attempt(attempt):
            """Handle reconnection attempt"""
            self._reconnect_attempts = attempt
            self._set_status(ConnectionStatus.RECONNECTING)
            print(f"[WebSocket] Reconnection attempt {attempt}")

        @self._sio.event
        def reconnect():
            """Handle successful reconnection"""
            print("[WebSocket] Reconnected successfully")
            self._set_status(ConnectionStatus.CONNECTED)
            self._reconnect_attempts = 0

            # Re-register device after reconnection
            if self._device_id:
                self._sio.emit('display:register', {
                    'displayType': 'streamdeck',
                    'displayId': self._device_id
                })

    def _set_status(self, status: ConnectionStatus):
        """Update connection status and notify callback"""
        with self._lock:
            if self._status != status:
                self._status = status
                if self.on_connection_change:
                    try:
                        self.on_connection_change(status)
                    except Exception as e:
                        print(f"[WebSocket] Error in connection change handler: {e}")

    def connect(self, device_id: str = "streamdeck-default") -> bool:
        """Connect to WebSocket server

        Args:
            device_id: Unique identifier for this Stream Deck

        Returns:
            True if connection initiated successfully
        """
        if self._sio.connected:
            print("[WebSocket] Already connected")
            return True

        self._device_id = device_id
        self._set_status(ConnectionStatus.CONNECTING)

        try:
            # Build connection URL
            # Socket.IO client handles ws:// vs wss:// based on http:// vs https://
            url = self.base_url

            # Connection headers (API token if available)
            headers = {}
            if self._api_token:
                headers['X-API-Token'] = self._api_token

            print(f"[WebSocket] Connecting to {url}...")

            # Connect with WebSocket transport preferred
            self._sio.connect(
                url,
                headers=headers if headers else None,
                transports=['websocket', 'polling'],  # Prefer WebSocket
                wait_timeout=10
            )

            return True

        except Exception as e:
            print(f"[WebSocket] Connection failed: {e}")
            self._error_message = str(e)
            self._set_status(ConnectionStatus.ERROR)
            return False

    def disconnect(self):
        """Disconnect from WebSocket server"""
        if self._sio.connected:
            print("[WebSocket] Disconnecting...")
            try:
                self._sio.disconnect()
            except Exception as e:
                print(f"[WebSocket] Disconnect error: {e}")
        self._set_status(ConnectionStatus.DISCONNECTED)

    def is_connected(self) -> bool:
        """Check if currently connected"""
        return self._sio.connected and self._status == ConnectionStatus.CONNECTED

    def get_status(self) -> ConnectionInfo:
        """Get current connection status"""
        with self._lock:
            return ConnectionInfo(
                status=self._status,
                last_event_time=self._last_event_time,
                reconnect_attempts=self._reconnect_attempts,
                error_message=self._error_message
            )

    def request_matches(self):
        """Request current match data from server"""
        if self._sio.connected:
            self._sio.emit('matches:request')
            print("[WebSocket] Requested matches data")

    def wait(self):
        """Wait for WebSocket connection (blocking)

        Use this in the main thread if you want to keep
        the connection alive without other activity.
        """
        try:
            self._sio.wait()
        except KeyboardInterrupt:
            self.disconnect()


# Standalone test
if __name__ == "__main__":
    import sys

    print("Testing Tournament WebSocket Client")
    print("=" * 50)

    # Get URL from args or use default
    url = sys.argv[1] if len(sys.argv) > 1 else "https://admin.despairhardware.com"

    def on_matches(data):
        print(f"  Matches received: {len(data.get('matches', []))} matches")

    def on_tournament(data):
        print(f"  Tournament: {data.get('name', 'Unknown')}")

    def on_status(status):
        print(f"  Status changed: {status.value}")

    ws = TournamentWebSocket(base_url=url)
    ws.on_matches_update = on_matches
    ws.on_tournament_update = on_tournament
    ws.on_connection_change = on_status

    print(f"\nConnecting to {url}...")
    if ws.connect(device_id="test-streamdeck"):
        print("Connection initiated. Press Ctrl+C to exit.\n")
        try:
            ws.wait()
        except KeyboardInterrupt:
            print("\nInterrupted")
    else:
        print("Failed to connect")

    ws.disconnect()
    print("\nTest complete")
