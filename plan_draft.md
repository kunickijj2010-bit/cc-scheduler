# Deep Audit & Deployment Fix Plan

The goal is to fix the "HttpError: Not Found" in GitHub Actions, resolve discrepancies in modified employee counts, and ensure consistent calculation across all views (UI, Excel).

## User Review Required

> [!IMPORTANT]
> **GitHub Pages Action Source**: You MUST manually go to your repository settings on GitHub to enable Actions correctly.
> 1. Go to: **https://github.com/kunickijj2010-bit/cc-scheduler/settings/pages**
> 2. Under **Build and deployment** > **Source**, select **GitHub Actions** from the dropdown.

## Proposed Changes

### [Component] Architecture & Logic Audit

#### [MODIFY] [exportUtils.js]
- Ensure the summary sheet logic checks the **entire year** for optimization changes. This fixes the "0 auto-optimizations" error in Excel. (Partially done, will finalize).

#### [MODIFY] [App.jsx]
- Update the `optChangedCount` (KPI box) to check if the employee is affected by an optimization in **any month**, matching the Excel summary.

#### [MODIFY] [usePlanner.js]
- Strengthen the `INIT` filter to purge ALL legacy "baked" optimization data from `localStorage`.

## Verification Plan

### Automated Tests
- Run `npm run build` locally to ensure the base path (`/cc-scheduler/`) is correct.

### Manual Verification
- **User Action**: Change GitHub Pages source to "GitHub Actions" in the web UI.
- **User Action**: Clear browser cache/localStorage.
- **Check**: Verify that "Текущий (База)" results in "0 изменено" (if no manual edits were made).
- **Check**: Verify Excel Summary matches the UI KPI box.
