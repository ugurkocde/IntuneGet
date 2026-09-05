"""Regenerate complementary Inter subsets: pip install 'fonttools[woff]==4.60.2'."""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
source = root / 'public/fonts/InterVariable.woff2'
all_points = set(TTFont(source).getBestCmap())
ranges = [(0x0,0xff),(0x131,0x131),(0x152,0x153),(0x2bb,0x2bc),
          (0x2c6,0x2c6),(0x2da,0x2da),(0x2dc,0x2dc),(0x2000,0x206f),
          (0x2074,0x2074),(0x20ac,0x20ac),(0x2122,0x2122),(0x2190,0x2193),
          (0x2212,0x2212),(0x2215,0x2215),(0xfeff,0xfeff),(0xfffd,0xfffd)]
latin = all_points & {c for a,b in ranges for c in range(a,b+1)}
def css_range(points):
    groups=[]
    for c in sorted(points):
        if groups and c==groups[-1][1]+1: groups[-1][1]=c
        else: groups.append([c,c])
    return ','.join(f'U+{a:04X}'+(f'-{b:04X}' if a!=b else '') for a,b in groups)
faces=[]
coverage=set()
remaining = all_points - latin
latin_ext = {c for c in remaining if 0x100 <= c <= 0x24f or 0x2b0 <= c <= 0x36f}
latin_additional = {c for c in remaining if 0x1e00 <= c <= 0x1eff}
subsets = [('latin', latin), ('latin-ext', latin_ext), ('latin-additional', latin_additional),
           ('symbols', remaining - latin_ext - latin_additional)]
for name, points in subsets:
    if not points:
        continue
    font=TTFont(source)
    options=subset.Options(); options.layout_features=['*']
    subsetter=subset.Subsetter(options=options); subsetter.populate(unicodes=points)
    subsetter.subset(font)
    target=root/f'public/fonts/Inter-{name}-v1.woff2'
    font.save(target)
    coverage.update(TTFont(target).getBestCmap())
    faces.append(f'''@font-face {{
  font-family: "Inter";
  src: url("/fonts/Inter-{name}-v1.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
  unicode-range: {css_range(points)};
}}''')
    print(name, target.stat().st_size, 'bytes')
assert coverage == all_points, 'Subset coverage must preserve every original character'
css=root/'app/globals.css';s=css.read_text();start=s.index('@font-face {');end=s.index('@font-face {\n  font-family: "Inter Fallback";')
css.write_text(s[:start]+'\n'.join(faces)+'\n'+s[end:])
