Rounded button/link for the link row and inline CTAs; one primary per view, the rest secondary.

```jsx
<Button variant="primary" href="/resume.pdf">résumé <Icon name="file-text" size={13} /></Button>
<Button href="https://github.com/luke">github</Button>
```

Primary is pine-filled in both themes (blue-50 light / blue-65 dark, via `--btn-primary-*` tokens). Keep labels lowercase.
