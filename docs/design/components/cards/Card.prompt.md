Base card for everything boxy. `header` renders the raised strip; `quiet` is for secondary cards; `shadow` picks the colored offset.

```jsx
<Card header={<><LogoTile>C1</LogoTile><b>Company One</b></>}>
  <div style={{ padding: '18px 20px' }}>…</div>
</Card>
<Card quiet radius="var(--radius-md)">…</Card>
```

Exports `Card` and `LogoTile`.
