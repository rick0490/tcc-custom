#!/usr/bin/env python3
"""
Test script to automatically test the tournament setup
"""

import requests

MAGIC_MIRROR_HOST = "localhost"
MAGIC_MIRROR_PORT = 3000
API_ENDPOINT = f"http://{MAGIC_MIRROR_HOST}:{MAGIC_MIRROR_PORT}/api/tournament/update"

# Test with Mario Kart Wii and the test bracket
payload = {
    "flyer": "mkw_flyer.png",
    "bracketUrl": "http://challonge.com/y8ltomds/module?scale_to_fit=1"
}

print("Testing tournament setup...")
print(f"Flyer: {payload['flyer']}")
print(f"Bracket URL: {payload['bracketUrl']}")
print()

try:
    response = requests.post(API_ENDPOINT, json=payload, timeout=10)
    response.raise_for_status()

    data = response.json()
    print("Response from MagicMirror:")
    print(data)

    if data.get("success"):
        print("\n✓ Success! Tournament data sent to MagicMirror")
    else:
        print("\n✗ Failed:", data.get("error"))

except Exception as e:
    print(f"✗ Error: {e}")
