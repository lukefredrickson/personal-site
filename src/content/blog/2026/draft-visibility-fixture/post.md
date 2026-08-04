---
title: Draft fixture — delete before merge
description: A temporary unpublished post that proves draft visibility on the preview deploy for issue #56.
pubDate: 2026-08-04
tags: [code, life]
draft: true
---

This post exists to prove one thing: a `draft: true` post renders on the
preview deploy for this PR and nowhere else. If you are reading it on
`lukefredrickson.dev`, the feature is broken — that is the whole test.

On the preview it should appear in every place the shared post query reaches:
the home page's featured card, the home "Writing" rows, the blog index under
2026, the `code` and `life` tag pages with their counts bumped by one, and the
prev/next chain of its neighbors. It carries a rose `draft` badge on the
post header, the index row, and the featured card.

On a local `npm run build` it should appear nowhere at all, and
`SHOW_DRAFTS=true npm run build` should bring it back.

Delete this directory before merging. See ADR 0021.
