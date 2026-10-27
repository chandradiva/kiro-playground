# Meditech → Charm — Mirth Code Template Libraries

This folder splits the original monolithic `convertMeditechToCharm` transformer
into reusable Mirth Connect **Code Template Libraries**. Behavior is identical to
the original (verified by running both over A08 and A31 fixtures and comparing
byte-for-byte output).

## Files / Libraries

| File | Library | Code Template | Functions |
|------|---------|---------------|-----------|
| `HL7Parser.js`     | **HL7 Parsing Utilities**  | `HL7Parser`      | `HL7_normalize`, `HL7_parse`, `HL7_field`, `HL7_repeat`, `HL7_component`, `HL7_subcomponent`, `HL7_value` |
| `HL7DateTime.js`   | **HL7 Datetime Utilities** | `HL7DateTime`    | `HL7_validClock`, `HL7_dateValue` |
| `HL7Builder.js`    | **HL7 Build Utilities**    | `HL7Builder`     | `HL7_pad`, `HL7_seg`, `HL7_emit` |
| `MeditechToCharm.js` | **Meditech to Charm Converter** | `MeditechToCharm` | `convertMeditechToCharm` (entry point) |

## Dependency direction

```
MeditechToCharm  ──uses──▶  HL7Parser
                 ──uses──▶  HL7DateTime
                 ──uses──▶  HL7Builder
```

The three utility libraries have **no dependencies** on each other, so you can
reuse them independently in other channels.

## How to set this up in Mirth Connect

1. Open **Channels → Edit Code Templates** (the code template editor).
2. Create four libraries using the **Library** names in the table above.
3. In each library, add a **Code Template** of type *Function* and paste the
   contents of the matching `.js` file.
4. For each library, tick the channels that should have access under the
   **Channels** tab (at minimum, link all four to the channel that runs the
   Meditech→Charm transformer). Utility libraries can also be linked to other
   channels that need HL7 parsing/date/build helpers.
5. In your channel's transformer, call the entry point exactly as before:

   ```javascript
   var result = convertMeditechToCharm(messageRaw, options, processingTimestamp);
   // result.hl7, result.site, result.event, result.warnings, result.defaultedFields
   ```

## Why the helpers changed shape

In the original code, helpers like `f`, `v`, `dateValue`, and `validClock` were
**closures** — they captured `segments`, `options`, `warnings`, `defaults`, and
`processingTimestamp` from the enclosing function. Mirth concatenates all linked
code templates into one shared global scope, so closures that depend on
per-message state can't live in a shared library as-is.

The extracted library functions are therefore **stateless**: they take their
inputs as explicit parameters (e.g. `HL7_field(segments, tag, n, r)` and
`HL7_dateValue(value, dateOnly, label, allowCurrentDefault, ctx)`).

Inside `MeditechToCharm.js`, thin local shims (`f`, `v`, `dateValue`, …) wrap the
library functions and bind the per-message context, so the main body reads
almost exactly like the original — keeping the diff small and the behavior
identical.

## Verifying equivalence locally (optional)

The split was validated with Node's `vm` module by loading the four library
files into a single shared context (simulating Mirth's concatenation) and
comparing output against the original monolith across A08 and A31 fixtures. All
cases matched byte-for-byte.
