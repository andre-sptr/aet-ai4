# Phase 2 context-fitting fix

## Issue
The first Phase 2 test run had 93 passing tests, one failing context-fitting test, and one intentionally skipped PostgreSQL integration test.

The failing assertion expected an explicit marker when older conversation turns were omitted. The context fitter could fill the available budget with retained turns before adding that marker.

## Fix
- Reserve marker space before admitting older turns when history must be trimmed.
- Retain only a contiguous suffix of complete conversation turns to preserve chronology.
- Include an explicit omission marker.
- Fail explicitly if the latest turn plus required system instructions and omission marker cannot fit.
- Strengthen the regression test to verify retained recent turns, omitted old turns, chronological completeness, and budget compliance.

## Validation
The supplied full test output reported 93 passed, 1 failed, and 1 skipped. The fix is applied to the source and the regression test is updated. A complete rerun must be performed on the user's Node.js 24+ environment after `npm ci`; the current artifact-building environment could not resolve the `zod` dependency.
