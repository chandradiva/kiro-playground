# Source transformer version (no code templates)

Use these three files as three **JavaScript steps** in the source transformer
of the `Meditech-Inbound-CHARM` channel. The order matters:

| Step | File | Runs when |
|------|------|-----------|
| 1 | `step1-shared-helpers.js` | Always: HL7 helpers, parsing, validation, timestamp |
| 2 | `step2-a08-to-charm-a08.js` | Event is **A08** |
| 3 | `step3-a31-to-charm-a08.js` | Event is **A31** |

Mirth runs all transformer steps in one shared scope, so steps 2 and 3 can
use the functions and variables from step 1 (`charmCtx`, `charmMeta`,
`charmOutput`, ...).

## Setup

1. Source -> Transformer: delete the old JavaScript step that called
   `convertMeditechToCharm`.
2. Add 3 JavaScript steps and paste each file into one step, in the order above.
3. Unlink the code template libraries (HL7Parser, HL7DateTime, HL7Builder,
   MeditechToCharm) from this channel, so there aren't two copies of the same
   functions.
4. Data types:
   - Source inbound: **HL7 v2.x** (the filter uses `msg`)
   - Source outbound: **Raw**, with `CHARM_OUTBOUND_HL7V2 = false` in step 1
     (or **HL7 v2.x**, with `CHARM_OUTBOUND_HL7V2 = true`)
5. Save and redeploy the channel.

The converted message is assigned to `tmp` and also stored in
`channelMap` as `charmHl7`.

## No source filter needed

Step 1 runs the checks the old source filter did (ADT, event A08/A31,
MR identifier in PID-3) and sets `siteCode` and `triggerEvent` in
`channelMap` for every message. You can delete the source filter rule.

There is no site list: every site is accepted. A message must still have a
site in MSH-4.1 or PID-3.6, because the site is written to MSH-4, the PID-3
facility and PV1-39.

When a message fails these checks, `CHARM_REJECT_AS_ERROR` in step 1 decides
what happens:

- `false` (default): the message is logged as
  `Meditech-to-Charm filtered: ...` and sent to no destination
  (`destinationSet.removeAll()`), which is the closest match to the old filter.
- `true`: an error is thrown, so the message shows as ERROR in the dashboard.

The checks read the raw message text, not `msg`, so they don't depend on
the inbound data type.

## Rules when editing

- Don't put `return` at the top level of a step. It ends the whole
  transformer, so the later steps won't run.
- Function names must be unique across steps. Step 2 uses `a08*` names and
  step 3 uses `convertMeditechA31ToCharm`.
