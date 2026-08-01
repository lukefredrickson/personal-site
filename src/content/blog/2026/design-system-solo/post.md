---
title: Notes on shipping a design system solo
description: What worked, what I'd never do again, and the spreadsheet that saved the whole thing.
pubDate: 2026-05-02
tags: [code]
---

A design system built by one person has exactly one advantage over a design
system built by a team: there is never an argument about naming. It also has
one enormous disadvantage, which is that there is never an argument about
naming.

What worked: starting from the tokens and refusing to write a component until
the token it needed existed. Every shortcut I took past that rule came back as
a hardcoded value I had to find again six weeks later.

What I would never do again: building components in spec order instead of
screen order. Half of what I built early was never used, and the pieces the
screens actually needed showed up late, designed around constraints I had
already accidentally frozen.

The spreadsheet that saved it was embarrassingly simple — one row per screen,
one column per component, a checkmark where they intersect. The components with
the most checkmarks got built first. Everything else waited until a screen
asked for it.
