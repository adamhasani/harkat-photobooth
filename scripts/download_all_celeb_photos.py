#!/usr/bin/env python3
"""
Download real portrait photos for all celebrities in celebs_database.json
Saves compressed JPEGs to /root/harkat-photobooth/assets/celebs_cache/<slug>.jpg
"""

import os
import re
import json
import time
import urllib.request
import urllib.parse
import io
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

CACHE_DIR = "/root/harkat-photobooth/assets/celebs_cache"
DB_PATH = "/root/harkat-photobooth/assets/data/celebs_database.json"
os.makedirs(CACHE_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def clean_name_str(raw_name):
    # Remove emojis and unwanted chars
    clean = re.sub(r'[\U00010000-\U0010ffff]', '', raw_name).strip()
    clean = re.sub(r'[^\w\s.,-]', '', clean, flags=re.UNICODE).strip()
    return clean

def get_slug(name):
    clean = clean_name_str(name).lower()
    slug = re.sub(r'[^a-z0-9]+', '_', clean).strip('_')
    return slug

def search_bing(clean_name, role=""):
    queries = [
        f"{clean_name} portrait photo",
        f"{clean_name} {role}".strip() if role else f"{clean_name} face"
    ]
    for q in queries:
        try:
            url = "https://www.bing.com/images/search?q=" + urllib.parse.quote(q)
            req = urllib.request.Request(url, headers=HEADERS)
            html = urllib.request.urlopen(req, timeout=7).read().decode("utf-8", errors="ignore")
            urls = re.findall(r'murl&quot;:&quot;(http[^&]+)&quot;', html)
            if urls:
                return urls[:5]
        except Exception:
            continue
    return []

def search_wiki(clean_name):
    for lang in ["id", "en"]:
        try:
            url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(clean_name)}"
            req = urllib.request.Request(url, headers={"User-Agent": "HarkatPhotobooth/1.0 (contact@harkat.id)"})
            data = json.loads(urllib.request.urlopen(req, timeout=5).read().decode("utf-8"))
            img_src = data.get("thumbnail", {}).get("source") or data.get("originalimage", {}).get("source")
            if img_src:
                return [img_src]
        except Exception:
            pass
    return []

def download_image(url_list, target_path):
    for u in url_list:
        try:
            req = urllib.request.Request(u, headers=HEADERS)
            data = urllib.request.urlopen(req, timeout=8).read()
            if len(data) < 2500:
                continue
            im = Image.open(io.BytesIO(data))
            im = im.convert("RGB")
            # Don't save banner-like or tiny images
            if im.width < 100 or im.height < 100:
                continue
            # Resize if too large for speed & small disk footprint
            if im.width > 600 or im.height > 800:
                im.thumbnail((600, 800), Image.Resampling.LANCZOS)
            im.save(target_path, "JPEG", quality=85)
            return True
        except Exception:
            continue
    return False

def process_celeb(celeb):
    name = celeb["name"]
    clean_name = celeb.get("clean_name") or clean_name_str(name)
    slug = get_slug(clean_name)
    target_path = os.path.join(CACHE_DIR, f"{slug}.jpg")

    if os.path.exists(target_path) and os.path.getsize(target_path) > 2500:
        return {"slug": slug, "status": "exists", "name": clean_name}

    role = celeb.get("role", "")

    # Try Bing first
    urls = search_bing(clean_name, role)
    if urls and download_image(urls, target_path):
        return {"slug": slug, "status": "downloaded_bing", "name": clean_name}

    # Try Wiki
    wiki_urls = search_wiki(clean_name)
    if wiki_urls and download_image(wiki_urls, target_path):
        return {"slug": slug, "status": "downloaded_wiki", "name": clean_name}

    return {"slug": slug, "status": "failed", "name": clean_name}

def main():
    with open(DB_PATH, "r", encoding="utf-8") as f:
        celebs = json.load(f)

    # Sort priorities: Indonesian first, then actors, musicians, etc.
    def priority_score(c):
        country = c.get("country", "")
        category = c.get("category", "")
        if "Indonesia" in country or "Indonesia" in category:
            return 0
        if "Artis" in category or "Aktor" in category or "Bintang Film" in category:
            return 1
        if "Musisi" in category or "Kreator" in category:
            return 2
        return 3

    celebs.sort(key=priority_score)
    total = len(celebs)
    print(f"Starting photo download for {total} celebrities...")

    success = 0
    skipped = 0
    failed = 0
    failed_names = []

    # Run with 10 threads
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(process_celeb, c): c for c in celebs}
        count = 0
        for future in as_completed(futures):
            res = future.result()
            count += 1
            if res["status"] == "exists":
                skipped += 1
            elif res["status"].startswith("downloaded"):
                success += 1
            else:
                failed += 1
                failed_names.append(res["name"])

            if count % 25 == 0 or count == total:
                print(f"Progress: {count}/{total} (New: {success}, Cached: {skipped}, Failed: {failed})")

    print("\n=== SUMMARY ===")
    print(f"Total processed: {total}")
    print(f"Successfully cached/downloaded: {success + skipped}")
    print(f"Newly downloaded: {success}")
    print(f"Already cached: {skipped}")
    print(f"Failed: {failed}")
    if failed_names:
        print(f"Failed samples: {failed_names[:10]}")

if __name__ == "__main__":
    main()
