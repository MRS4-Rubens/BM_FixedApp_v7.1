"""B9a: build the small PDF fonts from the full TeX Gyre Schola OTF files.

Every PDF used to embed all four full OTF faces (~570 KB, ~743 KB as base64). Invoices only ever show Latin text,
digits and punctuation (Indian-script names already fall back to the renderer's fonts, because Schola has no such
glyphs), so we keep exactly the characters below and store them as WOFF2.

Run once after changing the source fonts or the character list (needs: pip install fonttools brotli):
    python scripts/fonts/subset-pdf-fonts.py
The output (assets/fonts/tex-gyre-schola/pdf/bizfolio-schola-pdf-*.woff2) is committed; the app never runs this script.
"""

from pathlib import Path

from fontTools import subset

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "assets" / "fonts" / "tex-gyre-schola"
OUT = SRC / "pdf"

FACES = {
    "texgyreschola-regular": "Regular",
    "texgyreschola-bold": "Bold",
    "texgyreschola-italic": "Italic",
    "texgyreschola-bolditalic": "Bold Italic",
}

# LPPL 1.3c / GUST Font License: a modified (here: subsetted) version must identify itself as not being the original,
# and GUST asks for new font names. The subsets therefore get their own family name; the original OTFs stay unchanged.
NEW_FAMILY = "BizFolio Schola PDF Subset"
NOTICE = (
    "Subset of TeX Gyre Schola (GUST e-foundry) for Invoice BizFolio PDFs; not the original font. "
    "Modified (character subset, WOFF2) under the GUST Font License / LPPL 1.3c."
)

# Basic Latin, Latin-1 (incl. × ÷ ° ©), Latin Extended-A/B and Additional (ā ē ī ō ū ś ṇ ḍ ṭ ṛ ṣ), general punctuation
# (– — ‘ ’ “ ” • … ‰), currency (€ etc.; ₹ is not in Schola and is mapped to a fallback in pdf-fonts.ts),
# № ™ ℅, arrows, minus and other common maths signs.
UNICODES = [
    *range(0x0020, 0x007F),
    *range(0x00A0, 0x0100),
    *range(0x0100, 0x0180),
    *range(0x0180, 0x0250),  # Latin Extended-B
    *range(0x0300, 0x0370),  # combining accents (names typed with separate diacritics)
    *range(0x1E00, 0x1F00),  # Latin Extended Additional: ṇ ḍ ṭ ṛ ṣ ḥ ṃ (Indian names in roman script)
    *range(0x2010, 0x2028),
    *range(0x2030, 0x203B),
    *range(0x20A0, 0x20C1),
    0x2105, 0x2116, 0x2122,
    *range(0x2190, 0x2194),
    0x2212, 0x2215, 0x2219, 0x221E, 0x2248, 0x2260, 0x2264, 0x2265,
]


def rename(font, style: str) -> None:
    name = font["name"]
    postscript = f"{NEW_FAMILY.replace(' ', '')}-{style.replace(' ', '')}"
    for record in list(name.names):
        if record.nameID in (1, 16):
            record.string = NEW_FAMILY
        elif record.nameID in (2, 17):
            record.string = style
        elif record.nameID == 3:
            record.string = f"{postscript};subset"
        elif record.nameID == 4:
            record.string = f"{NEW_FAMILY} {style}"
        elif record.nameID == 6:
            record.string = postscript
    name.setName(NOTICE, 5, 3, 1, 0x409)  # version string: say it is a modified subset
    name.setName(NOTICE, 10, 3, 1, 0x409)  # description
    if "CFF " in font:
        cff = font["CFF "].cff
        cff.fontNames = [postscript]
        top = cff.topDictIndex[0]
        top.FamilyName = NEW_FAMILY
        top.FullName = f"{NEW_FAMILY} {style}"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["kern", "liga", "clig", "calt", "lnum", "tnum", "onum", "pnum"]
    options.hinting = False  # PDFs are rendered at print resolution; hints only add bytes
    options.desubroutinize = True  # smaller after WOFF2 compression for CFF fonts
    options.name_IDs = ["*"]  # keep naming and licence notices
    options.notdef_outline = True
    for face, style in FACES.items():
        font = subset.load_font(str(SRC / f"{face}.otf"), options)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=UNICODES)
        subsetter.subset(font)
        rename(font, style)
        target = OUT / f"{face.replace('texgyreschola', 'bizfolio-schola-pdf')}.woff2"
        subset.save_font(font, str(target), options)
        print(f"{target.relative_to(ROOT)}: {target.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
