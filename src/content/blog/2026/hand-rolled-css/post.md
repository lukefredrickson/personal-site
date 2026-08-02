---
title: Why I still hand-roll my CSS
description: Every year someone tells me my stylesheet workflow is obsolete. Every year I ship faster than the person telling me.
pubDate: 2026-06-14
tags: [code]
hero: ./hero.png
heroAlt: Placeholder hero art — a flat hatched panel standing in for a real photo.
heroCaption: optional caption or image credit
---

Every year someone tells me my stylesheet workflow is obsolete. Every year I
ship faster than the person telling me, which is not proof of anything, but it
is at least evidence.

The argument for a framework is that it removes decisions. The argument against
is that it removes them whether or not you wanted them removed. Once a project
has a design system — real tokens, a real type scale, a real spacing ramp — the
decisions a utility framework saves you have already been made somewhere else,
and what is left is a second vocabulary layered on top of the first.

```css
.card {
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
```

Three properties, one file, scoped to the component that owns it. The token
names are the design system's names. When the design changes, the token
changes, and nothing else has to.

That is the whole argument. It is not a moral position, and it stops being true
the moment a team grows past the point where one person can hold the stylesheet
in their head.
