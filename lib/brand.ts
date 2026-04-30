/**
 * Per-deployment brand customisation.
 *
 * Two knobs, both `NEXT_PUBLIC_*` so they're available in client components:
 *   - NEXT_PUBLIC_BRAND_NAME    — display name shown in the sidebar / titles.
 *                                  Defaults to "Reckon".
 *   - NEXT_PUBLIC_BRAND_LOGO    — path (relative to /public) of the logo SVG
 *                                  or PNG. Defaults to "/brand/logo.svg".
 *                                  To customise per-deployment, replace the
 *                                  file at this path; no rebuild needed for
 *                                  the default path. To point at a different
 *                                  asset, set the env var and rebuild.
 *
 * Both env vars are inlined at build time. Re-deploy after changing them.
 */
export const brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "Reckon",
  logo: process.env.NEXT_PUBLIC_BRAND_LOGO || "/brand/logo.svg",
};
