# Hue Secure Reset (client-only)

Static site that scans Hue bulb QR codes, derives the printed 6‑char serial from the `Z:` field, and sends the Zigbee2MQTT factory reset action over WebSocket MQTT.

## Run locally

```bash
python3 -m http.server 5173
```

Open `http://localhost:5173` in a modern browser. Camera access works on localhost; for LAN testing, you will need HTTPS (any HTTPS dev server is fine).

## MQTT defaults

- Base topic defaults to `zigbee2mqtt`.
- WebSocket URL defaults to `ws://localhost:9001` (update to match your Mosquitto WebSocket listener).
- Auto-connect is enabled by default (toggle in the UI).

## Tests

```bash
npm test
```

## Notes

The serial is derived as:

```
serial = HEX( SHA256( hex_to_bytes(Z) )[0:3] ).upper()
```

If a QR does not contain a `Z:` field, the app will try to find any 6‑hex‑char serial in the QR payload.

QR scanning uses `qr-scanner` via CDN (loaded as an ESM module).

Camera tools include a camera selector, zoom/torch controls (when supported), and a “scan from photo” input.
You can also drag & drop images or paste from the clipboard into the scan area.

If the camera doesn't support hardware zoom, the slider falls back to a virtual zoom that crops the scan region and scales the preview.
