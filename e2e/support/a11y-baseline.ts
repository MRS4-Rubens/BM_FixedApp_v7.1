import * as fs from 'fs';
import * as path from 'path';

export type RuleViolations = Record<string, number>;
export type A11yBaseline = Record<string, RuleViolations>;

export interface A11yRegression {
  readonly ruleId: string;
  readonly expectedCount: number;
  readonly actualCount: number;
}

export interface A11yImprovement {
  readonly ruleId: string;
  readonly previousCount: number;
  readonly currentCount: number;
}

export interface A11yDiffResult {
  readonly isClean: boolean;
  readonly regressions: readonly A11yRegression[];
  readonly improvements: readonly A11yImprovement[];
}

/**
 * Compares current page violations against the baseline.
 * Flags a regression if:
 * 1. A rule exists in current that was not present in the baseline.
 * 2. A rule has a higher count in current than in the baseline.
 */
export function diffAgainstBaseline(
  current: RuleViolations,
  baseline: RuleViolations | undefined,
): A11yDiffResult {
  const base = baseline ?? {};
  const regressions: A11yRegression[] = [];
  const improvements: A11yImprovement[] = [];

  for (const [ruleId, count] of Object.entries(current)) {
    const baseCount = base[ruleId] ?? 0;
    if (count > baseCount) {
      regressions.push({
        ruleId,
        expectedCount: baseCount,
        actualCount: count,
      });
    } else if (count < baseCount) {
      improvements.push({
        ruleId,
        previousCount: baseCount,
        currentCount: count,
      });
    }
  }

  for (const [ruleId, baseCount] of Object.entries(base)) {
    if (!(ruleId in current) && baseCount > 0) {
      improvements.push({
        ruleId,
        previousCount: baseCount,
        currentCount: 0,
      });
    }
  }

  return {
    isClean: regressions.length === 0,
    regressions,
    improvements,
  };
}

export function loadBaselineFile(filePath: string): A11yBaseline | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as A11yBaseline;
  } catch {
    return null;
  }
}

export function saveBaselineFile(filePath: string, baseline: A11yBaseline): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(baseline, null, 2), 'utf-8');
}

