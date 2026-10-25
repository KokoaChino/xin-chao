"""Merge verified source snapshots into a URL-based character asset manifest."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def read(name):
    return json.loads((ROOT / name).read_text())


def write(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main():
    profiles = read("wiki-character-profiles.json")
    art = {row["url"]: row for row in read("wiki-art-verified.json")}
    visual_checks = {row["url"]: row for row in read("quality-high-resolution.json")}
    selected = {row["entryId"]: row for row in read("wiki-selected-art.json")}
    wiki_avatars = {
        row["name"]: row for row in read("wiki-avatar-verified.json")["avatars"]
    }
    guide = {row["name"]: row for row in read("guide-catalog.json")["characters"]}
    community_file = ROOT / "community-avatar-catalog.json"
    community = {}
    if community_file.exists():
        catalog = read(community_file.name)
        if isinstance(catalog, dict):
            catalog = catalog.get("avatars", catalog.get("entries", []))
        community = {row["name"]: row for row in catalog if row.get("name")}

    def image(url, source, **extra):
        meta = art.get(url, {})
        result = {
            "url": url,
            "source": source,
            "width": meta.get("width"),
            "height": meta.get("height"),
            "bytes": meta.get("bytes"),
            "verification": meta.get("method", "Source link only"),
            **extra,
        }
        checked = visual_checks.get(url)
        if checked:
            result.update(
                {
                    "verification": checked["method"],
                    "alphaBounds": checked["nonZeroAlphaBounds"],
                    "hasTransparency": checked["alphaMinMax"][0] < 255,
                    "visualFindings": checked["visualFindings"],
                    "browserImageRender": checked["realBrowserImgRender"],
                }
            )
        return result

    characters = []
    for row in profiles:
        name = row["name"]
        profile = row["profile"]
        is_rover = name.startswith("漂泊者-")
        avatar_name = (
            ("女漂泊者" if profile.get("性别") == "女" else "男漂泊者")
            if is_rover else name
        )
        guide_name = f"漂泊者·{row['variant']}" if is_rover else name
        guide_row = guide.get(guide_name)
        community_avatar = community.get(avatar_name)
        wiki_avatar = wiki_avatars.get(avatar_name)
        avatar_candidates = []
        if community_avatar:
            avatar_candidates.append(
                {**community_avatar, "source": "community-avatar-picker"}
            )
        if wiki_avatar:
            avatar_candidates.append({**wiki_avatar, "source": "official-wiki"})
        if guide_row and not is_rover:
            avatar_candidates.append(
                {**guide_row["card"], "source": "official-guide"}
            )
        priority = {
            "community-avatar-picker": 3,
            "official-guide": 2,
            "official-wiki": 1,
        }
        avatar_candidates.sort(
            key=lambda asset: (
                min(asset.get("width") or 0, asset.get("height") or 0),
                priority[asset["source"]],
            ),
            reverse=True,
        )

        chosen = selected[row["entryId"]]
        illustrations = []
        for figure in row["figures"]:
            for field in ("url", "verticalFigureUrl"):
                url = figure.get(field)
                if url:
                    illustrations.append(
                        image(
                            url,
                            "official-wiki",
                            label=figure["name"],
                            sourceField=field,
                        )
                    )
        if guide_row:
            illustrations.append(
                {
                    "source": "official-guide",
                    "label": "Guide display portrait",
                    "composition": "mixed-gender" if is_rover else "cropped-portrait",
                    **guide_row["illustration"],
                }
            )
        skins = [
            {
                "name": skin["name"],
                "sourceSection": skin["section"],
                "images": [
                    image(url, "official-wiki") for url in skin["imageUrls"]
                ],
            }
            for skin in row["skins"]
        ]
        characters.append(
            {
                "id": f"wiki:{row['entryId']}",
                "wikiEntryId": row["entryId"],
                "guideRoleId": guide_row["id"] if guide_row else None,
                "name": name,
                "identityGroupCandidate": row["identityGroup"],
                "variant": row["variant"],
                "profile": {
                    "displayName": profile["displayName"],
                    "romanizedName": profile["romanizedName"],
                    "description": profile["description"],
                    "gender": profile.get("性别"),
                    "origin": profile.get("出生"),
                    "identity": profile.get("身份"),
                    "affiliation": profile.get("所属"),
                    "voiceActors": {
                        "zh": profile.get("中文CV"),
                        "ja": profile.get("日文CV"),
                        "en": profile.get("英文CV"),
                        "ko": profile.get("韩文CV"),
                    },
                },
                "sources": {
                    "wiki": row["sourcePage"],
                    "guide": guide_row["sourcePage"] if guide_row else None,
                },
                "assets": {
                    "preferredAvatar": avatar_candidates[0] if avatar_candidates else None,
                    "avatarAlternatives": avatar_candidates[1:],
                    "preferredIllustration": image(
                        chosen["originalUrl"],
                        "official-wiki",
                        label=chosen["label"],
                        selection="Source-labeled team artwork; review composition for UI",
                    ),
                    "avatarQualityNote": (
                        "Small source avatar. For large display, use verified high-resolution "
                        "character art with a reviewed face crop; do not upscale this thumbnail."
                        if avatar_candidates
                        and min(
                            avatar_candidates[0].get("width") or 0,
                            avatar_candidates[0].get("height") or 0,
                        ) < 500
                        else None
                    ),
                    "illustrations": illustrations,
                    "outfits": skins,
                },
                "voiceSamples": row["personalityVoiceSamples"],
                "scopeNotes": (
                    ["Preview artwork only in Wiki; absent from this guide snapshot"]
                    if not guide_row else []
                ),
            }
        )

    manifest = {
        "schemaVersion": 2,
        "checkedAt": "2026-10-23",
        "timezone": "Asia/Shanghai",
        "purpose": "Character preference ranking research; no ranking order is assigned.",
        "scopeStatus": "confirmed",
        "scopeDocument": "MATERIAL_SCOPE.md",
        "collectionStatus": "partial",
        "requirements": {
            "voiceLanguages": "all_available",
            "voiceCategories": ["personality", "combat", "outfit_specific_if_available"],
            "outfitsAndSkins": "required_for_collection_and_display",
            "characterArchivesAndStories": "full_content_required",
        },
        "sourceEntryCount": len(characters),
        "candidateIdentityGroupCount": len(
            {row["identityGroupCandidate"] for row in characters}
        ),
        "notes": [
            "Source entries are not a count of unique playable characters.",
            "Identity groups are candidates; raw variants are preserved.",
            "Wiki is hosted by the official community and includes community edits.",
            "No birthdays are inferred from birthday-greeting voice clips.",
            "voiceSamples currently contain selected Chinese personality clips only; "
            "all available languages and combat clips are required and remain to be collected.",
            "Voice samples have not been batch playback-tested.",
            "Additional outfits and skins must be collected and displayed; "
            "current outfit references are a partial snapshot.",
            "Image URLs remain remote. Source image files are not embedded.",
            "Preferred art reflects source labels; only samples were visually reviewed.",
            "Quality and CORS checks describe the acquisition date, not future uptime.",
        ],
        "sources": [
            "https://wiki.kurobbs.com/mc/home?bbs_clientSource=12",
            "https://www.kurobbs.com/person-center/edit-info?game=mc&valid=1",
            "https://mcguide.kurogames.com/zh-Hans/",
        ],
        "characters": characters,
    }
    write("asset-manifest.json", manifest)
    index_lines = [
        "# 鸣潮角色素材链接索引",
        "",
        "核验日期：2026-10-23。保留来源的 65 条记录，尚未决定排行榜分组和顺序。",
        "头像按实际像素择优；图像构图和透明边距的差别见 ASSET_RESEARCH.md。",
        "莉莉当前只有预告资料，没有在本轮来源中找到独立头像。",
        "",
        "| 来源角色条目 | 首选头像 | 首选立绘 | 原资料页 |",
        "| --- | --- | --- | --- |",
    ]
    for row in characters:
        avatar = row["assets"]["preferredAvatar"]
        illustration = row["assets"]["preferredIllustration"]
        avatar_link = (
            f"[{avatar['width']}×{avatar['height']}]({avatar['url']})"
            if avatar else "待补充"
        )
        art_link = (
            f"[{illustration['label']} {illustration['width']}×"
            f"{illustration['height']}]({illustration['url']})"
        )
        index_lines.append(
            f"| {row['name']} | {avatar_link} | {art_link} | "
            f"[Wiki]({row['sources']['wiki']}) |"
        )
    (ROOT / "character-assets.md").write_text("\n".join(index_lines) + "\n")
    print(
        json.dumps(
            {
                "sourceEntries": len(characters),
                "withAvatars": sum(
                    bool(row["assets"]["preferredAvatar"]) for row in characters
                ),
                "withCommunityAvatars": sum(
                    row["assets"]["preferredAvatar"] is not None
                    and row["assets"]["preferredAvatar"]["source"]
                    == "community-avatar-picker"
                    for row in characters
                ),
                "withIllustrations": sum(
                    bool(row["assets"]["preferredIllustration"]) for row in characters
                ),
                "output": str(ROOT / "asset-manifest.json"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
