# Verified claims and limits

The numbers below describe deterministic fixtures. They do not measure manufacturing success, human time saved, or adoption. Run `npm test` to check this ledger and `npm run measure` to regenerate its evidence.

<!-- measured-claims -->

```json
{
  "validCases": 12,
  "invalidCasesRejected": 6,
  "customAssemblies": 1,
  "negativeControlDetected": true
}
```

<!-- /measured-claims -->

| Claim                                                                         | Reproducible evidence                                    | Boundary                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Twelve parameter changes propagate through six product definitions.           | `scripts/measure.ts`, `tests/facts.test.ts`              | Handwritten fixtures; not an exhaustive engineering proof.               |
| Six invalid or incompatible parameter combinations are rejected.              | `scripts/measure.ts`                                     | Validation is bounded to the supported design models.                    |
| A disconnected frame spacer after a height edit is detected.                         | Measurement negative control                             | A consistency control, not a comparison against a competing CAD product. |
| A new primitive assembly uses the same derivation path.                       | Custom assembly measurement; engine tests                | Boxes, cylinders and tubes, not arbitrary surface reconstruction.        |
| Independent edits merge; overlapping assumptions conflict.                    | `tests/server.test.ts`, `tests/browser/journeys.spec.ts` | Two browser sessions tested; no wide-area load study.                    |
| Notes and sketches persist and converge; stroke undo preserves other authors. | Server tests; `tests/browser/ui-features.spec.ts`        | Guest display names are self-reported. Share tokens grant access.        |
| Build outputs remain bound to their input revision.                           | `tests/browser/revision-package.spec.ts`                 | Export completion does not overwrite the current design.                 |
| CAD solids can be reopened and checked for validity, volume and bounds.       | `poetry run python -m pytest`; `tests/cad_exports_test.py`         | Does not prove assembly fit, structural strength or machine setup.       |
| All six examples can be edited, assembled virtually and exported.             | `tests/browser/journeys.spec.ts`                         | Mechanism motion is illustrative kinematics.                             |

A live AI call created a three-part phone stand, which was accepted and exported. Another visual-input call asked for missing measurements instead of inventing dimensions. Those provider checks are recorded development observations, not deterministic CI guarantees; they depend on credentials and model behavior.

Microphone recognition, physical fabrication and a human outcome comparison remain unverified. Video reference input samples one frame. No supplier quote is requested automatically. Generated appearance assets and provider subscriptions are not included.

New turntables use a versioned 8 mm spindle / 608 bearing reference. Older saved turntables retain their conceptual shaft model. Nominal motor/coupling/collar envelopes, threadless fasteners and open-frame supports require fit, guarding, electrical and load review before physical use.

## Additional bounded verification — November 6, 2026

- A real model-backed design agent changed an upper camera-arm link from 4 mm to 6 mm; its holes and the main design were preserved. A second engineering role read that proposed revision and ran eight component manufacturing checks. An earlier attempt asked unnecessary questions and made no edit; the prompt and bounded partial-edit contract were repaired before the successful rerun. This is a recorded provider observation, not a deterministic reliability guarantee.
- The linear-elastic cantilever fixture measured 0.045318 mm against the analytical 0.045714 mm result, with force-balance checks. Three refinement levels are required for a convergence assessment; an unconverged calculation is displayed explicitly. Full assemblies, contact, nonlinear material response and physical load capacity are not established.
- Real rigid-body tests exercise gravity, sliding/rotational limits, zero drive limits, fixed connections, repeated results and rotated joint reference frames. Input masses and rectangular-envelope inertia remain declared approximations.
- Actual STEP upload, feature fitting, acceptance, hole shrinking, retained-source integrity and source-based strength analysis pass. STL, OBJ and GLB mechanical feature fixtures also pass. Unsupported mixed-axis/freeform geometry and invalid topology remain explicit failures rather than silently repaired inputs.
- Optional native browser-tool registration awaits the current `document.modelContext` registration API and uses abort-based cleanup. Contract tests cover partial failure, cancellation and disposal, but do not establish actual use in an enabled browser.
- The product-video encoder produced exactly 600 frames at 1920 × 1080, 30 fps and 20.000 seconds. Full decode, all six example frames, repeated-frame identity, authenticated download and real process cancellation were checked.

These checks do not establish fabrication success, customer adoption, microphone recognition or a production deployment.
