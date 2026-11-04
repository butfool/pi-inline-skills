# Changelog

## [1.0.0] - 2026-11-03

First release.

- `$name` and `/skill:name` load a skill from anywhere in a message, including next to Chinese text and sentence punctuation.
- Every skill arrives as its own `<skill>` context message, rendered as a collapsible card, while the user message stays as typed.
- Autocomplete stacks on Pi's own provider; file completion never opens inside a skill marker.
- A skill is only expanded when the whole word is its name, so `$PATH`, `$9.99`, `$find-docsX`, `/tmp/$find-docs`, and `\$find-docs` stay literal.
