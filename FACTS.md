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
| A disconnected shaft-to-hub relationship is detected.                         | Measurement negative control                             | A consistency control, not a comparison against a competing CAD product. |
| A new primitive assembly uses the same derivation path.                       | Custom assembly measurement; engine tests                | Boxes, cylinders and tubes, not arbitrary surface reconstruction.        |
| Independent edits merge; overlapping assumptions conflict.                    | `tests/server.test.ts`, `tests/browser/journeys.spec.ts` | Two browser sessions tested; no wide-area load study.                    |
| Notes and sketches persist and converge; stroke undo preserves other authors. | Server tests; `tests/browser/ui-features.spec.ts`        | Guest display names are self-reported. Share tokens grant access.        |
| Build outputs remain bound to their input revision.                           | `tests/browser/revision-package.spec.ts`                 | Export completion does not overwrite the current design.                 |
| CAD solids can be reopened and checked for validity, volume and bounds.       | `poetry run pytest`; `tests/cad_exports_test.py`         | Does not prove assembly fit, structural strength or machine setup.       |
| All six examples can be edited, assembled virtually and exported.             | `tests/browser/journeys.spec.ts`                         | Mechanism motion is illustrative kinematics.                             |

A live AI call created a three-part phone stand, which was accepted and exported. Another visual-input call asked for missing measurements instead of inventing dimensions. Those provider checks are recorded development observations, not deterministic CI guarantees; they depend on credentials and model behavior.

Microphone recognition, physical fabrication and a human outcome comparison remain unverified. Video reference input samples one frame. No supplier quote is requested automatically. Generated appearance assets and provider subscriptions are not included.
