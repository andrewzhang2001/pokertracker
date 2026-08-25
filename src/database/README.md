# database/ — `/database`

Your own saved hands, one server-fetched page at a time in the replayer.

| File | What it is |
|---|---|
| `DatabaseView.tsx` | The pager, the VPIP filter, and the replayer for the loaded page |

## How it works

100 hands per page. The whole `parsed` + `raw_text` blob comes down per hand, so
the page size trades round-trips against payload size — an unbounded fetch is
what pagination exists to avoid.

The VPIP filter is part of the query, not a client-side pass over the page, so
pages stay full and the counts describe the whole filtered set.

Paging state (`dbPage`, `vpipFilter`) lives in `src/App.tsx` rather than here:
this component unmounts when you navigate away, and leaving the view must not
lose the page you were on.

↑/↓ off either end of a page continues into the adjacent one, so arrow-key
navigation reads as one continuous list.
