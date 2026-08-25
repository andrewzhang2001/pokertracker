# landing/ — `/`

The home screen: one card per surface, and the Clerk account button.

| File | What it is |
|---|---|
| `LandingView.tsx` | The card grid. Navigation is a prop (`onNavigate`); it knows no routes of its own. |

No data, no pipeline. Adding a surface to the app means adding a `<Card>` here
and a branch in `src/App.tsx`.
