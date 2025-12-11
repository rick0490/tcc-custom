#!/usr/bin/env python3
"""
Tournament Stream Deck Controller

Main controller that manages the Stream Deck interface for tournament operations.
Handles different view modes, key layouts, and interaction flows.

15-Key Layout (3 rows x 5 columns):
    [ 0] [ 1] [ 2] [ 3] [ 4]
    [ 5] [ 6] [ 7] [ 8] [ 9]
    [10] [11] [12] [13] [14]
"""

import os
import sys
import json
import time
import threading
from enum import Enum
from dataclasses import dataclass
from typing import Optional, Callable, Dict, List
from PIL import Image, ImageDraw, ImageFont

from hid_device import StreamDeckHID, NUM_KEYS, KEY_IMAGE_SIZE
from api_client import TournamentAPIClient, Match, MatchState
from websocket_client import TournamentWebSocket, ConnectionStatus


# === Color Definitions ===
class Colors:
    # Base colors
    BLACK = (0, 0, 0)
    WHITE = (255, 255, 255)
    GRAY = (60, 60, 60)
    DARK_GRAY = (40, 40, 40)
    LIGHT_GRAY = (120, 120, 120)

    # Semantic colors (from hybrid layout)
    GREEN = (0, 170, 0)          # Active/Underway/Success
    BLUE = (0, 102, 204)         # Ready/Open/Info
    YELLOW = (204, 136, 0)       # Attention/Warning
    RED = (204, 0, 0)            # Danger/Exit/Stop
    PURPLE = (102, 68, 170)      # Navigation/System
    CYAN = (0, 150, 150)         # Refresh/Action
    ORANGE = (200, 100, 0)       # Settings/Config

    # Match states
    MATCH_OPEN = (0, 102, 204)       # Blue - ready to play
    MATCH_UNDERWAY = (0, 170, 0)     # Green - live
    MATCH_COMPLETE = (60, 60, 60)    # Gray - done
    MATCH_PENDING = (26, 26, 26)     # Dark - waiting

    # Button states
    BTN_NORMAL = (40, 40, 40)
    BTN_DISABLED = (26, 26, 26)
    BTN_NAV = (102, 68, 170)         # Purple for navigation
    BTN_ACTION = (0, 102, 204)       # Blue for actions
    BTN_DANGER = (204, 0, 0)         # Red for danger
    BTN_SUCCESS = (0, 170, 0)        # Green for success


# === View Modes ===
class ViewMode(Enum):
    MAIN = "main"                    # Main overview with matches
    MATCH_CONTROL = "match_control"  # Control a specific match
    SCORE_ENTRY = "score_entry"      # Enter scores
    TICKER = "ticker"                # Send ticker messages
    CONFIRM = "confirm"              # Confirmation dialog


# === Key Definitions ===
@dataclass
class KeyConfig:
    """Configuration for a single key"""
    index: int
    label: str
    icon: str = ""
    bg_color: tuple = Colors.DARK_GRAY
    text_color: tuple = Colors.WHITE
    action: Optional[str] = None
    data: Optional[dict] = None


class TournamentController:
    """Main controller for Stream Deck tournament operations"""

    def __init__(self, config_path: str = "config.json"):
        self.deck = StreamDeckHID()
        self.api = TournamentAPIClient()
        self.config_path = config_path
        self.config = self._load_config()

        # State
        self.current_mode = ViewMode.MAIN
        self.selected_match: Optional[Match] = None
        self.pending_scores = [0, 0]  # [P1, P2] scores for entry
        self.confirm_action: Optional[Callable] = None
        self.confirm_message = ""

        # Key state
        self.key_configs: Dict[int, KeyConfig] = {}
        self.key_long_press_timers: Dict[int, float] = {}
        self.long_press_threshold = 0.8  # seconds

        # Polling - Adaptive intervals
        self._running = False
        self._poll_thread: Optional[threading.Thread] = None
        self._poll_interval_active = 2.0    # Fast polling when user is active
        self._poll_interval_idle = 10.0     # Slow polling when idle
        self._api_poll_interval = self._poll_interval_idle
        self._last_api_poll = 0

        # Activity tracking for adaptive polling
        self._last_user_action = 0
        self._active_timeout = 30.0  # Consider idle after 30s of no interaction

        # Async refresh state
        self._refresh_pending = False
        self._refresh_lock = threading.Lock()

        # WebSocket state
        self._websocket: Optional[TournamentWebSocket] = None
        self._ws_enabled = True  # Can be disabled via config
        self._ws_connected = False
        self._ws_last_event = 0

        # Fonts (loaded lazily)
        self._fonts: Dict[int, ImageFont.FreeTypeFont] = {}

    def _load_config(self) -> dict:
        """Load configuration from file"""
        default_config = {
            "admin_url": "https://admin.despairhardware.com",
            "station_filter": None,  # e.g., "TV 1" to only show TV 1 matches
            "brightness": 80,
            "poll_interval": 5,
            "websocket_enabled": True,
            "websocket_reconnect_delay": 1,
            "websocket_max_reconnect_delay": 60,
            "poll_fallback_interval": 5,
            "ticker_presets": [
                {"label": "5m Break", "message": "5 MINUTE BREAK", "duration": 10},
                {"label": "Report", "message": "PLAYERS REPORT TO YOUR STATIONS", "duration": 8},
                {"label": "Starting", "message": "MATCHES STARTING SOON", "duration": 8},
                {"label": "Finals", "message": "GRAND FINALS STARTING NOW", "duration": 10}
            ]
        }

        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, 'r') as f:
                    loaded = json.load(f)
                    default_config.update(loaded)
            except Exception as e:
                print(f"[Config] Error loading config: {e}")

        return default_config

    def _save_config(self):
        """Save configuration to file"""
        try:
            with open(self.config_path, 'w') as f:
                json.dump(self.config, f, indent=2)
        except Exception as e:
            print(f"[Config] Error saving config: {e}")

    def _get_font(self, size: int) -> ImageFont.FreeTypeFont:
        """Get or load a font at the specified size"""
        if size not in self._fonts:
            font_paths = [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
            ]
            for path in font_paths:
                if os.path.exists(path):
                    try:
                        self._fonts[size] = ImageFont.truetype(path, size)
                        break
                    except:
                        continue
            if size not in self._fonts:
                self._fonts[size] = ImageFont.load_default()
        return self._fonts[size]

    def _create_key_image(self,
                          text: str,
                          bg_color: tuple = Colors.DARK_GRAY,
                          text_color: tuple = Colors.WHITE,
                          icon: str = "",
                          subtext: str = "",
                          icon_color: Optional[tuple] = None) -> Image.Image:
        """Create a key image with optional icon and subtext"""
        img = Image.new('RGB', (KEY_IMAGE_SIZE, KEY_IMAGE_SIZE), bg_color)
        draw = ImageDraw.Draw(img)

        if icon_color is None:
            icon_color = text_color

        if icon:
            # Large icon with small label below
            icon_font = self._get_font(24)
            text_font = self._get_font(9)

            # Draw icon
            bbox = draw.textbbox((0, 0), icon, font=icon_font)
            icon_width = bbox[2] - bbox[0]
            icon_x = (KEY_IMAGE_SIZE - icon_width) // 2
            draw.text((icon_x, 10), icon, fill=icon_color, font=icon_font)

            # Draw label
            if text:
                bbox = draw.textbbox((0, 0), text, font=text_font)
                text_width = bbox[2] - bbox[0]
                text_x = (KEY_IMAGE_SIZE - text_width) // 2
                draw.text((text_x, 48), text, fill=text_color, font=text_font)

            # Draw subtext
            if subtext:
                sub_font = self._get_font(8)
                bbox = draw.textbbox((0, 0), subtext, font=sub_font)
                sub_width = bbox[2] - bbox[0]
                sub_x = (KEY_IMAGE_SIZE - sub_width) // 2
                draw.text((sub_x, 60), subtext, fill=Colors.LIGHT_GRAY, font=sub_font)
        else:
            # Text only, potentially multiline
            lines = text.split('\n')
            font = self._get_font(11 if len(lines) > 1 else 13)

            total_height = len(lines) * 14
            start_y = (KEY_IMAGE_SIZE - total_height) // 2

            for i, line in enumerate(lines):
                bbox = draw.textbbox((0, 0), line, font=font)
                line_width = bbox[2] - bbox[0]
                x = (KEY_IMAGE_SIZE - line_width) // 2
                y = start_y + (i * 14)
                draw.text((x, y), line, fill=text_color, font=font)

            if subtext:
                sub_font = self._get_font(8)
                bbox = draw.textbbox((0, 0), subtext, font=sub_font)
                sub_width = bbox[2] - bbox[0]
                sub_x = (KEY_IMAGE_SIZE - sub_width) // 2
                draw.text((sub_x, 58), subtext, fill=Colors.LIGHT_GRAY, font=sub_font)

        return img

    def _create_match_key(self, match: Match, key_index: int) -> Image.Image:
        """Create a key image for a match"""
        # Determine background color based on state
        if match.is_underway:
            bg_color = Colors.MATCH_UNDERWAY
            status = "LIVE"
        elif match.state == MatchState.OPEN:
            bg_color = Colors.MATCH_OPEN
            status = "OPEN"
        elif match.state == MatchState.COMPLETE:
            bg_color = Colors.MATCH_COMPLETE
            status = "DONE"
        else:
            bg_color = Colors.MATCH_PENDING
            status = "WAIT"

        # Get player names (truncated)
        p1_name = (match.player1.name[:8] if match.player1 else "TBD")
        p2_name = (match.player2.name[:8] if match.player2 else "TBD")

        img = Image.new('RGB', (KEY_IMAGE_SIZE, KEY_IMAGE_SIZE), bg_color)
        draw = ImageDraw.Draw(img)

        # Status badge
        status_font = self._get_font(8)
        draw.text((4, 2), status, fill=Colors.WHITE, font=status_font)

        # Round indicator
        round_text = match.round_name[:6] if match.round_name else f"R{match.round}"
        bbox = draw.textbbox((0, 0), round_text, font=status_font)
        draw.text((KEY_IMAGE_SIZE - bbox[2] - 4, 2), round_text, fill=Colors.LIGHT_GRAY, font=status_font)

        # Player names
        name_font = self._get_font(10)
        draw.text((4, 18), p1_name, fill=Colors.WHITE, font=name_font)
        draw.text((4, 32), "vs", fill=Colors.LIGHT_GRAY, font=self._get_font(8))
        draw.text((4, 44), p2_name, fill=Colors.WHITE, font=name_font)

        # Score (if has score)
        if match.player1_score > 0 or match.player2_score > 0:
            score_text = f"{match.player1_score}-{match.player2_score}"
            score_font = self._get_font(12)
            bbox = draw.textbbox((0, 0), score_text, font=score_font)
            draw.text((KEY_IMAGE_SIZE - bbox[2] - 4, 56), score_text, fill=Colors.WHITE, font=score_font)

        # Station indicator
        if match.station_name:
            station_text = match.station_name
            station_font = self._get_font(8)
            bbox = draw.textbbox((0, 0), station_text, font=station_font)
            draw.text((4, 58), station_text, fill=Colors.YELLOW, font=station_font)

        return img

    def _update_key(self, key_index: int, config: KeyConfig):
        """Update a single key with configuration"""
        self.key_configs[key_index] = config

        if config.icon:
            img = self._create_key_image(
                config.label,
                bg_color=config.bg_color,
                text_color=config.text_color,
                icon=config.icon
            )
        else:
            img = self._create_key_image(
                config.label,
                bg_color=config.bg_color,
                text_color=config.text_color
            )

        self.deck.set_key_image(key_index, img)

    def _update_key_with_image(self, key_index: int, image: Image.Image, config: Optional[KeyConfig] = None):
        """Update a key with a pre-built image"""
        if config:
            self.key_configs[key_index] = config
        self.deck.set_key_image(key_index, image)

    # === View Rendering ===

    def render_main_view(self):
        """Render main view with hybrid layout (3 rows x 5 columns)

        Layout:
        [ 0] [ 1] [ 2] [ 3] [ 4]   Live1, Live2, Open1, Open2, Open3
        [ 5] [ 6] [ 7] [ 8] [ 9]   Prev, Refresh, Next, Ticker, ANNOUNCE
        [10] [11] [12] [13] [14]   Station, Stats, Bright, HOME, Exit
        """
        self.current_mode = ViewMode.MAIN

        # Get matches - separate underway (live) from open
        underway_matches = self.api.get_underway_matches()
        open_matches = [m for m in self.api.get_open_matches(limit=10) if not m.is_underway]

        # Row 0: Keys 0-4 = Live matches (0-1) + Open matches (2-4)
        for i in range(2):
            if i < len(underway_matches):
                match = underway_matches[i]
                img = self._create_match_key(match, i)
                config = KeyConfig(
                    index=i,
                    label=match.display_name,
                    action="select_match",
                    data={"match_id": match.id}
                )
                self._update_key_with_image(i, img, config)
            else:
                self._update_key(i, KeyConfig(
                    index=i,
                    label="No Live",
                    bg_color=Colors.BTN_DISABLED,
                    text_color=Colors.LIGHT_GRAY
                ))

        # Keys 2-4: Open matches
        for i in range(3):
            key_idx = 2 + i
            if i < len(open_matches):
                match = open_matches[i]
                img = self._create_match_key(match, key_idx)
                config = KeyConfig(
                    index=key_idx,
                    label=match.display_name,
                    action="select_match",
                    data={"match_id": match.id}
                )
                self._update_key_with_image(key_idx, img, config)
            else:
                self._update_key(key_idx, KeyConfig(
                    index=key_idx,
                    label="---",
                    bg_color=Colors.BTN_DISABLED
                ))

        # Row 1: Keys 5-9 = Navigation + Actions
        self._update_key(5, KeyConfig(
            index=5,
            label="Prev",
            icon="<",
            bg_color=Colors.BTN_NAV,
            action="prev_page"
        ))

        self._update_key(6, KeyConfig(
            index=6,
            label="Refresh",
            icon="R",
            bg_color=Colors.CYAN,
            action="refresh"
        ))

        self._update_key(7, KeyConfig(
            index=7,
            label="Next",
            icon=">",
            bg_color=Colors.BTN_NAV,
            action="next_page"
        ))

        self._update_key(8, KeyConfig(
            index=8,
            label="Ticker",
            icon="T",
            bg_color=Colors.BTN_ACTION,
            action="show_ticker"
        ))

        # Quick Announce (sends first ticker preset)
        presets = self.config.get('ticker_presets', [])
        first_preset = presets[0] if presets else {'label': 'Announce', 'message': 'ATTENTION', 'duration': 5}
        self._update_key(9, KeyConfig(
            index=9,
            label="ANNOUNCE",
            icon="!",
            bg_color=Colors.YELLOW,
            action="quick_announce",
            data=first_preset
        ))

        # Row 2: Keys 10-14 = Settings + Nav anchors
        station = self.config.get('station_filter', 'All')
        self._update_key(10, KeyConfig(
            index=10,
            label=station or "All",
            icon="S",
            bg_color=Colors.ORANGE,
            action="cycle_station"
        ))

        # Connection status indicator (key 11)
        # Shows WebSocket/polling status and match stats
        state = self.api.state
        stats = f"{state.completed_matches}/{state.total_matches}"
        live_count = len(underway_matches)

        if self._ws_connected:
            # WebSocket connected - GREEN
            conn_label = f"WS:{live_count}" if live_count > 0 else "WS"
            conn_color = Colors.GREEN
            conn_icon = "~"  # Wave for WebSocket
        elif self._ws_enabled:
            # WebSocket enabled but not connected (using polling) - YELLOW
            conn_label = f"POLL:{live_count}" if live_count > 0 else "POLL"
            conn_color = Colors.YELLOW
            conn_icon = "?"
        else:
            # WebSocket disabled - PURPLE
            conn_label = f"HTTP:{live_count}" if live_count > 0 else stats
            conn_color = Colors.PURPLE
            conn_icon = "#"

        self._update_key(11, KeyConfig(
            index=11,
            label=conn_label,
            icon=conn_icon,
            bg_color=conn_color
        ))

        brightness = self.config.get('brightness', 80)
        self._update_key(12, KeyConfig(
            index=12,
            label=f"{brightness}%",
            icon="B",
            bg_color=Colors.GRAY,
            action="adjust_brightness"
        ))

        self._update_key(13, KeyConfig(
            index=13,
            label="HOME",
            icon="H",
            bg_color=Colors.BTN_NAV,
            action="home"
        ))

        self._update_key(14, KeyConfig(
            index=14,
            label="Exit",
            icon="X",
            bg_color=Colors.BTN_DANGER,
            action="exit"
        ))

    def render_match_control_view(self):
        """Render match control view with hybrid layout (3 rows x 5 columns)

        Layout:
        [ 0] [ 1] [ 2] [ 3] [ 4]   P1, Score, P2, P1 Win, P2 Win
        [ 5] [ 6] [ 7] [ 8] [ 9]   +1 P1, Scores, +1 P2, Start/Stop, Forfeit
        [10] [11] [12] [13] [14]   TV 1, TV 2, Back, HOME, Reopen
        """
        if not self.selected_match:
            self.render_main_view()
            return

        self.current_mode = ViewMode.MATCH_CONTROL
        match = self.selected_match

        # Row 0: Keys 0-4 = Players, Score, Quick Winners
        p1_name = match.player1.name[:10] if match.player1 else "TBD"
        p2_name = match.player2.name[:10] if match.player2 else "TBD"

        self._update_key(0, KeyConfig(
            index=0,
            label=p1_name,
            bg_color=Colors.BLUE,
            text_color=Colors.WHITE
        ))

        self._update_key(1, KeyConfig(
            index=1,
            label=match.score_display,
            bg_color=Colors.DARK_GRAY,
            action="show_score_entry"
        ))

        self._update_key(2, KeyConfig(
            index=2,
            label=p2_name,
            bg_color=Colors.RED,
            text_color=Colors.WHITE
        ))

        self._update_key(3, KeyConfig(
            index=3,
            label="P1 Win",
            icon="W",
            bg_color=Colors.BLUE,
            action="quick_winner_p1"
        ))

        self._update_key(4, KeyConfig(
            index=4,
            label="P2 Win",
            icon="W",
            bg_color=Colors.RED,
            action="quick_winner_p2"
        ))

        # Row 1: Keys 5-9 = Quick scores, Start/Stop, Forfeit
        self._update_key(5, KeyConfig(
            index=5,
            label="+1 P1",
            icon="+",
            bg_color=Colors.BLUE,
            action="quick_score_p1"
        ))

        self._update_key(6, KeyConfig(
            index=6,
            label="Scores",
            icon="S",
            bg_color=Colors.PURPLE,
            action="show_score_entry"
        ))

        self._update_key(7, KeyConfig(
            index=7,
            label="+1 P2",
            icon="+",
            bg_color=Colors.RED,
            action="quick_score_p2"
        ))

        if match.is_underway:
            self._update_key(8, KeyConfig(
                index=8,
                label="STOP",
                icon="||",
                bg_color=Colors.ORANGE,
                action="unmark_underway"
            ))
        else:
            self._update_key(8, KeyConfig(
                index=8,
                label="START",
                icon=">",
                bg_color=Colors.BTN_SUCCESS,
                action="mark_underway"
            ))

        self._update_key(9, KeyConfig(
            index=9,
            label="Forfeit",
            icon="X",
            bg_color=Colors.GRAY,
            action="show_forfeit"
        ))

        # Row 2: Keys 10-14 = Stations + Navigation
        stations = self.api.state.stations
        for i in range(2):
            key_idx = 10 + i
            if i < len(stations):
                station = stations[i]
                is_assigned = match.station_name == station.name
                self._update_key(key_idx, KeyConfig(
                    index=key_idx,
                    label=station.name,
                    bg_color=Colors.YELLOW if is_assigned else Colors.GRAY,
                    action="assign_station",
                    data={"station_id": station.id, "station_name": station.name}
                ))
            else:
                self._update_key(key_idx, KeyConfig(
                    index=key_idx,
                    label="---",
                    bg_color=Colors.BTN_DISABLED
                ))

        self._update_key(12, KeyConfig(
            index=12,
            label="Back",
            icon="<",
            bg_color=Colors.BTN_NAV,
            action="back_to_main"
        ))

        self._update_key(13, KeyConfig(
            index=13,
            label="HOME",
            icon="H",
            bg_color=Colors.BTN_NAV,
            action="home"
        ))

        self._update_key(14, KeyConfig(
            index=14,
            label="Reopen",
            icon="O",
            bg_color=Colors.YELLOW,
            action="reopen_match"
        ))

    def render_score_entry_view(self):
        """Render score entry view with consistent nav (3 rows x 5 columns)

        Layout:
        [ 0] [ 1] [ 2] [ 3] [ 4]   P1, -1 P1, P1:X, +1 P1, P2
        [ 5] [ 6] [ 7] [ 8] [ 9]   Score, -1 P2, P2:X, +1 P2, Winner
        [10] [11] [12] [13] [14]   Clear, Submit, Back, HOME, Cancel
        """
        if not self.selected_match:
            self.render_main_view()
            return

        self.current_mode = ViewMode.SCORE_ENTRY
        match = self.selected_match

        # Row 0: Keys 0-4 = P1 name + P1 score controls + P2 name
        p1_name = match.player1.name[:10] if match.player1 else "TBD"
        p2_name = match.player2.name[:10] if match.player2 else "TBD"

        self._update_key(0, KeyConfig(
            index=0,
            label=p1_name,
            bg_color=Colors.BLUE
        ))

        self._update_key(1, KeyConfig(
            index=1,
            label="-1",
            icon="-",
            bg_color=Colors.BLUE,
            action="p1_score_down"
        ))

        self._update_key(2, KeyConfig(
            index=2,
            label=f"P1:{self.pending_scores[0]}",
            bg_color=Colors.BLUE
        ))

        self._update_key(3, KeyConfig(
            index=3,
            label="+1",
            icon="+",
            bg_color=Colors.BLUE,
            action="p1_score_up"
        ))

        self._update_key(4, KeyConfig(
            index=4,
            label=p2_name,
            bg_color=Colors.RED
        ))

        # Row 1: Keys 5-9 = Total score + P2 controls + Winner
        score_display = f"{self.pending_scores[0]} - {self.pending_scores[1]}"
        self._update_key(5, KeyConfig(
            index=5,
            label=score_display,
            bg_color=Colors.DARK_GRAY
        ))

        self._update_key(6, KeyConfig(
            index=6,
            label="-1",
            icon="-",
            bg_color=Colors.RED,
            action="p2_score_down"
        ))

        self._update_key(7, KeyConfig(
            index=7,
            label=f"P2:{self.pending_scores[1]}",
            bg_color=Colors.RED
        ))

        self._update_key(8, KeyConfig(
            index=8,
            label="+1",
            icon="+",
            bg_color=Colors.RED,
            action="p2_score_up"
        ))

        self._update_key(9, KeyConfig(
            index=9,
            label="Winner",
            icon="W",
            bg_color=Colors.BTN_SUCCESS,
            action="declare_winner"
        ))

        # Row 2: Keys 10-14 = Actions + Navigation
        self._update_key(10, KeyConfig(
            index=10,
            label="Clear",
            icon="0",
            bg_color=Colors.GRAY,
            action="clear_scores"
        ))

        self._update_key(11, KeyConfig(
            index=11,
            label="Submit",
            icon="U",
            bg_color=Colors.CYAN,
            action="submit_score"
        ))

        self._update_key(12, KeyConfig(
            index=12,
            label="Back",
            icon="<",
            bg_color=Colors.BTN_NAV,
            action="back_to_match"
        ))

        self._update_key(13, KeyConfig(
            index=13,
            label="HOME",
            icon="H",
            bg_color=Colors.BTN_NAV,
            action="home"
        ))

        self._update_key(14, KeyConfig(
            index=14,
            label="Cancel",
            icon="X",
            bg_color=Colors.BTN_DANGER,
            action="cancel_score"
        ))

    def render_ticker_view(self):
        """Render ticker message view with consistent nav (3 rows x 5 columns)

        Layout:
        [ 0] [ 1] [ 2] [ 3] [ 4]   5 Min, Report, Starting, Finals, Check-In
        [ 5] [ 6] [ 7] [ 8] [ 9]   Last Call, (more presets or empty...)
        [10] [11] [12] [13] [14]   --, --, Back, HOME, Cancel
        """
        self.current_mode = ViewMode.TICKER

        presets = self.config.get('ticker_presets', [])

        # Rows 0-1: Preset messages (keys 0-9)
        for i in range(10):
            if i < len(presets):
                preset = presets[i]
                self._update_key(i, KeyConfig(
                    index=i,
                    label=preset['label'],
                    bg_color=Colors.BTN_ACTION,
                    action="send_ticker",
                    data=preset
                ))
            else:
                self._update_key(i, KeyConfig(
                    index=i,
                    label="---",
                    bg_color=Colors.BTN_DISABLED
                ))

        # Row 2: Reserved slots + Navigation (keys 10-14)
        self._update_key(10, KeyConfig(
            index=10,
            label="---",
            bg_color=Colors.BTN_DISABLED
        ))

        self._update_key(11, KeyConfig(
            index=11,
            label="---",
            bg_color=Colors.BTN_DISABLED
        ))

        self._update_key(12, KeyConfig(
            index=12,
            label="Back",
            icon="<",
            bg_color=Colors.BTN_NAV,
            action="back_to_main"
        ))

        self._update_key(13, KeyConfig(
            index=13,
            label="HOME",
            icon="H",
            bg_color=Colors.BTN_NAV,
            action="home"
        ))

        self._update_key(14, KeyConfig(
            index=14,
            label="Cancel",
            icon="X",
            bg_color=Colors.BTN_DANGER,
            action="back_to_main"
        ))

    def render_confirm_view(self):
        """Render confirmation dialog"""
        self.current_mode = ViewMode.CONFIRM

        # Clear all keys
        for i in range(NUM_KEYS):
            self._update_key(i, KeyConfig(
                index=i,
                label="",
                bg_color=Colors.BLACK
            ))

        # Message (center area)
        self._update_key(4, KeyConfig(
            index=4,
            label=self.confirm_message[:12],
            bg_color=Colors.DARK_GRAY
        ))

        # Confirm button
        self._update_key(9, KeyConfig(
            index=9,
            label="Confirm",
            icon="Y",
            bg_color=Colors.GREEN,
            action="confirm_yes"
        ))

        # Cancel button
        self._update_key(11, KeyConfig(
            index=11,
            label="Cancel",
            icon="N",
            bg_color=Colors.RED,
            action="confirm_no"
        ))

    # === Key Press Handlers ===

    def on_key_press(self, key_index: int, pressed: bool):
        """Handle key press/release events"""
        if pressed:
            self.key_long_press_timers[key_index] = time.time()
            # Track user activity for adaptive polling
            self._last_user_action = time.time()
            self._api_poll_interval = self._poll_interval_active  # Speed up polling
        else:
            # Check for long press
            press_time = self.key_long_press_timers.get(key_index, time.time())
            duration = time.time() - press_time

            if duration >= self.long_press_threshold:
                self._handle_long_press(key_index)
            else:
                self._handle_short_press(key_index)

    def _handle_short_press(self, key_index: int):
        """Handle a short key press"""
        config = self.key_configs.get(key_index)
        if not config or not config.action:
            return

        action = config.action
        data = config.data or {}

        print(f"[Key] Action: {action} (data: {data})")

        # Route action based on current mode and action type
        if action == "select_match":
            self._action_select_match(data.get('match_id'))
        elif action == "back_to_main":
            self.render_main_view()
        elif action == "back_to_match":
            self.render_match_control_view()
        elif action == "home":
            # Home button - always goes to main view
            self.selected_match = None
            self.render_main_view()
        elif action == "refresh":
            self._action_refresh()
        elif action == "refresh_match":
            self._action_refresh_match()
        elif action == "show_ticker":
            self.render_ticker_view()
        elif action == "show_score_entry":
            self._action_show_score_entry()
        elif action == "exit":
            self._action_exit()
        elif action == "quick_announce":
            self._action_send_ticker(data)
        elif action == "quick_score_p1":
            self._action_quick_score(0)
        elif action == "quick_score_p2":
            self._action_quick_score(1)

        # Match control actions
        elif action == "mark_underway":
            self._action_mark_underway()
        elif action == "unmark_underway":
            self._action_unmark_underway()
        elif action == "quick_winner_p1":
            self._action_quick_winner(1)
        elif action == "quick_winner_p2":
            self._action_quick_winner(2)
        elif action == "reopen_match":
            self._action_reopen_match()
        elif action == "assign_station":
            self._action_assign_station(data.get('station_id'), data.get('station_name'))

        # Score entry actions
        elif action == "p1_score_up":
            self._action_adjust_score(0, 1)
        elif action == "p1_score_down":
            self._action_adjust_score(0, -1)
        elif action == "p2_score_up":
            self._action_adjust_score(1, 1)
        elif action == "p2_score_down":
            self._action_adjust_score(1, -1)
        elif action == "clear_scores":
            self.pending_scores = [0, 0]
            self.render_score_entry_view()
        elif action == "submit_score":
            self._action_submit_score()
        elif action == "declare_winner":
            self._action_declare_winner()
        elif action == "cancel_score":
            self.render_match_control_view()

        # Ticker actions
        elif action == "send_ticker":
            self._action_send_ticker(data)

        # Confirm actions
        elif action == "confirm_yes":
            if self.confirm_action:
                self.confirm_action()
            self.confirm_action = None
            self.render_main_view()
        elif action == "confirm_no":
            self.confirm_action = None
            self.render_main_view()

        # Settings actions
        elif action == "cycle_station":
            self._action_cycle_station()
        elif action == "adjust_brightness":
            self._action_adjust_brightness()

    def _handle_long_press(self, key_index: int):
        """Handle a long key press"""
        config = self.key_configs.get(key_index)
        if not config:
            return

        # Long press on match = quick start (mark underway)
        if config.action == "select_match" and config.data:
            match_id = config.data.get('match_id')
            if match_id:
                print(f"[Key] Long press: Quick start match {match_id}")
                self.api.mark_underway(match_id)
                self._action_refresh()

    # === Action Implementations ===

    def _action_select_match(self, match_id: int):
        """Select a match for control"""
        self.selected_match = self.api.get_match_by_id(match_id)
        if self.selected_match:
            self.pending_scores = [
                self.selected_match.player1_score,
                self.selected_match.player2_score
            ]
            self.render_match_control_view()

    def _action_refresh(self):
        """Refresh tournament data (async - runs in background)"""
        print("[Controller] Refresh requested...")
        # Queue async refresh - don't block UI
        self._queue_async_refresh()

    def _action_refresh_match(self):
        """Refresh current match view from cache (no API call)"""
        if self.selected_match:
            # Just update from existing cache - the background poll will refresh data
            self.selected_match = self.api.get_match_by_id(self.selected_match.id)
            self.render_match_control_view()

    def _queue_async_refresh(self):
        """Queue an async refresh to run in background"""
        with self._refresh_lock:
            if self._refresh_pending:
                return  # Already a refresh pending
            self._refresh_pending = True

        def do_refresh():
            try:
                print("[Controller] Background refresh starting...")
                self.api.refresh_state()
                print("[Controller] Background refresh complete")

                # Update the current view after refresh
                if self.current_mode == ViewMode.MAIN:
                    self.render_main_view()
                elif self.current_mode == ViewMode.MATCH_CONTROL:
                    if self.selected_match:
                        self.selected_match = self.api.get_match_by_id(self.selected_match.id)
                    self.render_match_control_view()
            except Exception as e:
                print(f"[Controller] Background refresh error: {e}")
            finally:
                with self._refresh_lock:
                    self._refresh_pending = False

        thread = threading.Thread(target=do_refresh, daemon=True)
        thread.start()

    def _action_show_score_entry(self):
        """Show score entry view"""
        if self.selected_match:
            self.pending_scores = [
                self.selected_match.player1_score,
                self.selected_match.player2_score
            ]
            self.render_score_entry_view()

    def _run_api_action(self, api_func, callback=None, *args, **kwargs):
        """Run an API action in background thread with optional callback

        Note: Does NOT auto-refresh anymore - let background poll handle sync.
        This makes the UI feel more responsive.
        """
        def do_action():
            try:
                result = api_func(*args, **kwargs)
                if result and callback:
                    callback()
                # Don't auto-refresh - let background poll handle it
                # This prevents blocking the UI with slow API calls
            except Exception as e:
                print(f"[Controller] API action error: {e}")

        thread = threading.Thread(target=do_action, daemon=True)
        thread.start()

    def _action_mark_underway(self):
        """Mark selected match as underway (async)"""
        if self.selected_match:
            match_id = self.selected_match.id
            # Optimistic UI update - show as underway immediately
            self.selected_match.underway_at = "pending"
            self.render_match_control_view()
            # Run API call in background
            self._run_api_action(self.api.mark_underway, None, match_id)

    def _action_unmark_underway(self):
        """Unmark selected match (async)"""
        if self.selected_match:
            match_id = self.selected_match.id
            # Optimistic UI update
            self.selected_match.underway_at = None
            self.render_match_control_view()
            # Run API call in background
            self._run_api_action(self.api.unmark_underway, None, match_id)

    def _action_quick_winner(self, player_number: int):
        """Quick declare winner (async)"""
        if self.selected_match:
            match_id = self.selected_match.id
            # Show main view immediately (match will disappear after refresh)
            self.selected_match = None
            self.render_main_view()
            # Run API call in background
            self._run_api_action(self.api.quick_winner, None, match_id, player_number)

    def _action_reopen_match(self):
        """Reopen a completed match (async)"""
        if self.selected_match:
            match_id = self.selected_match.id
            # Update view immediately
            self.render_match_control_view()
            # Run API call in background
            self._run_api_action(self.api.reopen_match, None, match_id)

    def _action_quick_score(self, player_idx: int):
        """Quick +1 score for a player (async)"""
        if not self.selected_match:
            return

        match_id = self.selected_match.id

        # Get current scores and increment
        p1_score = self.selected_match.player1_score
        p2_score = self.selected_match.player2_score

        if player_idx == 0:
            p1_score += 1
        else:
            p2_score += 1

        # Optimistic UI update
        self.selected_match.player1_score = p1_score
        self.selected_match.player2_score = p2_score
        self.render_match_control_view()

        # Run API call in background
        self._run_api_action(self.api.update_score, None, match_id, p1_score, p2_score)

    def _action_assign_station(self, station_id: Optional[str], station_name: Optional[str] = None):
        """Assign station to match (async)"""
        if self.selected_match:
            match_id = self.selected_match.id
            # Toggle: if already assigned, unassign
            if self.selected_match.station_name == station_name:
                # Optimistic UI - show as unassigned
                self.selected_match.station_id = None
                self.selected_match.station_name = None
                self.render_match_control_view()
                self._run_api_action(self.api.assign_station, None, match_id, None)
            else:
                # Optimistic UI - show as assigned
                self.selected_match.station_id = station_id
                self.selected_match.station_name = station_name
                self.render_match_control_view()
                self._run_api_action(self.api.assign_station, None, match_id, station_id)

    def _action_adjust_score(self, player_idx: int, delta: int):
        """Adjust pending score"""
        self.pending_scores[player_idx] = max(0, self.pending_scores[player_idx] + delta)
        self.render_score_entry_view()

    def _action_submit_score(self):
        """Submit score to API (async)"""
        if self.selected_match:
            match_id = self.selected_match.id
            p1_score = self.pending_scores[0]
            p2_score = self.pending_scores[1]
            # Optimistic UI - update local match scores
            self.selected_match.player1_score = p1_score
            self.selected_match.player2_score = p2_score
            self.render_match_control_view()
            # Run API call in background
            self._run_api_action(self.api.update_score, None, match_id, p1_score, p2_score)

    def _action_declare_winner(self):
        """Declare winner based on scores (async)"""
        if not self.selected_match:
            return

        p1_score, p2_score = self.pending_scores

        if p1_score == p2_score:
            # Can't declare winner with tied score
            return

        if p1_score > p2_score:
            winner_id = self.selected_match.player1.id if self.selected_match.player1 else None
        else:
            winner_id = self.selected_match.player2.id if self.selected_match.player2 else None

        if winner_id:
            match_id = self.selected_match.id
            # Go back to main view immediately
            self.selected_match = None
            self.render_main_view()
            # Run API call in background
            self._run_api_action(self.api.declare_winner, None, match_id, winner_id, p1_score, p2_score)

    def _action_send_ticker(self, data: dict):
        """Send ticker message (async)"""
        message = data.get('message', '')
        duration = data.get('duration', 5)

        if message:
            print(f"[Ticker] Sending: {message}")
            # Go back to main view immediately
            self.render_main_view()
            # Run API call in background (no refresh needed for ticker)
            def send():
                try:
                    self.api.send_ticker(message, duration)
                    print(f"[Ticker] Sent successfully")
                except Exception as e:
                    print(f"[Ticker] Send error: {e}")
            thread = threading.Thread(target=send, daemon=True)
            thread.start()

    def _action_cycle_station(self):
        """Cycle through station filter options"""
        stations = self.api.state.stations
        station_names = [None] + [s.name for s in stations]  # None = All

        current = self.config.get('station_filter')
        try:
            current_idx = station_names.index(current)
        except ValueError:
            current_idx = 0

        next_idx = (current_idx + 1) % len(station_names)
        self.config['station_filter'] = station_names[next_idx]
        self.api.set_station_filter(station_names[next_idx])
        self._save_config()
        self.render_main_view()

    def _action_adjust_brightness(self):
        """Cycle through brightness levels"""
        levels = [20, 40, 60, 80, 100]
        current = self.config.get('brightness', 80)

        try:
            current_idx = levels.index(current)
        except ValueError:
            current_idx = 3  # Default to 80

        next_idx = (current_idx + 1) % len(levels)
        new_brightness = levels[next_idx]

        self.config['brightness'] = new_brightness
        self.deck.set_brightness(new_brightness)
        self._save_config()
        self.render_main_view()

    def _action_exit(self):
        """Exit the controller"""
        self._running = False

    # === WebSocket Event Handlers ===

    def _on_ws_matches_update(self, data: dict):
        """Handle WebSocket matches:update event"""
        print(f"[WebSocket] Processing matches update...")
        self._ws_last_event = time.time()

        # Update API state from WebSocket data
        if self.api.update_from_websocket_matches(data):
            # Re-render current view with new data
            if self.current_mode == ViewMode.MAIN:
                self.render_main_view()
            elif self.current_mode == ViewMode.MATCH_CONTROL:
                if self.selected_match:
                    # Refresh selected match from updated cache
                    self.selected_match = self.api.get_match_by_id(self.selected_match.id)
                    self.render_match_control_view()

    def _on_ws_tournament_update(self, data: dict):
        """Handle WebSocket tournament:update event"""
        print(f"[WebSocket] Processing tournament update...")
        self._ws_last_event = time.time()

        # Update API state from WebSocket data
        if self.api.update_from_websocket_tournament(data):
            # Re-render if in main view
            if self.current_mode == ViewMode.MAIN:
                self.render_main_view()

    def _on_ws_ticker_message(self, data: dict):
        """Handle WebSocket ticker:message event (for notification)"""
        message = data.get('message', '')[:30]
        print(f"[WebSocket] Ticker message received: {message}")
        # Could flash a notification on the Stream Deck here
        self._ws_last_event = time.time()

    def _on_ws_connection_change(self, status: ConnectionStatus):
        """Handle WebSocket connection status change"""
        print(f"[WebSocket] Connection status: {status.value}")
        self._ws_connected = (status == ConnectionStatus.CONNECTED)

        # Update display to show new connection status
        if self.current_mode == ViewMode.MAIN:
            self.render_main_view()

    def _setup_websocket(self) -> bool:
        """Initialize and connect WebSocket client

        Returns:
            True if WebSocket connected successfully
        """
        if not self._ws_enabled:
            print("[Controller] WebSocket disabled in config")
            return False

        try:
            # Create WebSocket client
            self._websocket = TournamentWebSocket(
                base_url=self.config.get('admin_url', 'https://admin.despairhardware.com'),
                api_token=self.config.get('api_token'),
                reconnect_delay=self.config.get('websocket_reconnect_delay', 1),
                max_reconnect_delay=self.config.get('websocket_max_reconnect_delay', 60)
            )

            # Set up event handlers
            self._websocket.on_matches_update = self._on_ws_matches_update
            self._websocket.on_tournament_update = self._on_ws_tournament_update
            self._websocket.on_ticker_message = self._on_ws_ticker_message
            self._websocket.on_connection_change = self._on_ws_connection_change

            # Generate unique device ID
            import socket
            hostname = socket.gethostname()
            device_id = f"streamdeck-{hostname}"

            # Attempt connection
            print(f"[Controller] Connecting WebSocket as {device_id}...")
            if self._websocket.connect(device_id=device_id):
                # Give it a moment to establish
                time.sleep(0.5)
                if self._websocket.is_connected():
                    print("[Controller] WebSocket connected successfully")
                    self._ws_connected = True
                    return True

            print("[Controller] WebSocket connection failed, will use polling fallback")
            return False

        except Exception as e:
            print(f"[Controller] WebSocket setup error: {e}")
            return False

    # === Main Loop ===

    def _poll_loop(self):
        """Background polling loop for API updates with adaptive interval

        When WebSocket is connected, this loop becomes passive (only monitors connection).
        When WebSocket disconnects, this loop falls back to HTTP polling.
        """
        while self._running:
            now = time.time()

            # Check if WebSocket is connected
            if self._ws_connected:
                # WebSocket connected - minimal polling needed
                # Just check connection health periodically
                if now - self._ws_last_event > 60:
                    # No WebSocket events for 60s - connection might be stale
                    # Request fresh data
                    if self._websocket and self._websocket.is_connected():
                        self._websocket.request_matches()

                time.sleep(1)
                continue

            # WebSocket not connected - use HTTP polling as fallback
            # Adaptive polling: slow down if user is idle
            if now - self._last_user_action > self._active_timeout:
                if self._api_poll_interval != self._poll_interval_idle:
                    self._api_poll_interval = self._poll_interval_idle
                    print(f"[Poll] Switching to idle mode ({self._poll_interval_idle}s)")

            # Poll API at configured interval
            poll_interval = self.config.get('poll_fallback_interval', 5)
            if now - self._last_api_poll >= poll_interval:
                print(f"[Poll] HTTP fallback polling...")
                self.api.refresh_state()
                self._last_api_poll = now

                # Update display if in main view
                if self.current_mode == ViewMode.MAIN:
                    self.render_main_view()
                elif self.current_mode == ViewMode.MATCH_CONTROL:
                    # Also refresh match control view to show latest scores
                    if self.selected_match:
                        self.selected_match = self.api.get_match_by_id(self.selected_match.id)
                        self.render_match_control_view()

            time.sleep(0.5)

    def run(self):
        """Main run loop"""
        # Open Stream Deck
        if not self.deck.open():
            print("[Controller] Failed to open Stream Deck")
            return False

        # Set brightness
        self.deck.set_brightness(self.config.get('brightness', 80))

        # Set up key callback
        self.deck.set_key_callback(self.on_key_press)

        # Configure API with token authentication
        # Priority: env var > config file (api_client handles env var internally)
        api_token = self.config.get('api_token')  # Optional config override
        self.api = TournamentAPIClient(
            base_url=self.config.get('admin_url'),
            api_token=api_token
        )
        if self.config.get('station_filter'):
            self.api.set_station_filter(self.config['station_filter'])

        # Verify authentication
        if self.api.is_token_auth():
            print("[Controller] Using API token authentication")
            if not self.api.verify_token():
                print("[Controller] Warning: API token verification failed - check your ADMIN_API_TOKEN")
        else:
            print("[Controller] Warning: No API token configured")
            print("[Controller] Set ADMIN_API_TOKEN environment variable or api_token in config.json")

        # Initial data fetch via HTTP (needed for participant/station data)
        print("[Controller] Fetching initial data...")
        self.api.refresh_state()

        # Attempt WebSocket connection for real-time updates
        self._ws_enabled = self.config.get('websocket_enabled', True)
        if self._ws_enabled:
            print("[Controller] Attempting WebSocket connection...")
            ws_connected = self._setup_websocket()
            if ws_connected:
                print("[Controller] Real-time updates via WebSocket enabled")
            else:
                print("[Controller] Using HTTP polling fallback")
        else:
            print("[Controller] WebSocket disabled in config, using HTTP polling")

        # Render initial view
        self.render_main_view()

        # Start background polling/monitoring
        self._running = True
        self._api_poll_interval = self.config.get('poll_interval', 5)
        self._poll_thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._poll_thread.start()

        # Main key polling loop
        conn_mode = "WebSocket" if self._ws_connected else "HTTP polling"
        print(f"[Controller] Ready! ({conn_mode}) Press keys to interact.")
        try:
            self.deck.run_polling_loop(poll_interval=0.05)
        except KeyboardInterrupt:
            print("\n[Controller] Interrupted")

        # Cleanup
        self._running = False
        if self._poll_thread:
            self._poll_thread.join(timeout=1)

        # Disconnect WebSocket
        if self._websocket:
            self._websocket.disconnect()

        self.deck.clear_all_keys()
        self.deck.close()
        print("[Controller] Shutdown complete")
        return True


def main():
    """Entry point"""
    import argparse

    parser = argparse.ArgumentParser(description='Tournament Stream Deck Controller')
    parser.add_argument('--config', '-c', default='config.json',
                        help='Path to config file')
    parser.add_argument('--url', '-u', default=None,
                        help='Admin dashboard URL')
    parser.add_argument('--station', '-s', default=None,
                        help='Station filter (e.g., "TV 1")')
    parser.add_argument('--brightness', '-b', type=int, default=None,
                        help='Initial brightness (0-100)')

    args = parser.parse_args()

    controller = TournamentController(config_path=args.config)

    # Override config with command line args
    if args.url:
        controller.config['admin_url'] = args.url
    if args.station:
        controller.config['station_filter'] = args.station
    if args.brightness:
        controller.config['brightness'] = args.brightness

    # Run controller
    success = controller.run()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
