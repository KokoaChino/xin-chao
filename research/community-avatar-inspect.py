"""Validate public avatar images and produce image-based naming candidates."""

import concurrent.futures
import io
import json
from pathlib import Path
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parent
TEMP = Path("/tmp/mc-community-avatar-check")
TEMP.mkdir(exist_ok=True)
SOURCE = json.loads((ROOT / "community-avatar-dom.json").read_text())
WIKI = json.loads((ROOT / "wiki-avatar-catalog.json").read_text())


def fetch(job):
    group, index, url = job
    local = TEMP / f"{group}-{index}.png"
    request = urllib.request.Request(
        url,
        headers={
            "Origin": "http://localhost:4173",
            "Referer": "http://localhost:4173/",
            "User-Agent": "Mozilla/5.0",
        },
    )
    result = {"index": index, "url": url}
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            data = response.read()
            result.update(
                httpStatus=response.status,
                contentType=response.headers.get("Content-Type"),
                corsAllowOrigin=response.headers.get("Access-Control-Allow-Origin"),
                fileBytes=len(data),
            )
        image = Image.open(io.BytesIO(data))
        image.load()
        alpha = image.convert("RGBA").getchannel("A")
        result.update(
            width=image.width,
            height=image.height,
            format=image.format,
            mode=image.mode,
            fullDecodeVerified=True,
            alphaExtrema=alpha.getextrema(),
            hasTransparency=alpha.getextrema()[0] < 255,
            visibleBounds=alpha.getbbox(),
        )
        local.write_bytes(data)
    except Exception as error:
        result["error"] = str(error)
    return group, result


def vector(path, crop):
    image = Image.open(path).convert("RGBA")
    if crop:
        bounds = image.getchannel("A").point(lambda value: 255 if value > 32 else 0).getbbox()
        if bounds:
            image = image.crop(bounds)
    image = ImageOps.contain(image, (96, 96), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (96, 96), "#909090")
    canvas.alpha_composite(image, ((96 - image.width) // 2, (96 - image.height) // 2))
    return np.asarray(canvas.convert("RGB"), dtype=np.float32) / 255.0


def phash(vector):
    image = Image.fromarray((vector * 255).astype(np.uint8)).convert("L").resize((32, 32))
    data = np.asarray(image, dtype=np.float32)
    indexes = np.arange(32)
    matrix = np.cos(np.pi * np.arange(8)[:, None] * (2 * indexes[None, :] + 1) / 64)
    coefficients = matrix @ data @ matrix.T
    coefficients = coefficients.flatten()[1:]
    return coefficients > np.median(coefficients)


def main():
    jobs = [
        ("community", index, SOURCE["baseUrl"] + path)
        for index, path in enumerate(SOURCE["pathsInObservedOrder"])
    ] + [("wiki", index, row["url"]) for index, row in enumerate(WIKI)]
    rows = {"community": [], "wiki": []}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for group, row in pool.map(fetch, jobs):
            rows[group].append(row)
    (ROOT / "community-avatar-checks.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2) + "\n"
    )
    wiki_vectors = {
        index: [vector(TEMP / f"wiki-{index}.png", crop) for crop in (False, True)]
        for index, row in enumerate(rows["wiki"])
        if not row.get("error")
    }
    wiki_hashes = {index: [phash(v) for v in vectors] for index, vectors in wiki_vectors.items()}
    candidates = []
    for row in rows["community"]:
        if row.get("error"):
            continue
        index = row["index"]
        vectors = [vector(TEMP / f"community-{index}.png", crop) for crop in (False, True)]
        hashes = [phash(v) for v in vectors]
        scores = []
        for wiki_index, wiki_vector in wiki_vectors.items():
            mse = min(
                float(np.square(a - b).mean())
                for a in vectors
                for b in wiki_vector
            )
            hash_distance = min(
                int(np.not_equal(a, b).sum())
                for a in hashes
                for b in wiki_hashes[wiki_index]
            )
            scores.append(
                {
                    "wikiIndex": wiki_index,
                    "name": WIKI[wiki_index]["name"],
                    "entryId": WIKI[wiki_index]["entryId"],
                    "url": WIKI[wiki_index]["url"],
                    "normalizedMSE": round(mse, 6),
                    "pHashDistance": hash_distance,
                    "score": round(mse + hash_distance * 0.0015, 6),
                }
            )
        scores.sort(key=lambda score: score["score"])
        candidates.append({"index": index, "candidates": scores[:4]})
    (ROOT / "community-avatar-candidates.json").write_text(
        json.dumps(candidates, ensure_ascii=False, indent=2) + "\n"
    )
    for start in range(0, len(candidates), 15):
        subset = candidates[start : start + 15]
        sheet = Image.new("RGB", (750, len(subset) * 140), "#e7e8eb")
        draw = ImageDraw.Draw(sheet)
        for row_index, item in enumerate(subset):
            images = [("community", item["index"], f"C {item['index']}")] + [
                ("wiki", candidate["wikiIndex"], f"W {candidate['wikiIndex']}  d={candidate['pHashDistance']}")
                for candidate in item["candidates"]
            ]
            for col, (group, index, label) in enumerate(images):
                avatar = ImageOps.contain(
                    Image.open(TEMP / f"{group}-{index}.png").convert("RGBA"),
                    (120, 120),
                    Image.Resampling.LANCZOS,
                )
                sheet.paste(avatar, (col * 150 + 15, row_index * 140 + 18), avatar)
                draw.text((col * 150 + 12, row_index * 140 + 2), label, fill="black")
        sheet.save(TEMP / f"matches-{start}.jpg")
    print(json.dumps({"community": len(rows["community"]), "wiki": len(rows["wiki"]),
                      "errors": [row for group in rows.values() for row in group if row.get("error")]},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
