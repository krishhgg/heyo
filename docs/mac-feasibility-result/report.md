# Mac feasibility result

No-go as built. The plan's stop conditions were hit:
- The ring search in Finder took 34 ms at the 95th percentile, over the 30 ms limit.
- The ring search in Tailscale took 50 ms at the 95th percentile, over the 30 ms limit.
- The ring search in ChatGPT took 42 ms at the 95th percentile, over the 30 ms limit.

## Accessibility hit tests

| App | Electron | Answered | Timed out | Failed | Hit test p50 | p95 | max | Ring search p95 | Ring answered |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Finder | no | 60 | 0 | 0 | 0.19 ms | 0.68 ms | 2.2 ms | 34.4 ms | 100% |
| Tailscale | no | 60 | 0 | 0 | 0.28 ms | 0.69 ms | 4.1 ms | 50.5 ms | 100% |
| ChatGPT | no | 60 | 0 | 0 | 0.21 ms | 0.33 ms | 1.3 ms | 41.8 ms | 100% |
| Slack | yes | 60 | 0 | 0 | 0.13 ms | 0.18 ms | 1.1 ms | 27.0 ms | 100% |
| Notion | yes | 60 | 0 | 0 | 0.11 ms | 0.17 ms | 1.0 ms | 24.8 ms | 100% |
| (name withheld) | yes | 60 | 0 | 0 | 0.12 ms | 0.75 ms | 1.7 ms | 23.1 ms | 100% |
| Terminal | no | 60 | 0 | 0 | 0.02 ms | 0.06 ms | 0.1 ms | 7.6 ms | 100% |
| Google Chrome | no | 60 | 0 | 0 | 0.07 ms | 0.25 ms | 0.9 ms | 24.6 ms | 100% |
| Safari | no | 60 | 0 | 0 | 0.08 ms | 0.39 ms | 4.0 ms | 13.5 ms | 100% |

## Event tap

- Pass: the active event tap was created. an active tap for left mouse events is running
- Pass: posted clicks reach the window. a click on the button with the tap off pressed it 1 time(s)
- Pass: a near miss does nothing without heyo. a click 4 pt beside the button pressed it 0 more time(s)
- Pass: rewriting the press's location. pressed 1 time(s). The pointer ended at x 374, and the miss was at x 374.
- Pass: holding the press and posting it at the target on release. pressed 1 time(s)
- Pass: a held press that becomes a drag. the view got: down 134, dragged, dragged ... up 194. The button was pressed 0 time(s).
- Pass: a title-bar drag that starts beside the close button. the window moved 80 pt of 80 and is still open
- Fail: a rewritten press that becomes a drag. the view got: nothing. The button was pressed 0 time(s).
- Fail: a title-bar drag that starts beside the close button, with rewriting. the window moved 0 pt of 80 and is still open
- Tap callback time: p95 0.00 ms, max 0.00 ms.
