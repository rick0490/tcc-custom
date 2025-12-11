#!/usr/bin/env python3
"""
Tournament Setup Script
Prompts for game selection and Challonge URL, then sends to both MagicMirror modules:
- MMM-BracketView (bracket display)
- MMM-TournamentNowPlaying (match display)
"""

import requests
import sys
import re

# Configuration
BRACKET_HOST = "bracket.despairhardware.com"
MATCH_HOST = "tourney.despairhardware.com"

# API endpoints for both modules (via nginx proxy manager)
BRACKET_API_ENDPOINT = f"https://{BRACKET_HOST}/api/tournament/update"  # Proxied to port 2053
MATCH_API_ENDPOINT = f"https://{MATCH_HOST}/api/tournament/update"  # Proxied to port 2052

# Default Challonge API key (can be overridden)
DEFAULT_API_KEY = "5YQpnmPMcC1Us52nOBGgpWiremmH4HB7fHvGpOC1"

# Game configurations
GAMES = {
    "1": {
        "name": "Super Smash Bros Ultimate",
        "flyer": "ssbu_flyer.png"
    },
    "2": {
        "name": "Mario Kart Wii",
        "flyer": "mkw_flyer.png"
    },
    "3": {
        "name": "Custom Game",
        "flyer": "custom_flyer.png"
    }
}


def print_banner():
    """Print welcome banner"""
    print("=" * 60)
    print("    TOURNAMENT SETUP - MagicMirror Bracket Display")
    print("=" * 60)
    print()


def get_game_selection():
    """Prompt user to select game"""
    print("Select the game for tonight's tournament:")
    print("  1. Super Smash Bros Ultimate (SSBU)")
    print("  2. Mario Kart Wii")
    print("  3. Custom Game")
    print()

    while True:
        choice = input("Enter your choice (1-3): ").strip()
        if choice in GAMES:
            return choice
        print("Invalid choice. Please enter 1, 2, or 3.")


def get_challonge_url():
    """Prompt user for Challonge tournament URL"""
    print()
    print("Enter the Challonge tournament URL:")
    print("Example: https://challonge.com/y8ltomds")
    print()

    while True:
        url = input("Challonge URL: ").strip()

        # Validate URL format
        if not url:
            print("URL cannot be empty. Please try again.")
            continue

        # Extract tournament ID from various URL formats
        # Supports: https://challonge.com/ID, http://challonge.com/ID, challonge.com/ID
        match = re.search(r'challonge\.com/([a-zA-Z0-9_-]+)', url)
        if match:
            tournament_id = match.group(1)
            return tournament_id

        print("Invalid Challonge URL format. Please try again.")
        print("Expected format: https://challonge.com/YOUR_TOURNAMENT_ID")


def build_bracket_url(tournament_id):
    """Build the full Challonge module URL"""
    return f"http://challonge.com/{tournament_id}/module?scale_to_fit=1"


def send_to_bracket_module(flyer, bracket_url):
    """Send tournament data to MMM-BracketView (bracket display)"""
    print()
    print("Sending bracket data to MMM-BracketView...")
    print(f"  Flyer: {flyer}")
    print(f"  Bracket URL: {bracket_url}")

    payload = {
        "flyer": flyer,
        "bracketUrl": bracket_url
    }

    try:
        response = requests.post(BRACKET_API_ENDPOINT, json=payload, timeout=10, verify=False)
        response.raise_for_status()

        data = response.json()
        if data.get("success"):
            print("✓ Bracket data successfully sent to MMM-BracketView!")
            return True
        else:
            print("✗ Error from MMM-BracketView API:")
            print(f"  {data.get('error', 'Unknown error')}")
            return False

    except requests.exceptions.ConnectionError:
        print("✗ Could not connect to MMM-BracketView!")
        print(f"  Make sure MagicMirror bracket is running at {BRACKET_HOST}")
        return False
    except requests.exceptions.Timeout:
        print("✗ Request timed out!")
        return False
    except requests.exceptions.RequestException as e:
        print(f"✗ Error sending request: {e}")
        return False


def send_to_match_module(api_key, tournament_id):
    """Send tournament data to MMM-TournamentNowPlaying (match display)"""
    print()
    print("Sending match data to MMM-TournamentNowPlaying...")
    print(f"  Tournament ID: {tournament_id}")

    payload = {
        "apiKey": api_key,
        "tournamentId": tournament_id
    }

    try:
        response = requests.post(MATCH_API_ENDPOINT, json=payload, timeout=10, verify=False)
        response.raise_for_status()

        data = response.json()
        if data.get("success"):
            print("✓ Match data successfully sent to MMM-TournamentNowPlaying!")
            return True
        else:
            print("✗ Error from MMM-TournamentNowPlaying API:")
            print(f"  {data.get('error', 'Unknown error')}")
            return False

    except requests.exceptions.ConnectionError:
        print("✗ Could not connect to MMM-TournamentNowPlaying!")
        print(f"  Make sure MagicMirror match display is running at {MATCH_HOST}")
        return False
    except requests.exceptions.Timeout:
        print("✗ Request timed out!")
        return False
    except requests.exceptions.RequestException as e:
        print(f"✗ Error sending request: {e}")
        return False


def main():
    """Main script execution"""
    # Suppress SSL warnings since we're using self-signed certs
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    print_banner()

    # Step 1: Get game selection
    game_choice = get_game_selection()
    game_info = GAMES[game_choice]

    print()
    print(f"Selected: {game_info['name']}")

    # Step 2: Get flyer
    flyer = game_info['flyer']

    # Step 3: Get Challonge URL
    tournament_id = get_challonge_url()
    bracket_url = build_bracket_url(tournament_id)

    # Step 4: Use default API key (can be customized if needed)
    api_key = DEFAULT_API_KEY
    print()
    print(f"Using Challonge API key: {api_key[:10]}...{api_key[-4:]}")

    # Step 5: Confirm before sending
    print()
    print("-" * 60)
    print("CONFIRMATION")
    print("-" * 60)
    print(f"Game: {game_info['name']}")
    print(f"Flyer: {flyer}")
    print(f"Tournament ID: {tournament_id}")
    print(f"Bracket URL: {bracket_url}")
    print()
    print("This will update BOTH MagicMirror modules:")
    print("  • MMM-BracketView (bracket display)")
    print("  • MMM-TournamentNowPlaying (match display)")
    print()

    confirm = input("Send to both MagicMirror modules? (y/n): ").strip().lower()
    if confirm != 'y':
        print("Cancelled.")
        sys.exit(0)

    # Step 6: Send to both MagicMirror modules
    print()
    print("=" * 60)
    bracket_success = send_to_bracket_module(flyer, bracket_url)
    match_success = send_to_match_module(api_key, tournament_id)
    print("=" * 60)

    if bracket_success and match_success:
        print()
        print("=" * 60)
        print("✓ Setup complete! Both modules are now configured!")
        print("=" * 60)
        print()
        print("What's been updated:")
        print("  • Bracket display: Will show flyer and rotate to bracket at 8pm")
        print("  • Match display: Now tracking tournament", tournament_id)
        print()
        sys.exit(0)
    elif bracket_success or match_success:
        print()
        print("=" * 60)
        print("⚠ Partial success - some modules updated")
        print("=" * 60)
        if bracket_success:
            print("  ✓ Bracket display updated")
        else:
            print("  ✗ Bracket display failed")
        if match_success:
            print("  ✓ Match display updated")
        else:
            print("  ✗ Match display failed")
        print()
        sys.exit(1)
    else:
        print()
        print("=" * 60)
        print("✗ Setup failed for both modules")
        print("=" * 60)
        print("Please check the errors above.")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nCancelled by user.")
        sys.exit(0)
