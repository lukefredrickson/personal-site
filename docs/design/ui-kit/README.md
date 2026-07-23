# UI kit: the site

The four approved screens of lukefredrickson.dev, composed from the design-system components.

- `Home.jsx` — hero, link row, career history (CompanyCard × 2 + EducationLine), writing (FeaturedPostCard + rows).
- `BlogIndex.jsx` — intro, working topic filters, year-grouped list.
- `PostTech.jsx` — tech post: framed hero, code block, blockquote, author card, prev/next.
- `PostRide.jsx` — ride post: stat chips, captioned photos, vlog embed.
- `index.html` — interactive, dependency-free demo of all four pages with working nav, post links, topic filters, and a persistent light/dark toggle. This mirrors the JSX screens 1:1 for preview purposes. It stays here (rather than in `templates/`) as the interactive reference — the static `templates/` versions deliberately drop all JS behavior.

All screens take `{ theme, onToggleTheme, onNavigate, onOpenPost }` so a host can wire routing and theming. Theme is applied by setting `data-theme="dark"` on `<html>` (or any ancestor).

Content is placeholder pending Luke's real career details, posts, and photos.
