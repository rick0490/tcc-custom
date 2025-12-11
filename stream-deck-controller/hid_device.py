#!/usr/bin/env python3
"""
Stream Deck HID Interface
Uses the python-elgato-streamdeck library for reliable communication.
"""

import time
from typing import Callable, Optional, List
from PIL import Image, ImageDraw, ImageFont

from StreamDeck.DeviceManager import DeviceManager
from StreamDeck.ImageHelpers import PILHelper

# Device specifications
NUM_KEYS = 15
KEY_IMAGE_SIZE = 72


class StreamDeckHID:
    """HID interface for Stream Deck using official library"""

    def __init__(self):
        self.deck = None
        self.model_name = "Unknown"
        self.num_keys = NUM_KEYS
        self.key_size = KEY_IMAGE_SIZE
        self._key_callback: Optional[Callable[[int, bool], None]] = None
        self._running = False

    def open(self) -> bool:
        """Open connection to Stream Deck"""
        try:
            decks = DeviceManager().enumerate()
            if not decks:
                print("[HID] No Stream Deck found")
                return False

            self.deck = decks[0]
            self.deck.open()

            self.model_name = self.deck.deck_type()
            self.num_keys = self.deck.key_count()
            self.key_size = self.deck.key_image_format()['size'][0]

            print(f"[HID] Opened {self.model_name} ({self.num_keys} keys)")

            # Set up key callback
            self.deck.set_key_callback(self._on_key_change)

            return True
        except Exception as e:
            print(f"[HID] Failed to open device: {e}")
            return False

    def close(self):
        """Close connection to Stream Deck"""
        self._running = False
        if self.deck:
            try:
                self.deck.reset()
                self.deck.close()
            except:
                pass
            self.deck = None
            print("[HID] Closed Stream Deck connection")

    def _on_key_change(self, deck, key_index, pressed):
        """Internal callback for key state changes"""
        if self._key_callback:
            self._key_callback(key_index, pressed)

    def set_brightness(self, percent: int) -> bool:
        """Set LCD brightness (0-100)"""
        if not self.deck:
            return False
        try:
            percent = max(0, min(100, percent))
            self.deck.set_brightness(percent)
            return True
        except Exception as e:
            print(f"[HID] Brightness error: {e}")
            return False

    def reset(self) -> bool:
        """Reset the Stream Deck"""
        if not self.deck:
            return False
        try:
            self.deck.reset()
            return True
        except Exception as e:
            print(f"[HID] Reset error: {e}")
            return False

    def set_key_image(self, key_index: int, image: Image.Image) -> bool:
        """Set image for a specific key"""
        if not self.deck:
            return False
        if key_index < 0 or key_index >= self.num_keys:
            return False

        try:
            # Resize image to key size
            img = image.convert('RGB')
            img = img.resize((self.key_size, self.key_size), Image.Resampling.LANCZOS)

            # Convert to native format
            native = PILHelper.to_native_key_format(self.deck, img)
            self.deck.set_key_image(key_index, native)
            return True
        except Exception as e:
            print(f"[HID] Image error for key {key_index}: {e}")
            return False

    def clear_key(self, key_index: int) -> bool:
        """Clear a key to black"""
        black = Image.new('RGB', (self.key_size, self.key_size), (0, 0, 0))
        return self.set_key_image(key_index, black)

    def clear_all_keys(self) -> bool:
        """Clear all keys to black"""
        if not self.deck:
            return False
        try:
            for i in range(self.num_keys):
                self.clear_key(i)
            return True
        except Exception as e:
            print(f"[HID] Clear all error: {e}")
            return False

    def set_key_callback(self, callback: Callable[[int, bool], None]):
        """Set callback for key press/release events

        callback(key_index: int, pressed: bool)
        """
        self._key_callback = callback

    def poll_keys(self) -> List[tuple]:
        """Poll for key state changes - not needed with callback model"""
        # The streamdeck library uses callbacks, so this just keeps the loop alive
        return []

    def run_polling_loop(self, poll_interval: float = 0.02):
        """Run continuous loop to keep the program alive"""
        self._running = True
        print("[HID] Starting event loop")

        while self._running:
            time.sleep(poll_interval)

    def get_key_state(self, key_index: int) -> bool:
        """Get current state of a key"""
        if self.deck and 0 <= key_index < self.num_keys:
            return self.deck.key_states()[key_index]
        return False


def create_text_image(text: str,
                      bg_color: tuple = (0, 0, 0),
                      text_color: tuple = (255, 255, 255),
                      font_size: int = 14,
                      key_size: int = KEY_IMAGE_SIZE) -> Image.Image:
    """Create a key image with text"""
    img = Image.new('RGB', (key_size, key_size), bg_color)
    draw = ImageDraw.Draw(img)

    # Try to load a font
    font = None
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    ]
    for path in font_paths:
        try:
            font = ImageFont.truetype(path, font_size)
            break
        except:
            continue
    if font is None:
        font = ImageFont.load_default()

    # Handle multiline text
    lines = text.split('\n')
    line_height = font_size + 4
    total_height = len(lines) * line_height
    start_y = (key_size - total_height) // 2

    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font)
        text_width = bbox[2] - bbox[0]
        x = (key_size - text_width) // 2
        y = start_y + (i * line_height)
        draw.text((x, y), line, fill=text_color, font=font)

    return img


def create_icon_with_label(icon_text: str,
                           label: str,
                           bg_color: tuple = (40, 40, 40),
                           icon_color: tuple = (255, 255, 255),
                           label_color: tuple = (200, 200, 200),
                           key_size: int = KEY_IMAGE_SIZE) -> Image.Image:
    """Create a key image with large icon text and smaller label"""
    img = Image.new('RGB', (key_size, key_size), bg_color)
    draw = ImageDraw.Draw(img)

    # Load fonts
    icon_font = None
    label_font = None
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    ]
    for path in font_paths:
        try:
            icon_font = ImageFont.truetype(path, 28)
            label_font = ImageFont.truetype(path, 10)
            break
        except:
            continue
    if icon_font is None:
        icon_font = ImageFont.load_default()
        label_font = ImageFont.load_default()

    # Draw icon
    bbox = draw.textbbox((0, 0), icon_text, font=icon_font)
    icon_x = (key_size - (bbox[2] - bbox[0])) // 2
    draw.text((icon_x, 12), icon_text, fill=icon_color, font=icon_font)

    # Draw label
    bbox = draw.textbbox((0, 0), label, font=label_font)
    label_x = (key_size - (bbox[2] - bbox[0])) // 2
    draw.text((label_x, 52), label, fill=label_color, font=label_font)

    return img


if __name__ == "__main__":
    # Test the HID interface
    print("Stream Deck HID Test")
    print("=" * 40)

    deck = StreamDeckHID()

    if deck.open():
        print(f"\nConnected to {deck.model_name}")
        print(f"Keys: {deck.num_keys}")

        # Set brightness
        print("\nSetting brightness to 80%...")
        deck.set_brightness(80)
        time.sleep(0.1)

        # Create test images for each key
        colors = [
            (180, 40, 40),    # Red
            (40, 150, 40),    # Green
            (40, 80, 180),    # Blue
            (180, 150, 0),    # Yellow
            (120, 40, 150),   # Purple
        ]

        print("\nSetting key images...")
        for i in range(deck.num_keys):
            color = colors[i % len(colors)]
            img = create_text_image(f"Key\n{i}", bg_color=color, font_size=14)
            deck.set_key_image(i, img)
            print(f"  Key {i}: OK")
            time.sleep(0.05)

        # Set up key callback
        def on_key(key_index: int, pressed: bool):
            state = "PRESSED" if pressed else "RELEASED"
            print(f"Key {key_index}: {state}")

        deck.set_key_callback(on_key)

        print("\n" + "=" * 40)
        print("Keys should display test images now!")
        print("Press keys to test input (Ctrl+C to exit)")
        print("=" * 40 + "\n")

        try:
            deck.run_polling_loop()
        except KeyboardInterrupt:
            print("\nExiting...")

        deck.clear_all_keys()
        deck.close()
    else:
        print("\nFailed to connect to Stream Deck")
