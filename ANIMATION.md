# Connection-aware Clippy

Signup uses `/sbbs/mods/load/linkspeed.js`, the same session measurement as
the logon apps and fshell_ts. The NEW-user path reaches signup before the
normal logon probe, so signup asks for the tier before painting the wizard.
A cached reading in `bbs.mods` is reused. The shared meter's thresholds are
KB/s (decimal kilobytes per second), **not** kilobits per second.

| Measured receive rate | Signup behavior |
| --- | --- |
| Below 8 KB/s (including modem links up to 56k) | A still Clippy; pose changes with the signup step, no repeating animation timer. Mouse countdown redraws every 5 seconds. |
| 8–under 40 KB/s | Animation intervals are at least 800ms, with a 2-second typing quiet period. Mouse countdown redraws every 2 seconds. |
| 40 KB/s or higher; unknown/unavailable | Original 150/200ms animation timing and 1-second mouse countdown. |

All tiers retain the same prompts, artwork, account validation, 75ms input
polling, mouse-test deadline and 3dBBS depth policy. Static mode means no
*idle sprite traffic*, not zero output from the interactive wizard.

Sprites replace cells in place rather than calling `Frame.clear()` every
tick. This preserves the display diff buffer and avoids resending identical
poses. In the native rendering harness, all shipped frames have exactly the
same characters and colors as the old renderer.

## Measurements and regression checks

Run from `/sbbs`:

```sh
/sbbs/repo/exec/jsexec -C -c/sbbs/ctrl -i/sbbs/exec/load /sbbs/mods/future_signup/test-animation.js
/sbbs/repo/exec/jsexec -C -c/sbbs/ctrl -i/sbbs/exec/load /sbbs/mods/future_signup/test-signup.js
```

The first harness uses the actual sprite data, Synchronet Frame renderer,
and ANSI attribute sequences, with an in-memory console and simulated time.
It compares the old clear/repaint path with the shipped renderer, checks the
shared speed-tier boundaries, and tests animation timing, static poses,
typing pauses and timer scheduling. Neither harness creates accounts.

Measured idle sprite traffic was approximately 1.40 KB/s before the change.
The new full-speed idle is approximately 0.90 KB/s; modem-tier idle is zero.
Across all shipped animations, lite mode peaks at about 0.39 KB/s over a
60-second simulation. Changed-cell output is not always smaller: the
fragmented `shake_no` animation costs about 14% more at full speed, but still
stays under 0.4 KB/s in lite mode. Fast-link timing and pixels are unchanged.

These are ANSI-output estimates, not a physical-modem test; they exclude
the one-time shared speed probe, Telnet framing and ordinary prompt output.
For an interactive check, the existing sysop-menu NEWUSERFLOW entry runs the
real wizard in mock mode without creating an account. Test it through a
rate-limited terminal session to exercise a freshly measured slow link.
