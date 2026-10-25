"""Inspect public Wiki avatar image headers without retaining image files."""

import concurrent.futures
import datetime
import json
import struct
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ALLOWED_HOSTS = {"prod-alicdn-community.kurobbs.com"}


def inspect(entry):
    url = entry["url"]
    if urllib.parse.urlparse(url).hostname not in ALLOWED_HOSTS:
        raise ValueError("Unexpected asset host")
    result = dict(entry)
    result.pop("images", None)
    request = urllib.request.Request(
        url,
        headers={
            "Range": "bytes=0-4095",
            "Origin": "http://localhost:4173",
            "Referer": "http://localhost:4173/",
            "User-Agent": "Mozilla/5.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            data = response.read(4096)
            result.update(
                {
                    "httpStatus": response.status,
                    "contentType": response.headers.get("Content-Type"),
                    "corsAllowOrigin": response.headers.get(
                        "Access-Control-Allow-Origin"
                    ),
                    "contentRange": response.headers.get("Content-Range"),
                    "contentLength": response.headers.get("Content-Length"),
                    "verification": "HTTP response and image header; not full decode",
                }
            )
            if data.startswith(b"\x89PNG\r\n\x1a\n"):
                width, height, depth, color_type = struct.unpack(">IIBB", data[16:26])
                result.update(
                    {
                        "format": "PNG",
                        "width": width,
                        "height": height,
                        "bitDepth": depth,
                        "pngColorType": color_type,
                    }
                )
            else:
                result["error"] = "Not a PNG header; manual inspection required"
    except (OSError, urllib.error.URLError) as exc:
        result["error"] = str(exc)
    return result


def main():
    entries = json.loads((ROOT / "wiki-avatar-catalog.json").read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(inspect, entries))
    payload = {
        "checkedAt": datetime.datetime.now(
            datetime.timezone(datetime.timedelta(hours=8))
        ).isoformat(),
        "sourcePage": "https://wiki.kurobbs.com/mc/home?bbs_clientSource=12",
        "sourceCatalogueId": "1363",
        "entryCount": len(results),
        "notes": [
            "Avatar entries include outfits and event artwork, not only characters.",
            "Image-header validation does not assert the full file can be decoded.",
            "PNG color type 3 may carry transparency through a tRNS chunk.",
        ],
        "avatars": results,
    }
    (ROOT / "wiki-avatar-verified.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    )
    sizes = {}
    failures = []
    for row in results:
        key = f"{row.get('width', '?')}x{row.get('height', '?')}"
        sizes[key] = sizes.get(key, 0) + 1
        if row.get("error"):
            failures.append({"name": row["name"], "error": row["error"]})
    print(json.dumps({"count": len(results), "sizes": sizes, "failures": failures},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
