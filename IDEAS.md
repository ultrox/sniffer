# Request Rewriting

## Problem

Currently `:limit` in a URL pattern matches any value, and `{{limit}}` in the response body substitutes the captured value. But there's no way to *rewrite* the request itself — e.g. intercept `?limit=50` but actually send `?limit=10` upstream, or always force a specific param value during replay.

Putting defaults on the pattern (like `:limit|10`) conflates two things: matching and rewriting. The pattern syntax should stay simple.

## Idea

A separate rewrite rules layer, probably its own view per recording. Something like:

```
Match: https://pokeapi.co/api/v2/berry?limit=:limit&offset=:offset
Rewrite: https://pokeapi.co/api/v2/berry?limit=10&offset=0
```

Or field-level rules:

| Param    | Match | Rewrite |
|----------|-------|---------|
| limit    | :any  | 10      |
| offset   | :any  | 0       |

This keeps pattern matching (`:param`) and rewriting as separate concerns.

## Use cases

- Force pagination params to specific values regardless of what the app sends
- Normalize API calls to a known state for consistent replay
- Test how the app behaves when it asks for limit=100 but gets a response shaped for limit=10

## Notes

- Rewriting only makes sense during replay, not recording
- Could be optional per-entry — most entries just need match + respond, only some need rewriting
- The rewrite happens before matching the response, so `{{param}}` in the body would use the *rewritten* value, not the original request value
- Needs its own UI — a rules editor separate from the URL parsed view
