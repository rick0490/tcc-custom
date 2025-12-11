#!/usr/bin/env python3
"""
Tournament Dashboard API Client

Communicates with the admin dashboard REST API for:
- Match management (underway, scores, winners)
- Station management
- Ticker messages
- Tournament status

Authentication: Uses API token (X-API-Token header)
Generate tokens via admin dashboard: POST /api/auth/tokens
"""

import json
import os
import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
from enum import Enum


# Connection pool settings for better performance
DEFAULT_TIMEOUT = 10  # seconds (reduced from 30)
ACTION_TIMEOUT = 5    # seconds for quick actions

# Environment variable name for API token
API_TOKEN_ENV_VAR = 'ADMIN_API_TOKEN'


class MatchState(Enum):
    PENDING = "pending"
    OPEN = "open"
    UNDERWAY = "underway"
    COMPLETE = "complete"


@dataclass
class Player:
    id: int
    name: str
    seed: Optional[int] = None


@dataclass
class Match:
    id: int
    round: int
    round_name: str
    state: MatchState
    player1: Optional[Player]
    player2: Optional[Player]
    player1_score: int = 0
    player2_score: int = 0
    winner_id: Optional[int] = None
    station_id: Optional[str] = None
    station_name: Optional[str] = None
    underway_at: Optional[str] = None
    identifier: str = ""

    @property
    def is_underway(self) -> bool:
        return self.state == MatchState.OPEN and self.underway_at is not None

    @property
    def display_name(self) -> str:
        p1 = self.player1.name if self.player1 else "TBD"
        p2 = self.player2.name if self.player2 else "TBD"
        return f"{p1} vs {p2}"

    @property
    def score_display(self) -> str:
        return f"{self.player1_score} - {self.player2_score}"


@dataclass
class Station:
    id: str
    name: str
    match_id: Optional[int] = None


@dataclass
class TournamentState:
    tournament_id: Optional[str] = None
    tournament_name: str = ""
    game_name: str = ""
    state: str = "pending"
    matches: List[Match] = field(default_factory=list)
    stations: List[Station] = field(default_factory=list)
    total_matches: int = 0
    completed_matches: int = 0
    last_update: float = 0


class TournamentAPIClient:
    """Client for tournament dashboard REST API

    Authentication: Uses API token via X-API-Token header.
    Token can be provided via:
    1. api_token parameter in constructor
    2. ADMIN_API_TOKEN environment variable

    Generate tokens via admin dashboard: POST /api/auth/tokens (admin only)
    """

    def __init__(self, base_url: str = "https://admin.despairhardware.com",
                 api_token: Optional[str] = None,
                 # Deprecated: username/password auth (kept for backwards compat)
                 username: Optional[str] = None,
                 password: Optional[str] = None):
        self.base_url = base_url.rstrip('/')

        # Get API token: parameter > env var > None
        self._api_token = api_token or os.environ.get(API_TOKEN_ENV_VAR)

        # Create session with connection pooling
        self.session = requests.Session()

        # Set up headers - include API token if available
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Connection': 'keep-alive'
        }
        if self._api_token:
            headers['X-API-Token'] = self._api_token
            print(f"[API] Using API token authentication")

        self.session.headers.update(headers)

        # Configure connection pooling and retries
        retry_strategy = Retry(
            total=2,
            backoff_factor=0.5,
            status_forcelist=[502, 503, 504]
        )
        adapter = HTTPAdapter(
            pool_connections=5,
            pool_maxsize=10,
            max_retries=retry_strategy
        )
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

        # Legacy session auth (deprecated)
        self._authenticated = False
        self._username = username
        self._password = password

        self._state = TournamentState()
        self._station_filter: Optional[str] = None  # Filter matches by station

    def is_token_auth(self) -> bool:
        """Check if using API token authentication"""
        return self._api_token is not None

    def verify_token(self) -> bool:
        """Verify API token is valid by calling verify endpoint"""
        if not self._api_token:
            print("[API] No API token configured")
            return False

        try:
            url = f"{self.base_url}/api/auth/verify-token"
            response = self.session.get(url, timeout=DEFAULT_TIMEOUT)
            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    device = data.get('device', {})
                    print(f"[API] Token verified: {device.get('name')} ({device.get('type')})")
                    return True
            print(f"[API] Token verification failed: HTTP {response.status_code}")
            return False
        except requests.RequestException as e:
            print(f"[API] Token verification error: {e}")
            return False

    def login(self, username: Optional[str] = None, password: Optional[str] = None) -> bool:
        """Authenticate with the admin dashboard (DEPRECATED - use API token instead)

        This method is kept for backwards compatibility but API token auth is preferred.
        If using API token, this method is not needed.
        """
        # If we have API token, we don't need session-based login
        if self._api_token:
            return self.verify_token()

        # Legacy session-based auth
        username = username or self._username
        password = password or self._password

        if not username or not password:
            print("[API] No credentials provided")
            return False

        try:
            url = f"{self.base_url}/api/auth/login"
            response = self.session.post(url, json={
                "username": username,
                "password": password
            }, timeout=DEFAULT_TIMEOUT)

            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    self._authenticated = True
                    print(f"[API] Logged in as {username}")
                    return True
                else:
                    print(f"[API] Login failed: {data.get('error', 'Unknown error')}")
            else:
                print(f"[API] Login failed: HTTP {response.status_code}")
            return False
        except requests.RequestException as e:
            print(f"[API] Login error: {e}")
            return False

    def ensure_authenticated(self) -> bool:
        """Ensure we're authenticated

        With API token: Verify token is valid
        Without: Fall back to session login (deprecated)
        """
        if self._api_token:
            return True  # Token is included in headers, let API validate
        if self._authenticated:
            return True
        return self.login()

    @property
    def state(self) -> TournamentState:
        return self._state

    def set_station_filter(self, station_name: Optional[str]):
        """Filter matches to only show those assigned to a specific station"""
        self._station_filter = station_name

    def _api_get(self, endpoint: str, retry_auth: bool = True, timeout: int = DEFAULT_TIMEOUT) -> Optional[Dict[str, Any]]:
        """Make GET request to API"""
        try:
            url = f"{self.base_url}{endpoint}"
            response = self.session.get(url, timeout=timeout)
            if response.status_code == 200:
                return response.json()
            elif response.status_code == 401:
                # With token auth, 401 means invalid/expired token - no retry will help
                if self._api_token:
                    print(f"[API] GET {endpoint} failed: 401 (invalid or expired API token)")
                elif retry_auth:
                    # Legacy session auth - try to re-authenticate
                    if self.login():
                        return self._api_get(endpoint, retry_auth=False, timeout=timeout)
                    print(f"[API] GET {endpoint} failed: 401 (not authenticated)")
                return None
            else:
                print(f"[API] GET {endpoint} failed: {response.status_code}")
                return None
        except requests.RequestException as e:
            print(f"[API] GET {endpoint} error: {e}")
            return None

    def _api_post(self, endpoint: str, data: Optional[Dict] = None, retry_auth: bool = True, timeout: int = ACTION_TIMEOUT) -> Optional[Dict[str, Any]]:
        """Make POST request to API (uses shorter timeout for actions)"""
        try:
            url = f"{self.base_url}{endpoint}"
            response = self.session.post(url, json=data or {}, timeout=timeout)
            if response.status_code in (200, 201):
                return response.json()
            elif response.status_code == 401:
                # With token auth, 401 means invalid/expired token - no retry will help
                if self._api_token:
                    print(f"[API] POST {endpoint} failed: 401 (invalid or expired API token)")
                elif retry_auth:
                    # Legacy session auth - try to re-authenticate
                    if self.login():
                        return self._api_post(endpoint, data, retry_auth=False, timeout=timeout)
                    print(f"[API] POST {endpoint} failed: 401 (not authenticated)")
                return None
            else:
                print(f"[API] POST {endpoint} failed: {response.status_code}")
                try:
                    print(f"[API] Response: {response.text}")
                except:
                    pass
                return None
        except requests.RequestException as e:
            print(f"[API] POST {endpoint} error: {e}")
            return None

    def get_status(self) -> Optional[Dict[str, Any]]:
        """Get system status including active tournament"""
        return self._api_get("/api/status")

    def refresh_state(self) -> bool:
        """Refresh tournament state from API"""
        # Get system status for tournament info
        status = self.get_status()
        if not status:
            return False

        # Extract tournament ID from status
        # Structure: status['modules']['match']['state']['tournamentId']
        tournament_id = None
        try:
            tournament_id = status.get('modules', {}).get('match', {}).get('state', {}).get('tournamentId')
        except:
            pass

        if not tournament_id:
            self._state = TournamentState()
            return True

        self._state.tournament_id = tournament_id

        # Build lookup maps for participants and stations
        participant_map = {}  # id -> {name, seed}
        station_map = {}  # id -> name

        # Get participants first for name lookup
        participants_data = self._api_get(f"/api/participants/{tournament_id}")
        if participants_data and participants_data.get('success'):
            for p in participants_data.get('participants', []):
                participant_map[p.get('id')] = {
                    'name': p.get('name') or p.get('displayName') or 'TBD',
                    'seed': p.get('seed')
                }

        # Get stations for name lookup
        stations_data = self._api_get(f"/api/stations/{tournament_id}")
        if stations_data and stations_data.get('success'):
            for s in stations_data.get('stations', []):
                station_map[s.get('id')] = s.get('name')
            self._parse_stations(stations_data.get('stations', []))

        # Get matches with lookup maps
        matches_data = self._api_get(f"/api/matches/{tournament_id}")
        if matches_data and matches_data.get('success'):
            self._parse_matches(matches_data.get('matches', []), participant_map, station_map)

        # Get match stats
        stats_data = self._api_get(f"/api/matches/{tournament_id}/stats")
        if stats_data and stats_data.get('success'):
            self._state.total_matches = stats_data.get('total', 0)
            self._state.completed_matches = stats_data.get('completed', 0)

        self._state.last_update = time.time()
        return True

    def _parse_matches(self, matches_raw: List[Dict],
                       participant_map: Dict[int, Dict] = None,
                       station_map: Dict[str, str] = None):
        """Parse raw match data into Match objects

        Args:
            matches_raw: Raw match data from API
            participant_map: Map of participant ID -> {name, seed}
            station_map: Map of station ID -> station name
        """
        participant_map = participant_map or {}
        station_map = station_map or {}
        matches = []

        for m in matches_raw:
            try:
                # Parse state
                state_str = m.get('state', 'pending').lower()
                try:
                    state = MatchState(state_str)
                except ValueError:
                    state = MatchState.PENDING

                # Parse players - API returns player1Id/player2Id, not nested objects
                p1_id = m.get('player1Id')
                p2_id = m.get('player2Id')

                # Look up player info from participant map
                p1_info = participant_map.get(p1_id, {})
                p2_info = participant_map.get(p2_id, {})

                player1 = Player(
                    id=p1_id or 0,
                    name=p1_info.get('name', 'TBD'),
                    seed=p1_info.get('seed')
                ) if p1_id else None

                player2 = Player(
                    id=p2_id or 0,
                    name=p2_info.get('name', 'TBD'),
                    seed=p2_info.get('seed')
                ) if p2_id else None

                # Parse scores - API returns scores_csv not scores
                scores_str = m.get('scores_csv') or m.get('scores') or ''
                scores = scores_str.split('-')
                p1_score = int(scores[0]) if len(scores) >= 1 and scores[0].strip() else 0
                p2_score = int(scores[1]) if len(scores) >= 2 and scores[1].strip() else 0

                # Look up station name from station map
                station_id = m.get('stationId')
                station_name = station_map.get(str(station_id)) if station_id else None

                match = Match(
                    id=m.get('id', 0),
                    round=m.get('round', 0),
                    round_name=m.get('roundName', f"Round {m.get('round', 0)}"),
                    state=state,
                    player1=player1,
                    player2=player2,
                    player1_score=p1_score,
                    player2_score=p2_score,
                    winner_id=m.get('winnerId'),
                    station_id=station_id,
                    station_name=station_name,
                    underway_at=m.get('underwayAt'),
                    identifier=m.get('identifier', str(m.get('id', '')))
                )
                matches.append(match)
            except Exception as e:
                print(f"[API] Error parsing match: {e}")
                continue

        # Sort by round and state priority
        def sort_key(match):
            state_priority = {
                MatchState.UNDERWAY: 0,
                MatchState.OPEN: 1,
                MatchState.PENDING: 2,
                MatchState.COMPLETE: 3
            }
            # Use is_underway for correct priority
            if match.is_underway:
                return (0, match.round)
            return (state_priority.get(match.state, 4), match.round)

        matches.sort(key=sort_key)
        self._state.matches = matches

    def _parse_stations(self, stations_raw: List[Dict]):
        """Parse raw station data into Station objects"""
        stations = []
        for s in stations_raw:
            try:
                station = Station(
                    id=s.get('id', ''),
                    name=s.get('name', ''),
                    match_id=s.get('matchId')
                )
                stations.append(station)
            except Exception as e:
                print(f"[API] Error parsing station: {e}")
                continue
        self._state.stations = stations

    def get_open_matches(self, limit: int = 5) -> List[Match]:
        """Get open/underway matches, optionally filtered by station"""
        matches = [m for m in self._state.matches
                   if m.state == MatchState.OPEN or m.is_underway]

        if self._station_filter:
            matches = [m for m in matches
                      if m.station_name == self._station_filter]

        return matches[:limit]

    def get_underway_matches(self) -> List[Match]:
        """Get matches currently marked as underway"""
        return [m for m in self._state.matches if m.is_underway]

    def get_match_by_id(self, match_id: int) -> Optional[Match]:
        """Get a specific match by ID"""
        for m in self._state.matches:
            if m.id == match_id:
                return m
        return None

    def get_station_by_name(self, name: str) -> Optional[Station]:
        """Get station by name"""
        for s in self._state.stations:
            if s.name == name:
                return s
        return None

    # === Match Control Actions ===

    def mark_underway(self, match_id: int) -> bool:
        """Mark a match as underway"""
        if not self._state.tournament_id:
            return False
        result = self._api_post(
            f"/api/matches/{self._state.tournament_id}/{match_id}/underway"
        )
        return result is not None and result.get('success', False)

    def unmark_underway(self, match_id: int) -> bool:
        """Unmark a match (stop it)"""
        if not self._state.tournament_id:
            return False
        result = self._api_post(
            f"/api/matches/{self._state.tournament_id}/{match_id}/unmark-underway"
        )
        return result is not None and result.get('success', False)

    def update_score(self, match_id: int, player1_score: int, player2_score: int) -> bool:
        """Update match score"""
        if not self._state.tournament_id:
            return False
        result = self._api_post(
            f"/api/matches/{self._state.tournament_id}/{match_id}/score",
            {"scores": f"{player1_score}-{player2_score}"}
        )
        return result is not None and result.get('success', False)

    def declare_winner(self, match_id: int, winner_id: int,
                       player1_score: int, player2_score: int) -> bool:
        """Declare match winner (scores required by Challonge)"""
        if not self._state.tournament_id:
            return False
        result = self._api_post(
            f"/api/matches/{self._state.tournament_id}/{match_id}/winner",
            {
                "winnerId": winner_id,
                "scores": f"{player1_score}-{player2_score}"
            }
        )
        return result is not None and result.get('success', False)

    def quick_winner(self, match_id: int, player_number: int) -> bool:
        """Quick declare winner with 1-0 score"""
        match = self.get_match_by_id(match_id)
        if not match:
            return False

        if player_number == 1 and match.player1:
            return self.declare_winner(match_id, match.player1.id, 1, 0)
        elif player_number == 2 and match.player2:
            return self.declare_winner(match_id, match.player2.id, 0, 1)
        return False

    def forfeit(self, match_id: int, loser_player_number: int) -> bool:
        """DQ/Forfeit a player (advances other player with 0-0)"""
        match = self.get_match_by_id(match_id)
        if not match:
            return False

        if loser_player_number == 1 and match.player1 and match.player2:
            winner_id = match.player2.id
            loser_id = match.player1.id
        elif loser_player_number == 2 and match.player1 and match.player2:
            winner_id = match.player1.id
            loser_id = match.player2.id
        else:
            return False

        if not self._state.tournament_id:
            return False

        result = self._api_post(
            f"/api/matches/{self._state.tournament_id}/{match_id}/dq",
            {"winnerId": winner_id, "loserId": loser_id}
        )
        return result is not None and result.get('success', False)

    def reopen_match(self, match_id: int) -> bool:
        """Reopen a completed match"""
        if not self._state.tournament_id:
            return False
        result = self._api_post(
            f"/api/matches/{self._state.tournament_id}/{match_id}/reopen"
        )
        return result is not None and result.get('success', False)

    def assign_station(self, match_id: int, station_id: Optional[str]) -> bool:
        """Assign or unassign a station to a match"""
        if not self._state.tournament_id:
            return False
        result = self._api_post(
            f"/api/matches/{self._state.tournament_id}/{match_id}/station",
            {"stationId": station_id}
        )
        return result is not None and result.get('success', False)

    # === Ticker Messages ===

    def send_ticker(self, message: str, duration: int = 5) -> bool:
        """Send ticker message to match display"""
        result = self._api_post(
            "/api/ticker/send",
            {"message": message, "duration": duration}
        )
        return result is not None and result.get('success', False)

    def send_break_message(self, minutes: int = 5) -> bool:
        """Send break message"""
        return self.send_ticker(f"{minutes} MINUTE BREAK", 10)

    def send_report_in(self) -> bool:
        """Send report in message"""
        return self.send_ticker("PLAYERS REPORT TO YOUR STATIONS", 8)

    def send_starting_soon(self) -> bool:
        """Send starting soon message"""
        return self.send_ticker("MATCHES STARTING SOON", 8)

    def send_finals_message(self) -> bool:
        """Send finals message"""
        return self.send_ticker("GRAND FINALS STARTING", 10)

    # === WebSocket Event Handlers ===

    def update_from_websocket_matches(self, data: Dict[str, Any]) -> bool:
        """Update match state from WebSocket matches:update event

        Args:
            data: WebSocket event payload with matches array

        Returns:
            True if update successful
        """
        try:
            matches_raw = data.get('matches', [])
            if not matches_raw:
                return False

            # Build participant and station maps from the payload if included
            participant_map = {}
            station_map = {}

            # Some payloads include participants inline
            for m in matches_raw:
                # Extract participant info if included in match data
                if m.get('player1Name'):
                    p1_id = m.get('player1Id')
                    if p1_id:
                        participant_map[p1_id] = {
                            'name': m.get('player1Name', 'TBD'),
                            'seed': m.get('player1Seed')
                        }
                if m.get('player2Name'):
                    p2_id = m.get('player2Id')
                    if p2_id:
                        participant_map[p2_id] = {
                            'name': m.get('player2Name', 'TBD'),
                            'seed': m.get('player2Seed')
                        }
                # Extract station name if included
                if m.get('stationName'):
                    station_id = m.get('stationId')
                    if station_id:
                        station_map[str(station_id)] = m.get('stationName')

            # If no inline data, use cached participant/station maps
            if not participant_map:
                # Reuse existing cached data if available
                for match in self._state.matches:
                    if match.player1:
                        participant_map[match.player1.id] = {
                            'name': match.player1.name,
                            'seed': match.player1.seed
                        }
                    if match.player2:
                        participant_map[match.player2.id] = {
                            'name': match.player2.name,
                            'seed': match.player2.seed
                        }

            if not station_map:
                for station in self._state.stations:
                    station_map[str(station.id)] = station.name

            # Parse matches with lookup maps
            self._parse_matches(matches_raw, participant_map, station_map)

            # Update stats if included
            if 'stats' in data:
                self._state.total_matches = data['stats'].get('total', self._state.total_matches)
                self._state.completed_matches = data['stats'].get('completed', self._state.completed_matches)

            self._state.last_update = time.time()
            return True

        except Exception as e:
            print(f"[API] Error updating from WebSocket: {e}")
            return False

    def update_from_websocket_tournament(self, data: Dict[str, Any]) -> bool:
        """Update tournament state from WebSocket tournament:update event

        Args:
            data: WebSocket event payload with tournament data

        Returns:
            True if update successful
        """
        try:
            if 'tournamentId' in data:
                self._state.tournament_id = data['tournamentId']
            if 'name' in data:
                self._state.tournament_name = data['name']
            if 'gameName' in data:
                self._state.game_name = data['gameName']
            if 'state' in data:
                self._state.state = data['state']

            self._state.last_update = time.time()
            return True

        except Exception as e:
            print(f"[API] Error updating tournament from WebSocket: {e}")
            return False


if __name__ == "__main__":
    # Test the API client
    client = TournamentAPIClient()

    print("Refreshing tournament state...")
    if client.refresh_state():
        state = client.state
        print(f"\nTournament: {state.tournament_name or state.tournament_id}")
        print(f"Matches: {state.completed_matches}/{state.total_matches}")
        print(f"\nStations: {[s.name for s in state.stations]}")

        print("\nOpen Matches:")
        for match in client.get_open_matches():
            status = "UNDERWAY" if match.is_underway else "OPEN"
            station = f" @ {match.station_name}" if match.station_name else ""
            print(f"  [{status}] {match.display_name}{station}")
    else:
        print("Failed to refresh state")
