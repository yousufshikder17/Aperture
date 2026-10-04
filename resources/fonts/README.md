# PDF fallback fonts

Noto Sans CJK SC variable TrueType, release Sans2.004, from
https://github.com/notofonts/noto-cjk/tree/Sans2.004/Sans/Variable/TTF.
Exports instantiate regular (400) and bold (700) weights before subsetting.
Use TrueType: the PDF library's CFF subsetter can lose visible CJK glyphs.
Noto Sans regular and bold come from
https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans.
Both projects' original SIL Open Font Licenses are included as LICENSE-CJK and
LICENSE-Sans.

PDF exports retain the selected standard font when it covers the text. Otherwise
they embed a subset of these fonts, preserving Latin, Greek, Cyrillic, and CJK
characters. Fonts are bundled so exports do not need network access or host fonts.
Characters outside the bundled fonts' coverage produce an explicit export error
instead of silently disappearing. This does not add bidirectional text layout.
