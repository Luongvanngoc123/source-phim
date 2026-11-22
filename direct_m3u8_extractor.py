"""
Zero-Bandwidth / Low-RAM Direct Google CDN HLS Extractor for AnimeVietSub
(stream.googleapiscdn.com -> lh3.googleusercontent.com direct M3U8)

Architecture:
- No Headless Browser (0 Chromium/Playwright/Puppeteer processes).
- Pure Python cryptography (< 5 MB RAM, ~15ms CPU time).
- 0 Video Bandwidth on server:
  1. Server fetches player HTML (~90 KB), encrypted carrier M3U8 (~465 KB),
     and 16-byte AES-128 segment key.
  2. Server decrypts Layer 1 (X-Envelope USDK + LCG unshuffle + AES-256-GCM + FNV1a/xorshift32 byte unpermutation).
  3. Server decrypts Layer 2 (G6 URL-cipher: HMAC-SHA256 + AES-256-CTR) to transform all
     /hls/<fileId>.ts?e=...&i=... placeholders into direct `https://lh3.googleusercontent.com/...=d` URLs.
  4. Server inlines the 16-byte `#EXT-X-KEY` as `URI="data:application/octet-stream;base64,..."`.
  5. Client browser/player receives a ~48 KB standard `.m3u8` and downloads all video chunks
     directly from Google CDN (`lh3.googleusercontent.com`) via HTTP 206 Range requests.
"""

import base64
import hashlib
import hmac
import json
import re
import sys
import urllib.parse
import urllib.request
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
PARENT_HOST = "animevietsub.bid"


def b64url_decode(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    s += "=" * ((4 - len(s) % 4) % 4)
    return base64.b64decode(s)


def unpack_envelope(env_b64: str) -> dict:
    """Decode `X-Envelope` header (`USDK\\x01` + 2-byte big-endian length + JSON + 4-byte CRC32)."""
    raw = b64url_decode(env_b64)
    if len(raw) < 11 or raw[:4] != b"USDK" or raw[4] != 1:
        raise ValueError("Invalid X-Envelope magic/version")
    json_len = (raw[5] << 8) | raw[6]
    payload = raw[7 : 7 + json_len]
    return json.loads(payload.decode("utf-8"))


def js_parse_int_16(s: str) -> int:
    """Emulate JS `parseInt(s, 16) >>> 0`."""
    m = re.match(r"^[0-9a-fA-F]+", s)
    if not m:
        return 0
    return int(m.group(0), 16) & 0xFFFFFFFF


def lcg_step(seed: int) -> int:
    """Emulate `(Math.imul(seed, 1664525) + 1013904223) >>> 0`."""
    return ((seed * 1664525) + 1013904223) & 0xFFFFFFFF


def unshuffle_ciphertext(s: str, sk: str) -> str:
    """Reverse Fisher-Yates LCG string shuffle on joined `_t` chunks (`Y(aC, sk)`)."""
    chars = list(s)
    n = len(chars)
    seed = js_parse_int_16(sk[:8])
    swaps = []
    for i in range(n - 1, 0, -1):
        seed = lcg_step(seed)
        swaps.append((i, seed % (i + 1)))
    for i, j in reversed(swaps):
        chars[i], chars[j] = chars[j], chars[i]
    return "".join(chars)


def fnv1a_xorshift_prng(seed_str: str):
    """FNV-1a 32-bit hash seeded xorshift32 PRNG (`H(seed)`)."""
    h = 0x811C9DC5
    for ch in seed_str:
        h ^= ord(ch) & 0xFF
        h = (h * 0x01000193) & 0xFFFFFFFF
    state = h or 1

    def next_u32() -> int:
        nonlocal state
        state ^= (state << 13) & 0xFFFFFFFF
        state ^= (state >> 17) & 0xFFFFFFFF
        state ^= (state << 5) & 0xFFFFFFFF
        return state & 0xFFFFFFFF

    return next_u32


def unpermute_bytes(data: bytes, sk: str, ts: str) -> bytes:
    """Reverse WebCrypto post-decrypt byte permutation and XOR mask (`J(raw, sk, ts)`)."""
    n = len(data)
    if n == 0:
        return b""
    prng = fnv1a_xorshift_prng(f"{sk}|{ts}")
    idx = list(range(n))
    for i in range(n - 1, 0, -1):
        j = prng() % (i + 1)
        idx[i], idx[j] = idx[j], idx[i]

    out = bytearray(n)
    word = 0
    for i in range(n):
        if (i & 3) == 0:
            word = prng()
        xor_byte = (word >> (8 * (i & 3))) & 0xFF
        out[idx[i]] = data[i] ^ xor_byte
    return bytes(out)


def extract_session_key(avs_token: str) -> str:
    """Extract 64-char hex sessionKey from odd indices of JWT `jti` (`a3(avsToken)`)."""
    parts = avs_token.split(".")
    payload = json.loads(b64url_decode(parts[1]).decode("utf-8"))
    jti = payload.get("jti", "")
    return jti[1::2]


def decrypt_g6_segment_url(
    session_key: str, file_id: str, seg_index: int, enc_b64: str, key_cache: dict
) -> str:
    """Decrypt `/hls/<fileId>.ts?e=<enc_b64>&i=<seg_index>` into direct Google CDN URL."""
    if file_id not in key_cache:
        key_cache[file_id] = hmac.new(
            session_key.encode("utf-8"),
            f"url-cipher|{file_id}".encode("utf-8"),
            hashlib.sha256,
        ).digest()
    aes_key = key_cache[file_id]
    counter_block = (seg_index & 0xFFFFFFFF).to_bytes(16, byteorder="big")
    cipher = Cipher(algorithms.AES(aes_key), modes.CTR(counter_block))
    decryptor = cipher.decryptor()
    ct = b64url_decode(enc_b64)
    return (decryptor.update(ct) + decryptor.finalize()).decode("utf-8")


def build_direct_cdn_m3u8(player_url: str, inline_key: bool = True) -> dict:
    """
    Fetch and decrypt an AnimeVietSub `stream.googleapiscdn.com/player/<id>` URL
    into a self-contained HLS `.m3u8` pointing directly to `lh3.googleusercontent.com`.
    """
    # 1. Fetch Player HTML
    req_player = urllib.request.Request(
        player_url,
        headers={
            "User-Agent": DEFAULT_UA,
            "Referer": f"https://{PARENT_HOST}/",
        },
    )
    with urllib.request.urlopen(req_player) as resp:
        html = resp.read().decode("utf-8", errors="ignore")

    id_m = re.search(r'const id = "([a-f0-9]+)";', html)
    tok_m = re.search(r'const avsToken = "([^"]+)";', html)
    if not id_m or not tok_m:
        raise RuntimeError("Could not extract `id` or `avsToken` from player page")

    player_id = id_m.group(1)
    avs_token = tok_m.group(1)
    session_key = extract_session_key(avs_token)
    fc = base64.b64encode(PARENT_HOST.encode("ascii")).decode("ascii")

    # 2. Fetch Carrier Playlist + X-Envelope
    pl_url = (
        f"https://stream.googleapiscdn.com/playlist/{player_id}/playlist.m3u8"
        f"?token={urllib.parse.quote(avs_token)}&fc={urllib.parse.quote(fc)}"
    )
    req_pl = urllib.request.Request(
        pl_url,
        headers={
            "User-Agent": DEFAULT_UA,
            "Referer": player_url,
            "Origin": "https://stream.googleapiscdn.com",
        },
    )
    with urllib.request.urlopen(req_pl) as resp_pl:
        env_header = resp_pl.headers.get("X-Envelope")
        if env_header:
            env = unpack_envelope(env_header)
            cn, sk, ts, uid = env["cn"], env["sk"], str(env["ts"]), env["uid"]
        else:
            cn = resp_pl.headers.get("X-Edge-Tag", "")
            sk = resp_pl.headers.get("X-Cache-Node", "")
            ts = resp_pl.headers.get("X-Request-Trace", "0")
            uid = urllib.parse.unquote(resp_pl.headers.get("X-Proxy-Digest", ""))
        carrier_m3u8 = resp_pl.read().decode("utf-8", errors="ignore")

    # 3. Decrypt Carrier M3U8 (Layer 1)
    header_lines = []
    t_chunks = []
    for line in carrier_m3u8.splitlines():
        if line.startswith("#") or not line.strip():
            if not (
                line.startswith("#EXTINF:")
                or line.startswith("#EXT-X-ENDLIST")
                or line.startswith("#EXT-X-KEY")
            ):
                header_lines.append(line)
        else:
            m = re.search(r"[?&]_t=([^&\s]+)", line)
            if m:
                t_chunks.append(m.group(1))

    unshuffled_t = unshuffle_ciphertext("".join(t_chunks), sk)
    cn_bytes = b64url_decode(cn)
    aes_gcm_key = hmac.new(
        cn_bytes, f"{uid}:{ts}:{sk}:0".encode("utf-8"), hashlib.sha256
    ).digest()
    raw_decrypted = AESGCM(aes_gcm_key).decrypt(
        cn_bytes[:12], b64url_decode(unshuffled_t), None
    )
    inner_body = unpermute_bytes(raw_decrypted, sk, ts).decode("utf-8")
    intermediate_m3u8 = "\n".join(header_lines) + "\n" + inner_body

    # 4. Decrypt G6 Placeholder Segment URLs -> Direct Google CDN & Inline 16-Byte Key (Layer 2)
    key_cache = {}
    seg_key_data_uri = None
    output_lines = []
    segment_count = 0

    for line in intermediate_m3u8.splitlines():
        if line.startswith("#EXT-X-KEY:") and inline_key:
            km = re.search(r'URI="([^"]+)"', line)
            if km:
                key_url = km.group(1)
                if key_url.startswith("/"):
                    key_url = "https://stream.googleapiscdn.com" + key_url
                req_k = urllib.request.Request(
                    key_url,
                    headers={
                        "User-Agent": DEFAULT_UA,
                        "Referer": player_url,
                        "Origin": "https://stream.googleapiscdn.com",
                    },
                )
                with urllib.request.urlopen(req_k) as rk:
                    key_bytes = rk.read()
                b64_key = base64.b64encode(key_bytes).decode("ascii")
                seg_key_data_uri = f"data:application/octet-stream;base64,{b64_key}"
                line = line.replace(km.group(1), seg_key_data_uri)
            output_lines.append(line)
        elif "/hls/" in line and ".ts" in line:
            parsed = urllib.parse.urlparse(line)
            fm = re.search(r"/hls/([0-9a-f]{24})\.ts", parsed.path, re.I)
            qs = urllib.parse.parse_qs(parsed.query)
            if fm and "e" in qs and "i" in qs:
                cdn_url = decrypt_g6_segment_url(
                    session_key, fm.group(1), int(qs["i"][0]), qs["e"][0], key_cache
                )
                output_lines.append(cdn_url)
                segment_count += 1
            else:
                output_lines.append(line)
        else:
            output_lines.append(line)

    final_m3u8 = "\n".join(output_lines) + "\n"
    final_data_uri = (
        "data:application/vnd.apple.mpegurl;base64,"
        + base64.b64encode(final_m3u8.encode("utf-8")).decode("ascii")
    )

    return {
        "player_id": player_id,
        "segment_count": segment_count,
        "seg_key_data_uri": seg_key_data_uri,
        "m3u8": final_m3u8,
        "m3u8_data_uri": final_data_uri,
    }


if __name__ == "__main__":
    target = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "https://stream.googleapiscdn.com/player/225a9b1cda0dbe429acb3283d030bba90a2195d755376c99d30fbb70c84a5a06"
    )
    res = build_direct_cdn_m3u8(target)
    out_path = r"d:\anime\animevietsub_api\direct_cdn_playlist.m3u8"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(res["m3u8"])
    print(f"[OK] Player ID    : {res['player_id']}")
    print(f"[OK] Segments     : {res['segment_count']} direct lh3.googleusercontent.com links")
    print(f"[OK] Inline Key   : {res['seg_key_data_uri']}")
    print(f"[OK] Saved M3U8   : {out_path} ({len(res['m3u8'])} bytes)")
