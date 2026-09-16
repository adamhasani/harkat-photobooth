#!/usr/bin/env python3
"""
Generate comprehensive, 100% individual & diverse keywords & descriptions database
for 1,000 Celebrities & Historical Figures.

Guarantees:
- 100% unique physical descriptions (1000/1000)
- Distinct keyword tags derived from individual traits, facial geometry, ethnicity & role
- Preserves biometrics, local photo cache links, and categories
- Outputs to JSON, CSV, JS module and syncs main database files
"""

import json
import os
import re
import csv
import unicodedata

OUT_JSON = "/root/harkat-photobooth/assets/data/celebs_keywords_1000.json"
OUT_CSV = "/root/harkat-photobooth/assets/data/celebs_keywords_1000.csv"
OUT_JS = "/root/harkat-photobooth/assets/data/celebs_keywords_1000.js"
SYNC_DB_JSON = "/root/harkat-photobooth/assets/data/celebs_database.json"
SYNC_DB_JS = "/root/harkat-photobooth/assets/data/celebs_database.js"
REPLACEMENTS_FILE = "/root/harkat-photobooth/assets/data/replacements_55.json"

# 1. Load baseline data
with open(SYNC_DB_JSON, "r", encoding="utf-8") as f:
    celebs = json.load(f)

print(f"Loaded {len(celebs)} celebrities baseline.")

# Load replacements for 55 duplicate entries
with open(REPLACEMENTS_FILE, "r", encoding="utf-8") as f:
    REPLACEMENTS_55 = json.load(f)

def clean_emoji(text):
    if not text: return ""
    return re.sub(r'[\U00010000-\U0010ffff\u2600-\u27ff\ufe0f]', '', text).strip()

def slugify(text):
    text = clean_emoji(text)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "_", text)

def format_tag(text):
    t = slugify(text)
    return re.sub(r'_+', '_', t).strip('_')

# Deduplicate celebs
seen = {}
dup_indices = []
for i, c in enumerate(celebs):
    name = clean_emoji(c.get("clean_name", c.get("name", ""))).strip()
    if name in seen:
        dup_indices.append(i)
    else:
        seen[name] = i

print(f"Replacing {len(dup_indices)} duplicate entries...")
for idx, r_data in zip(dup_indices, REPLACEMENTS_55):
    cid = f"celeb_{idx+1:04d}"
    raw_name = r_data[0]
    clean_name = clean_emoji(raw_name)
    gender = r_data[1]
    category = r_data[2]
    country = r_data[3]
    era = r_data[4]
    role = r_data[5]
    avatar = r_data[6]
    face_shape = r_data[7]
    eye_ratio = r_data[8]
    jaw_ratio = r_data[9]
    gonion_ratio = r_data[10]
    chin_ratio = r_data[11]
    nose_ratio = r_data[12]
    lip_ratio = r_data[13]
    brow_arch = r_data[14]
    smile_val = r_data[15]
    forehead_ratio = r_data[16]
    traits = r_data[17]
    comment = r_data[18]
    
    celebs[idx] = {
        "id": cid,
        "name": raw_name,
        "clean_name": clean_name,
        "gender": gender,
        "category": category,
        "country": country,
        "era": era,
        "role": role,
        "avatar": avatar,
        "faceShape": face_shape,
        "eyeRatio": eye_ratio,
        "jaw": jaw_ratio,
        "gonionRatio": gonion_ratio,
        "chinRatio": chin_ratio,
        "noseRatio": nose_ratio,
        "lipRatio": lip_ratio,
        "browArch": brow_arch,
        "smile": smile_val,
        "foreheadRatio": forehead_ratio,
        "traits": traits,
        "comment": comment
    }

def parse_person(c, idx):
    cid = c.get("id", f"celeb_{idx+1:04d}")
    raw_name = c.get("name", "")
    clean_name = clean_emoji(raw_name)
    gender = c.get("gender", "Laki-laki")
    is_male = (gender == "Laki-laki")
    category = c.get("category", "")
    clean_category = clean_emoji(category)
    country = c.get("country", "")
    clean_country = clean_emoji(country).split("/")[0].strip()
    era = c.get("era", "")
    role = c.get("role", "")
    clean_role = clean_emoji(role)
    avatar = c.get("avatar", "⭐")
    face_shape = c.get("faceShape", "Oval")
    traits = c.get("traits", [])
    comment = c.get("comment", "")
    
    # Check if biometrics nested or flat
    bio = c.get("biometrics", {})
    eye_ratio = c.get("eyeRatio", bio.get("eyeRatio", 0.38))
    jaw_ratio = c.get("jaw", bio.get("jaw", 0.55))
    gonion_ratio = c.get("gonionRatio", bio.get("gonionRatio", 0.70))
    chin_ratio = c.get("chinRatio", bio.get("chinRatio", 0.60))
    nose_ratio = c.get("noseRatio", bio.get("noseRatio", 0.27))
    lip_ratio = c.get("lipRatio", bio.get("lipRatio", 0.34))
    brow_arch = c.get("browArch", bio.get("browArch", 0.10))
    smile_val = c.get("smile", bio.get("smile", 0.55))
    forehead_ratio = c.get("foreheadRatio", bio.get("foreheadRatio", 0.30))
    
    photo_slug = slugify(clean_name)
    local_photo = f"/assets/celebs_cache/{photo_slug}.jpg"
    
    eye_trait = None
    brow_trait = None
    nose_trait = None
    mouth_trait = None
    jaw_trait = None
    hair_trait = None
    special_traits = []
    
    for tr in traits:
        trl = tr.lower()
        matched = False
        # Eyes
        if re.search(r'\b(mata|sorot|tatapan|pandangan|doe-eyed|sanpaku|kelopak|zamrud|biru es)\b', trl) and not re.search(r'\bkacamata\b', trl):
            if not eye_trait:
                eye_trait = tr
                matched = True
        # Eyebrows / Forehead
        elif re.search(r'\b(alis|dahi|kening)\b', trl):
            if not brow_trait:
                brow_trait = tr
                matched = True
        # Nose
        elif re.search(r'\b(hidung|cuping|dorsal)\b', trl):
            if not nose_trait:
                nose_trait = tr
                matched = True
        # Mouth / Smile / Lips
        elif re.search(r'\b(senyum|bibir|mulut|lesung pipi)\b', trl):
            if not mouth_trait:
                mouth_trait = tr
                matched = True
        # Jaw / Chin / Face contour
        elif re.search(r'\b(rahang|dagu|pipi|tirus|chiseled|kontur wajah|proporsi wajah|simetri wajah)\b', trl):
            if not jaw_trait:
                jaw_trait = tr
                matched = True
        # Hair / Facial Hair
        elif re.search(r'\b(rambut|kuncir|ikal|botak|pirang|jenggot|kumis|cambang)\b', trl):
            if not hair_trait:
                hair_trait = tr
                matched = True
        
        # If accessory or unique marker
        if re.search(r'\b(kacamata|baret|turtleneck|jas|peci|topi|mahkota|bintang|selendang|bando|kostum)\b', trl) or not matched:
            special_traits.append(tr)

    # 1. ALIS
    alis_tags = set()
    if brow_trait:
        alis_desc = f"{brow_trait}, menyatu dengan garis dahi"
        alis_tags.add(format_tag(brow_trait))
    elif brow_arch >= 0.118:
        alis_desc = "Alis melengkung tinggi (high-arch) anggun dan presisi"
        alis_tags.update(["alis_high_arch", "alis_melengkung"])
    elif brow_arch <= 0.088:
        alis_desc = "Alis lurus mendatar (straight-brow) tegas maskulin" if is_male else "Alis lurus lembut natural gaya oriental modern"
        alis_tags.update(["alis_lurus", "alis_tegas" if is_male else "alis_natural"])
    elif is_male:
        alis_desc = "Alis tebal natural berkarakter maskulin dengan proporsi simetris"
        alis_tags.update(["alis_tebal", "alis_maskulin", "alis_natural"])
    else:
        alis_desc = "Alis proporsional tersisir rapi dengan lekukan busur alami yang lembut"
        alis_tags.update(["alis_proporsional", "alis_lembut", "alis_natural"])

    # 2. MATA
    mata_tags = set()
    if eye_trait:
        mata_desc = f"{eye_trait}"
        mata_tags.add(format_tag(eye_trait))
        if "tatap" in eye_trait.lower(): mata_tags.add("tatapan_fokus")
        if "tajam" in eye_trait.lower(): mata_tags.add("mata_tajam")
        if "hangat" in eye_trait.lower(): mata_tags.add("tatapan_hangat")
        if "doe" in eye_trait.lower(): mata_tags.add("doe_eyed")
        if "bulat" in eye_trait.lower(): mata_tags.add("mata_bulat")
    elif eye_ratio >= 0.395:
        mata_desc = "Mata bulat besar ekspresif dengan bukaan kelopak lebar yang memikat"
        mata_tags.update(["mata_bulat", "mata_ekspresif", "kelopak_lebar"])
    elif eye_ratio <= 0.345:
        mata_desc = "Mata sipit monolid tajam khas oriental dengan tatapan fokus tenang"
        mata_tags.update(["mata_sipit", "mata_monolid", "tatapan_fokus"])
    elif is_male:
        mata_desc = "Mata almond proporsional simetris dengan sorot tatapan berkarisma"
        mata_tags.update(["mata_almond", "tatapan_karismatik", "sorot_tajam"])
    else:
        mata_desc = "Mata almond proporsional dengan sorot mata hangat berbinar cerdas"
        mata_tags.update(["mata_almond", "tatapan_hangat", "mata_berbinar"])

    # 3. HIDUNG
    hidung_tags = set()
    if nose_trait:
        hidung_desc = f"{nose_trait}"
        hidung_tags.add(format_tag(nose_trait))
    elif nose_ratio >= 0.295:
        hidung_desc = "Hidung mancung tegas dengan batang hidung tinggi berwibawa"
        hidung_tags.update(["hidung_mancung", "hidung_batang_tinggi", "hidung_tegas"])
    elif nose_ratio <= 0.252:
        hidung_desc = "Hidung mungil ramping proporsional dengan lekukan ujung halus natural"
        hidung_tags.update(["hidung_mungil", "hidung_ramping", "hidung_halus"])
    elif "eropa" in country.lower() or "jerman" in country.lower() or "inggris" in country.lower() or "as " in country.lower() or "prancis" in country.lower():
        hidung_desc = "Hidung mancung lurus klasik dengan garis tulang hidung tegas"
        hidung_tags.update(["hidung_mancung", "hidung_lurus_klasik"])
    else:
        hidung_desc = "Hidung proporsional natural seimbang selaras dengan lebar cuping ideal"
        hidung_tags.update(["hidung_proporsional", "hidung_natural"])

    # 4. MULUT & SENYUM
    mulut_tags = set()
    if mouth_trait:
        mulut_desc = f"{mouth_trait}"
        mulut_tags.add(format_tag(mouth_trait))
        if "lesung" in mouth_trait.lower(): mulut_tags.add("lesung_pipi")
        if "manis" in mouth_trait.lower(): mulut_tags.add("senyum_manis")
        if "lebar" in mouth_trait.lower(): mulut_tags.add("senyum_lebar")
        if "hangat" in mouth_trait.lower(): mulut_tags.add("senyum_hangat")
    else:
        if smile_val >= 0.72:
            s_desc = "senyuman lebar terbuka ceria yang memancarkan aura positif bersahabat"
            mulut_tags.update(["senyum_lebar", "senyum_ceria"])
        elif smile_val <= 0.38:
            s_desc = "garis bibir tenang terkatup rapat mencerminkan keteguhan prinsip"
            mulut_tags.update(["bibir_terkatup_tegas", "ekspresi_tenang"])
        elif smile_val >= 0.56:
            s_desc = "senyuman simpul hangat bersahaja yang bersahabat"
            mulut_tags.update(["senyum_simpul", "senyum_hangat"])
        else:
            s_desc = "garis senyum tipis rileks dan proporsional"
            mulut_tags.update(["senyum_tipis", "senyum_proporsional"])
            
        if lip_ratio >= 0.38:
            mulut_desc = f"Bibir penuh bervolume sehat dengan {s_desc}"
            mulut_tags.add("bibir_penuh")
        elif lip_ratio <= 0.30:
            mulut_desc = f"Bibir tipis proporsional dengan {s_desc}"
            mulut_tags.add("bibir_tipis")
        else:
            mulut_desc = f"Bibir proporsional simetris dengan {s_desc}"
            mulut_tags.add("bibir_proporsional")

    # 5. DAGU & RAHANG
    dagu_tags = set()
    if jaw_trait:
        dagu_desc = f"{jaw_trait}"
        dagu_tags.add(format_tag(jaw_trait))
    elif "square" in face_shape.lower() or gonion_ratio >= 0.75:
        dagu_desc = "Dagu persegi kokoh dengan rahang menyudut tegas maskulin" if is_male else "Dagu bergaris tegas terdefinisi dengan tulang rahang simetris berwibawa"
        dagu_tags.update(["dagu_persegi", "rahang_kokoh", "rahang_menyudut"])
    elif "heart" in face_shape.lower() or "diamond" in face_shape.lower() or chin_ratio <= 0.56:
        dagu_desc = "Dagu tirus V-shape ramping terpahat harmonis"
        dagu_tags.update(["dagu_tirus", "v_shape", "dagu_ramping"])
    elif "round" in face_shape.lower():
        dagu_desc = "Dagu membulat halus menciptakan transisi garis pipi yang lembut"
        dagu_tags.update(["dagu_membulat", "kontur_lembut", "pipi_penuh"])
    elif "oblong" in face_shape.lower():
        dagu_desc = "Dagu memanjang terdefinisi khas kontur wajah regal bangsawan dan pemikir"
        dagu_tags.update(["dagu_memanjang", "kontur_regal", "dagu_berwibawa"])
    else:
        dagu_desc = "Dagu oval proporsional menyatu dengan lekukan rahang yang mulus"
        dagu_tags.update(["dagu_oval", "rahang_proporsional"])

    # 6. RAMBUT & CIRI KHUSUS
    rambut_tags = set()
    if hair_trait:
        rambut_desc = f"{hair_trait}"
        rambut_tags.add(format_tag(hair_trait))
    elif is_male:
        rambut_desc = "Gaya rambut rapi teratur berkarakter maskulin klasik"
        rambut_tags.add("rambut_rapi_klasik")
    else:
        rambut_desc = "Gaya tatanan rambut anggun alami yang membingkai wajah dengan harmonis"
        rambut_tags.add("rambut_anggun_natural")

    ciri_khusus_str = ", ".join(special_traits) if special_traits else (hair_trait or "Proporsi simetri wajah yang seimbang")
    ciri_khusus_tags = [format_tag(t) for t in (special_traits if special_traits else [ciri_khusus_str])]

    # 7. SINTESIS DESKRIPSI FISIK INDIVIDUAL (100% DISTINCT)
    deskripsi_templates = [
        f"{clean_name} ({clean_role}) menampilkan profil visual berkarakter dengan struktur wajah {face_shape}. Fokus pandangan ditandai oleh {mata_desc.lower()}, diselaraskan oleh {alis_desc.lower()}. Pada area midface, tampak {hidung_desc.lower()}, berpadu serasi dengan {mulut_desc.lower()}. Garis bawah wajah dipertegas oleh {dagu_desc.lower()}, disempurnakan oleh {rambut_desc.lower()}. Ciri khas yang paling menonjol pada penampilannya meliputi {ciri_khusus_str}.",
        f"Merepresentasikan figur {clean_role}, {clean_name} memiliki proporsi wajah {face_shape} yang harmonis. Karakteristik utamanya terpancar dari {mata_desc.lower()} berpadu dengan {alis_desc.lower()}. Struktur hidung terlihat {hidung_desc.lower()}, berdampingan dengan {mulut_desc.lower()}. Kontur rahang diperkuat oleh {dagu_desc.lower()} dan disempurnakan oleh {rambut_desc.lower()}, mencerminkan identitas visual yang khas ({ciri_khusus_str}).",
        f"Dengan arsitektur wajah {face_shape}, {clean_name} mengekspresikan aura {clean_role}. Visual wajah menampilkan {mata_desc.lower()} serta {alis_desc.lower()}. Keseimbangan fitur wajah terlihat dari {hidung_desc.lower()} dan bentuk {mulut_desc.lower()}. Siluet wajah dibingkai oleh {dagu_desc.lower()} dengan tatanan {rambut_desc.lower()}, memberikan kesan autentik didukung oleh {ciri_khusus_str}.",
        f"Karakteristik visual {clean_name} ({clean_role}) ditandai oleh geometri wajah {face_shape}. Penampilan diperkuat oleh {mata_desc.lower()} yang dipadukan dengan {alis_desc.lower()}. Di bagian tengah wajah, terdapat {hidung_desc.lower()} yang selaras dengan {mulut_desc.lower()}. Bagian bawah wajah menonjolkan {dagu_desc.lower()}, dilengkapi oleh {rambut_desc.lower()}, serta diperkaya oleh sentuhan {ciri_khusus_str}.",
        f"Menampilkan pesona autentik {clean_name} ({clean_role}) dengan arsitektur wajah {face_shape} yang harmonis. Fokus pandangan ditandai oleh {mata_desc.lower()}, diselaraskan oleh {alis_desc.lower()}. Pada area midface, tampak {hidung_desc.lower()}, berpadu serasi dengan {mulut_desc.lower()}. Garis bawah wajah dipertegas oleh {dagu_desc.lower()}, disempurnakan oleh {rambut_desc.lower()} dengan ciri khas {ciri_khusus_str}."
    ]
    template_idx = idx % len(deskripsi_templates)
    deskripsi_fisik = deskripsi_templates[template_idx]

    # 8. KEYWORDS TAGS GENERATION
    kw_identitas = [slugify(clean_name)]
    name_parts = slugify(clean_name).split('_')
    for np in name_parts:
        if len(np) > 2: kw_identitas.append(np)
    kw_identitas = list(dict.fromkeys(kw_identitas))

    kw_kategori = [format_tag(clean_category)]
    kw_asal = [format_tag(clean_country)]
    kw_bentuk_wajah = [f"wajah_{format_tag(face_shape)}"]

    all_tags = set()
    all_tags.update(kw_identitas)
    all_tags.update(kw_kategori)
    all_tags.update([f"asal_{format_tag(clean_country)}"])
    all_tags.update(kw_bentuk_wajah)
    all_tags.update(alis_tags)
    all_tags.update(mata_tags)
    all_tags.update(hidung_tags)
    all_tags.update(mulut_tags)
    all_tags.update(dagu_tags)
    all_tags.update(rambut_tags)
    all_tags.update(ciri_khusus_tags)
    
    role_words = [slugify(w) for w in clean_role.split() if len(w) > 3 and not re.search(r'\b(dan|yang|dengan|pada|atau)\b', w.lower())]
    all_tags.update(role_words)
    all_tags.add("pria" if is_male else "wanita")
    all_tags.add("laki_laki" if is_male else "perempuan")

    clean_all_tags = sorted(list(set(t for t in all_tags if t and len(t) > 1 and not t.isdigit())))

    return {
        "id": cid,
        "name": raw_name,
        "clean_name": clean_name,
        "gender": gender,
        "category": category,
        "country": country,
        "era": era,
        "role": role,
        "avatar": avatar,
        "faceShape": face_shape,
        "features": {
            "alis": alis_desc,
            "mata": mata_desc,
            "hidung": hidung_desc,
            "mulut": mulut_desc,
            "dagu": dagu_desc,
            "rambut": rambut_desc,
            "bentuk_wajah": face_shape,
            "ciri_khusus": ciri_khusus_str
        },
        "deskripsi_fisik": deskripsi_fisik,
        "keywords": {
            "identitas": kw_identitas,
            "kategori": kw_kategori,
            "asal": kw_asal,
            "bentuk_wajah": kw_bentuk_wajah,
            "alis": sorted(list(alis_tags)),
            "mata": sorted(list(mata_tags)),
            "hidung": sorted(list(hidung_tags)),
            "mulut": sorted(list(mulut_tags)),
            "dagu": sorted(list(dagu_tags)),
            "rambut": sorted(list(rambut_tags)),
            "ciri_khusus": ciri_khusus_tags,
            "semua_tags": clean_all_tags
        },
        "traits": traits if traits else [mata_desc, alis_desc, ciri_khusus_str],
        "comment": comment or "Struktur wajah simetris dengan ekspresi positif & berkarisma!",
        "local_photo": local_photo,
        "biometrics": {
            "eyeRatio": round(eye_ratio, 3),
            "jaw": round(jaw_ratio, 3),
            "gonionRatio": round(gonion_ratio, 3),
            "chinRatio": round(chin_ratio, 3),
            "noseRatio": round(nose_ratio, 3),
            "lipRatio": round(lip_ratio, 3),
            "browArch": round(brow_arch, 3),
            "foreheadRatio": round(forehead_ratio, 3),
            "smile": round(smile_val, 3)
        }
    }

# Process all 1,000 entries
final_database = []
for i, c in enumerate(celebs):
    entry = parse_person(c, i)
    final_database.append(entry)

print(f"Processed {len(final_database)} complete celebrity profiles.")

# 1. Write OUT_JSON and SYNC_DB_JSON
with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(final_database, f, indent=2, ensure_ascii=False)
print(f"Written JSON to {OUT_JSON} ({os.path.getsize(OUT_JSON):,} bytes)")

with open(SYNC_DB_JSON, "w", encoding="utf-8") as f:
    json.dump(final_database, f, indent=2, ensure_ascii=False)
print(f"Synced DB JSON to {SYNC_DB_JSON} ({os.path.getsize(SYNC_DB_JSON):,} bytes)")

# 2. Write OUT_CSV
csv_fields = [
    "id", "name", "gender", "category", "country", "era", "role", "faceShape",
    "deskripsi_fisik", "keywords_tags", "eyeRatio", "jaw", "gonionRatio", "chinRatio",
    "noseRatio", "lipRatio", "browArch", "foreheadRatio", "smile", "comment", "traits",
    "ciri_khusus", "local_photo"
]

with open(OUT_CSV, "w", encoding="utf-8", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=csv_fields)
    writer.writeheader()
    for item in final_database:
        bio = item["biometrics"]
        writer.writerow({
            "id": item["id"],
            "name": item["clean_name"],
            "gender": item["gender"],
            "category": item["category"],
            "country": item["country"],
            "era": item["era"],
            "role": item["role"],
            "faceShape": item["faceShape"],
            "deskripsi_fisik": item["deskripsi_fisik"],
            "keywords_tags": ", ".join(item["keywords"]["semua_tags"]),
            "eyeRatio": bio["eyeRatio"],
            "jaw": bio["jaw"],
            "gonionRatio": bio["gonionRatio"],
            "chinRatio": bio["chinRatio"],
            "noseRatio": bio["noseRatio"],
            "lipRatio": bio["lipRatio"],
            "browArch": bio["browArch"],
            "foreheadRatio": bio["foreheadRatio"],
            "smile": bio["smile"],
            "comment": item["comment"],
            "traits": "; ".join(item["traits"]),
            "ciri_khusus": item["features"]["ciri_khusus"],
            "local_photo": item["local_photo"]
        })
print(f"Written CSV to {OUT_CSV} ({os.path.getsize(OUT_CSV):,} bytes)")

# 3. Write OUT_JS and SYNC_DB_JS
js_header = """// HARKAT Photobooth Celebs Database (1,000 photos with distinct descriptions & rich keywords)
(function(root) {
  'use strict';
  
  const CELEBS_DATABASE = """

js_footer = """;
  const CELEBS_DATABASE_1000 = CELEBS_DATABASE;

  const SHAPE_COMPATIBILITY = {
    'Oval': { 'Oval': 0.0, 'Round / Soft': 0.03, 'Heart / V-Shape': 0.03, 'Diamond / Chiseled': 0.04, 'Oblong / Regal': 0.05, 'Square / Angular': 0.07 },
    'Heart / V-Shape': { 'Heart / V-Shape': 0.0, 'Oval': 0.03, 'Diamond / Chiseled': 0.03, 'Round / Soft': 0.06, 'Oblong / Regal': 0.07, 'Square / Angular': 0.09 },
    'Square / Angular': { 'Square / Angular': 0.0, 'Diamond / Chiseled': 0.03, 'Round / Soft': 0.05, 'Oval': 0.06, 'Oblong / Regal': 0.07, 'Heart / V-Shape': 0.10 },
    'Round / Soft': { 'Round / Soft': 0.0, 'Oval': 0.03, 'Heart / V-Shape': 0.05, 'Square / Angular': 0.06, 'Diamond / Chiseled': 0.07, 'Oblong / Regal': 0.10 },
    'Oblong / Regal': { 'Oblong / Regal': 0.0, 'Oval': 0.04, 'Diamond / Chiseled': 0.05, 'Square / Angular': 0.06, 'Round / Soft': 0.09, 'Heart / V-Shape': 0.08 },
    'Diamond / Chiseled': { 'Diamond / Chiseled': 0.0, 'Heart / V-Shape': 0.03, 'Square / Angular': 0.03, 'Oval': 0.04, 'Oblong / Regal': 0.05, 'Round / Soft': 0.07 }
  };

  function parseCelebEstAge(c) {
    if (typeof c.estAge === 'number') return c.estAge;
    const era = c.era || '';
    const m = era.match(/\\b(19\\d\\d|20\\d\\d)\\b/);
    if (m) {
      const birth = parseInt(m[1], 10);
      return Math.max(18, Math.min(85, 2026 - birth));
    }
    if (era.includes('Kuno') || era.includes('SM') || era.includes('Klasik') || era.includes('Sejarah')) return 60;
    return 30;
  }

  /**
   * High-Precision Multi-Factor Biometric Matching Algorithm across 1,000 Celebrities & Historical Figures.
   * @param {object} userVector Morphometric ratios from MediaPipe 3D Landmark analyzer
   * @param {object} options Filter options (gender, category, age, topK, randomizeTop)
   * @returns {{ bestMatch: object, matchPct: number, distance: number, topMatches: Array }}
   */
  function findBestLookalike(userVector, options) {
    userVector = userVector || {};
    options = options || {};
    const targetGender = options.gender || null;
    const targetCat = options.category || null;
    const userAge = typeof options.age === 'number' ? options.age : (typeof userVector.estAge === 'number' ? userVector.estAge : 22);
    const topK = options.topK || 5;
    const randomizeTop = options.randomizeTop !== false;
    
    let pool = CELEBS_DATABASE_1000;
    if (targetGender) {
      const gNorm = targetGender.toLowerCase();
      pool = pool.filter(c => c.gender && c.gender.toLowerCase().startsWith(gNorm.startsWith('perem') || gNorm.startsWith('fem') ? 'perem' : 'laki'));
    }
    if (targetCat) {
      pool = pool.filter(c => c.category === targetCat);
    }
    if (!pool.length) pool = CELEBS_DATABASE_1000;
    
    const userEye = typeof userVector.eyeRatio === 'number' ? userVector.eyeRatio : 0.38;
    const userJaw = typeof userVector.jawRatio === 'number' ? userVector.jawRatio : (typeof userVector.jaw === 'number' ? userVector.jaw : 0.55);
    const userGonion = typeof userVector.gonionRatio === 'number' ? userVector.gonionRatio : 0.71;
    const userChin = typeof userVector.chinRatio === 'number' ? userVector.chinRatio : 0.62;
    const userNose = typeof userVector.noseRatio === 'number' ? userVector.noseRatio : 0.27;
    const userLip = typeof userVector.lipRatio === 'number' ? userVector.lipRatio : 0.34;
    const userBrow = typeof userVector.browArchRatio === 'number' ? userVector.browArchRatio : (typeof userVector.browArch === 'number' ? userVector.browArch : 0.10);
    const userForehead = typeof userVector.foreheadRatio === 'number' ? userVector.foreheadRatio : 0.30;
    const userSmile = typeof userVector.smilePct === 'number' ? (userVector.smilePct / 100) : (typeof userVector.smile === 'number' ? userVector.smile : 0.55);
    const userShape = userVector.faceShape || null;
    
    const scored = pool.map(c => {
      const bio = c.biometrics || c;
      const cEye = typeof bio.eyeRatio === 'number' ? bio.eyeRatio : 0.38;
      const cJaw = typeof bio.jaw === 'number' ? bio.jaw : (typeof bio.jawRatio === 'number' ? bio.jawRatio : 0.55);
      const cGonion = typeof bio.gonionRatio === 'number' ? bio.gonionRatio : 0.71;
      const cChin = typeof bio.chinRatio === 'number' ? bio.chinRatio : 0.62;
      const cNose = typeof bio.noseRatio === 'number' ? bio.noseRatio : 0.27;
      const cLip = typeof bio.lipRatio === 'number' ? bio.lipRatio : 0.34;
      const cBrow = typeof bio.browArch === 'number' ? bio.browArch : (typeof bio.browArchRatio === 'number' ? bio.browArchRatio : 0.10);
      const cForehead = typeof bio.foreheadRatio === 'number' ? bio.foreheadRatio : 0.30;
      const cSmile = typeof bio.smile === 'number' ? bio.smile : 0.55;

      // 1. Structural Biometric Distances
      const dEye = (cEye - userEye) * 3.6;
      const dJaw = (cJaw - userJaw) * 3.2;
      const dGonion = (cGonion - userGonion) * 2.4;
      const dChin = (cChin - userChin) * 2.2;
      const dNose = (cNose - userNose) * 2.8;
      const dLip = (cLip - userLip) * 1.8;
      const dBrow = (cBrow - userBrow) * 1.6;
      const dForehead = (cForehead - userForehead) * 1.5;
      const dSmile = (cSmile - userSmile) * 0.6;
      
      // 2. Face Shape Archetype Weighting
      let shapePenalty = 0.0;
      if (userShape && c.faceShape) {
        const compat = SHAPE_COMPATIBILITY[userShape];
        if (compat && typeof compat[c.faceShape] === 'number') {
          shapePenalty = compat[c.faceShape] * 2.5;
        } else if (userShape !== c.faceShape) {
          shapePenalty = 0.15;
        }
      }
      
      // 3. Demographic & Age Affinity Penalty
      const celebEstAge = parseCelebEstAge(c);
      const ageDiff = Math.abs(celebEstAge - userAge);
      const agePenalty = Math.max(0, (ageDiff - 10) * 0.0035);

      const rawEuclidean = Math.sqrt(
        dEye * dEye +
        dJaw * dJaw +
        dGonion * dGonion +
        dChin * dChin +
        dNose * dNose +
        dLip * dLip +
        dBrow * dBrow +
        dForehead * dForehead +
        dSmile * dSmile
      );
      
      const totalDist = rawEuclidean + shapePenalty + agePenalty;
      const matchPct = Math.min(98, Math.max(88, Math.round(98.5 - totalDist * 28)));
      return {
        celeb: c,
        distance: totalDist,
        rawDistance: rawEuclidean,
        matchPct: matchPct
      };
    });
    
    scored.sort((a, b) => a.distance - b.distance);
    const topMatches = scored.slice(0, Math.max(1, topK));
    
    let best = topMatches[0];
    if (randomizeTop && topMatches.length > 1) {
      const candidates = topMatches.slice(0, 8);
      const minD = candidates[0].distance;
      const expWeights = candidates.map(c => Math.exp(-(c.distance - minD) / 0.10));
      const totalW = expWeights.reduce((a, b) => a + b, 0);
      let r = Math.random() * totalW;
      let picked = candidates[0];
      for (let i = 0; i < candidates.length; i++) {
        r -= expWeights[i];
        if (r <= 0) {
          picked = candidates[i];
          break;
        }
      }
      best = picked;
    }
    
    return {
      bestMatch: best.celeb,
      matchPct: best.matchPct,
      distance: best.distance,
      topMatches: topMatches
    };
  }

  /**
   * Search and match celebrities by keywords, tags, role, or facial traits.
   * @param {string|object} query Search query string or object
   * @param {object} options Filter options (gender, category, topK)
   * @returns {{ matches: Array, bestMatch: object, count: number }}
   */
  function matchCelebByKeywords(query, options) {
    options = options || {};
    const targetGender = options.gender || null;
    const targetCat = options.category || null;
    const topK = options.topK || 5;

    let qTokens = [];
    if (typeof query === 'string') {
      qTokens = query.toLowerCase().replace(/[^a-z0-9\\s]/g, ' ').split(/\\s+/).filter(t => t.length > 1);
    } else if (query && typeof query === 'object') {
      const parts = [
        query.text || '',
        query.faceShape || '',
        query.gender || '',
        Array.isArray(query.traits) ? query.traits.join(' ') : (query.traits || '')
      ];
      qTokens = parts.join(' ').toLowerCase().replace(/[^a-z0-9\\s]/g, ' ').split(/\\s+/).filter(t => t.length > 1);
    }

    let pool = CELEBS_DATABASE_1000;
    if (targetGender) {
      const gNorm = targetGender.toLowerCase();
      pool = pool.filter(c => c.gender && c.gender.toLowerCase().startsWith(gNorm.startsWith('perem') || gNorm.startsWith('fem') ? 'perem' : 'laki'));
    }
    if (targetCat) {
      pool = pool.filter(c => c.category === targetCat);
    }
    if (!pool.length) pool = CELEBS_DATABASE_1000;

    const scored = pool.map(c => {
      let score = 0;
      const kw = c.keywords || {};
      const allTags = new Set(kw.semua_tags || []);
      const desc = (c.deskripsi_fisik || '').toLowerCase();
      const name = (c.clean_name || c.name || '').toLowerCase();
      const role = (c.role || '').toLowerCase();

      for (const tok of qTokens) {
        if (allTags.has(tok)) score += 3.0;
        if (name.includes(tok)) score += 5.0;
        if (role.includes(tok)) score += 2.5;
        if (desc.includes(tok)) score += 1.0;
      }

      return {
        celeb: c,
        score: score
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const matches = scored.slice(0, Math.max(1, topK));

    return {
      matches: matches.map(m => m.celeb),
      bestMatch: matches[0] ? matches[0].celeb : pool[0],
      count: matches.length
    };
  }

  // Export module
  const exportsObj = {
    CELEBS_DATABASE,
    CELEBS_DATABASE_1000,
    findBestLookalike,
    matchCelebByKeywords
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
  if (typeof window !== 'undefined') {
    window.CELEBS_DATABASE_1000 = CELEBS_DATABASE_1000;
    window.findBestLookalike = findBestLookalike;
    window.matchCelebByKeywords = matchCelebByKeywords;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
"""

final_js_content = js_header + json.dumps(final_database, indent=2, ensure_ascii=False) + js_footer

with open(OUT_JS, "w", encoding="utf-8") as f:
    f.write(final_js_content)
print(f"Written JS to {OUT_JS} ({os.path.getsize(OUT_JS):,} bytes)")

with open(SYNC_DB_JS, "w", encoding="utf-8") as f:
    f.write(final_js_content)
print(f"Synced DB JS to {SYNC_DB_JS} ({os.path.getsize(SYNC_DB_JS):,} bytes)")

print("ALL 5 CELEB DATABASE FILES REBUILT & SYNCED SUCCESSFULLY!")
