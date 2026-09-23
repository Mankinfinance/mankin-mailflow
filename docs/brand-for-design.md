# Brand values for design work

Pasted into a design prompt, these are what keep generated work looking
like Mankin Finance rather than like a template. Taken from
`app/globals.css` and the email renderer, not chosen here — if they
change there, change them here.

## Colour

| Token | Hex | Used for |
|---|---|---|
| brand | `#161461` | Primary navy. Buttons, headings, links. |
| brand-deep | `#0c034b` | Display headings, the darkest navy. |
| accent | `#e3ad4b` | Gold. The single accent — one per view. |
| accent-deep | `#bc7d19` | Gold on a light ground, where contrast needs it. |
| paper | `#f8f7f2` | Page background. Warm off-white, never pure white. |
| paper-warm | `#f3eee4` | Inset panels, code chips, quiet fills. |
| ink | `#161a26` | Body text. |
| ink-mute | `#6a6e7a` | Secondary text, captions, metadata. |

Status colours are reserved and never used as decoration: draft
`#5f636e`, scheduled `#4151a8`, sending `#0a7c7f`, sent `#2f6f4a`,
paused `#8a6a22`, error `#a3423e`. Each ships with a label, never
colour alone.

## Type

- Display / headings: **Newsreader** (serif), weight 500, letter-spacing −0.015em
- Body / UI: **Manrope** (sans)
- Monospace: **JetBrains Mono**

In email, none of these can be relied on — mail clients do not load web
fonts. Email falls back to Arial/Helvetica at 13.5px, line-height 1.55,
in a 640px column.

## Required on every marketing email

```
Mankin Finance Pty Ltd | Australian Credit Representative 102746
Under Australian Credit Licence 390261 (YBR Aggregation Services)
```

Plus a working unsubscribe link. The renderer appends both — a design
must leave room for them rather than supply its own.
