/**
 * Dependency manifest for the skills bundled with Reckon.
 *
 * The upstream Anthropic skills don't ship a machine-readable dep list — they
 * mention requirements in SKILL.md prose. We mirror those requirements here so
 * `pnpm doctor` can detect what's missing and print install commands.
 *
 * Only entries listed below are checked. Skills authored by the user via the
 * in-app `createSkill` tool are skipped — there's no way to know what they
 * depend on, and they typically use the runtime's existing tools (Bash,
 * Read/Write, etc.) rather than external binaries.
 */
export interface SkillDeps {
  /** Python module names as imported (e.g. `import pptx` → "pptx"). */
  python: string[];
  /** Pip package names that provide each python entry. Same length as `python`. */
  pip: string[];
  /** CLI binaries that must be on PATH. */
  binaries: string[];
  /** apt-get package names that provide each binary. Same length as `binaries`. */
  apt: string[];
  /** brew formula/cask spec for each binary, e.g. "--cask libreoffice". Same length as `binaries`. */
  brew: string[];
}

export const KNOWN_SKILL_DEPS: Record<string, SkillDeps> = {
  xlsx: {
    python: ["openpyxl"],
    pip: ["openpyxl"],
    binaries: ["soffice"],
    apt: ["libreoffice"],
    brew: ["--cask libreoffice"],
  },
  pptx: {
    python: ["pptx", "PIL"],
    pip: ["python-pptx", "Pillow"],
    binaries: ["soffice"],
    apt: ["libreoffice"],
    brew: ["--cask libreoffice"],
  },
  docx: {
    python: ["docx"],
    pip: ["python-docx"],
    binaries: ["soffice"],
    apt: ["libreoffice"],
    brew: ["--cask libreoffice"],
  },
  pdf: {
    python: ["pypdf", "pdfplumber", "reportlab", "PIL"],
    pip: ["pypdf", "pdfplumber", "reportlab", "Pillow"],
    binaries: ["pdftotext", "qpdf"],
    apt: ["poppler-utils", "qpdf"],
    brew: ["poppler", "qpdf"],
  },
  "internal-comms": {
    python: [],
    pip: [],
    binaries: [],
    apt: [],
    brew: [],
  },
  "skill-creator": {
    // Trimmed Reckon variant — eval-loop scripts that shell out to the `claude`
    // CLI were dropped (see SKILL.md note). Only quick_validate.py needs an
    // external dep; the rest are pure stdlib.
    python: ["yaml"],
    pip: ["PyYAML"],
    binaries: [],
    apt: [],
    brew: [],
  },
};
