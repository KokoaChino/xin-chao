"""Inspect publicly listed official guide images without authentication."""

import concurrent.futures
import io
import json
from pathlib import Path
import struct
import urllib.request

from PIL import Image


ROOT = Path(__file__).resolve().parent
RAW = json.loads(Path("/tmp/mcguide-roles.json").read_text())
SAMPLE_IDS = {"1312", "1304", "1107", "1408", "1402", "1305"}
ORIGIN = "https://example.com"


def inspect(item):
    role, field = item
    url = role[field]
    request = urllib.request.Request(
        url,
        headers={
            "Range": "bytes=0-4095",
            "Origin": ORIGIN,
            "Referer": ORIGIN + "/",
        },
    )
    result = {"url": url}
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            prefix = response.read(4096)
            result.update(
                httpStatus=response.status,
                contentType=response.headers.get("Content-Type"),
                contentLength=response.headers.get("Content-Length"),
                contentRange=response.headers.get("Content-Range"),
                corsAllowOrigin=response.headers.get("Access-Control-Allow-Origin"),
            )
        if prefix[:8] == b"\x89PNG\r\n\x1a\n":
            width, height, depth, color_type = struct.unpack(">IIBB", prefix[16:26])
            offset = 8
            transparency_chunk = False
            while offset + 8 <= len(prefix):
                chunk_length = struct.unpack(">I", prefix[offset : offset + 4])[0]
                chunk_type = prefix[offset + 4 : offset + 8]
                if chunk_type == b"tRNS":
                    transparency_chunk = True
                if chunk_type == b"IDAT":
                    break
                offset += chunk_length + 12
            result.update(
                format="PNG",
                width=width,
                height=height,
                bitDepth=depth,
                pngColorType=color_type,
                hasAlphaChannel=color_type in (4, 6),
                hasTransparency=color_type in (4, 6) or transparency_chunk,
                hasPaletteTransparency=transparency_chunk and color_type == 3,
            )
        if role["roleGbId"] in SAMPLE_IDS:
            with urllib.request.urlopen(url, timeout=30) as response:
                body = response.read()
            image = Image.open(io.BytesIO(body))
            result.update(
                fullImageVerified=True,
                width=image.width,
                height=image.height,
                mode=image.mode,
                fileBytes=len(body),
                hasAlphaChannel="A" in image.getbands(),
            )
            if "A" in image.getbands() or "transparency" in image.info:
                alpha = image.convert("RGBA").getchannel("A")
                bounds = alpha.getbbox()
                result.update(
                    hasTransparency=alpha.getextrema()[0] < 255,
                    alphaExtrema=alpha.getextrema(),
                    visibleBounds=list(bounds) if bounds else None,
                )
                if bounds:
                    result["transparentMarginPx"] = [
                        bounds[0],
                        bounds[1],
                        image.width - bounds[2],
                        image.height - bounds[3],
                    ]
            Path(f"/tmp/mcguide-{role['roleGbId']}-{field}.png").write_bytes(body)
    except Exception as error:
        result["error"] = str(error)
    return role["roleGbId"], field, result


def main():
    roles = RAW["data"]
    jobs = [(role, field) for role in roles for field in ("cardPictureUrl", "illustrationPictureUrl")]
    measurements = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for role_id, field, result in pool.map(inspect, jobs):
            measurements.setdefault(role_id, {})[field] = result
    catalog = []
    status_labels = {1: "ALREADY_ONLINE", 2: "NEWLY_LAUNCHED", 3: "UP", 4: "PROSPECT"}
    for role in roles:
        names = {text["language"]: text["name"] for text in role.get("texts", [])}
        catalog.append(
            {
                "id": role["roleGbId"],
                "name": names.get("zh-Hans"),
                "nameEn": names.get("en"),
                "sourcePage": "https://mcguide.kurogames.com/zh-Hans/?role_id=" + role["roleGbId"],
                "rarity": role.get("star"),
                "sourceRoleStatus": role.get("roleStatus"),
                "sourceRoleStatusLabel": status_labels.get(role.get("roleStatus")),
                "alternateRoleId": role.get("mayRoleGbId"),
                "card": measurements[role["roleGbId"]]["cardPictureUrl"],
                "illustration": measurements[role["roleGbId"]]["illustrationPictureUrl"],
            }
        )
    ROOT.mkdir(exist_ok=True)
    (ROOT / "guide-directory-raw.json").write_text(json.dumps(RAW, ensure_ascii=False, indent=2) + "\n")
    (ROOT / "guide-catalog.json").write_text(
        json.dumps(
            {
                "checkedAt": "2026-10-23",
                "source": "https://guide-server.aki-game.com/role/avatar/list",
                "sourcePage": "https://mcguide.kurogames.com/zh-Hans/",
                "requestHeaders": {"x-language": "zh-Hans"},
                "entryCount": len(catalog),
                "notes": [
                    "Public API snapshot; entry count is not a count of unique people.",
                    "Rover elements have distinct entries; alternateRoleId is preserved without gender assumptions.",
                    "Descriptions in guide endpoints concern combat and are omitted from this normalized catalog.",
                    "Dimensions use the actual PNG header; full alpha and bounds inspection is limited to sampled roles.",
                ],
                "characters": catalog,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    errors = [m for group in measurements.values() for m in group.values() if m.get("error")]
    print(json.dumps({"roles": len(catalog), "images": len(jobs), "errors": errors}, ensure_ascii=False))


if __name__ == "__main__":
    main()
