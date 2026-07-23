Article code block. Theme-matched: dawnfox syntax on the true dawn background (paper-97, shared with cards) in light; duskfox on ink-30 in dark — one step above the true-dusk page.

```jsx
<CodeBlock filename="card.css" code={`.card {\n  display: grid;\n  gap: 12px;\n}`} />
```

For syntax color, pass spans as children using `--code-selector` (iris) / `--code-property` (blue) / `--code-value` (foam green) / `--code-function` (blue, one step lighter) / `--code-custom` (gold). Comments use `--code-muted`, italic — the only mono italic. Fira Code ligatures stay on.
