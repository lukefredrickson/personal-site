Every page starts with this. Logo is lowercase `lukefredrickson.dev` (".dev" in `--logo` gold — both themes); active nav gets the 2.5px `--link` underline (rose — both themes); theme toggle is a 30px outlined circle showing Lucide `moon` (in light) or `sun` (in dark) — the page must load the Lucide CDN script.

```jsx
<SiteHeader active="blog" theme={theme} onToggleTheme={flip} onNavigate={go} />
```
