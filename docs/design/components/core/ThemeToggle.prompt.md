Theme switch for the site header — replaces the old round icon button.

```jsx
<ThemeToggle theme={theme} onToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
```

56×28 pill track (1.5px ink border) with muted sun/moon icons inside; the ink knob slides to the active side and shows the active icon. Purely controlled — pass the current `theme` and flip it in `onToggle`.
